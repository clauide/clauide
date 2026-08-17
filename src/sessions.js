const { execFile } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { app } = require('electron')

const storePath = () => path.join(app.getPath('userData'), 'sessions.json')
const dockerfileDir = () => path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'docker')

/** The image tag is derived from the contents of the bundled docker/ directory, so shipping a
 *  changed Dockerfile (or anything else baked into the image) produces a tag nobody has built yet
 *  and ensureImage() rebuilds on its own. A fixed tag would leave every existing install pinned to
 *  whatever it built first, no matter how many app updates it received. */
let imageTag = null

function imageName() {
  if (imageTag) return imageTag
  const dir = dockerfileDir()
  const hash = crypto.createHash('sha256')
  const walk = (current) => {
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else {
        hash.update(path.relative(dir, full))
        hash.update(fs.readFileSync(full))
      }
    }
  }
  walk(dir)
  imageTag = `clauide-vscode:${hash.digest('hex').slice(0, 12)}`
  return imageTag
}

const run = (cmd, args) =>
  new Promise((resolve, reject) => execFile(cmd, args, (err, stdout) => (err ? reject(err) : resolve(stdout))))

let imageBuildInFlight = null

async function imageExists() {
  return run('docker', ['image', 'inspect', imageName()])
    .then(() => true)
    .catch(() => false)
}

/** Every superseded build is a few GB of layers nobody will use again. Images still backing a
 *  running container refuse to be removed, which is exactly the desired behaviour — those get
 *  collected on a later pass, once that container has been recreated on the current image. */
async function pruneOldImages() {
  const current = imageName()
  const output = await run('docker', ['image', 'ls', 'clauide-vscode', '--format', '{{.Repository}}:{{.Tag}}']).catch(
    () => ''
  )
  for (const tag of output.split('\n').map((line) => line.trim()).filter(Boolean)) {
    if (tag !== current) await run('docker', ['rmi', tag]).catch(() => {})
  }
}

/** Builds the base image from the bundled Dockerfile if missing. Deliberately re-checks every
 *  call (cheap) instead of trusting a cached "it exists" result forever — the image can be
 *  deleted externally (`docker rmi`) after the first check. Only the build itself is deduped,
 *  so concurrent session starts don't race into building it twice. */
async function ensureImage() {
  if (await imageExists()) return
  if (!imageBuildInFlight) {
    imageBuildInFlight = run('docker', ['build', '-t', imageName(), dockerfileDir()])
      .then(() => pruneOldImages())
      .finally(() => {
        imageBuildInFlight = null
      })
  }
  await imageBuildInFlight
}

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(storePath(), 'utf8'))
  } catch (err) {
    // A corrupt (not just missing) store would otherwise silently orphan every session's
    // container/volume — back it up so the data trail isn't lost even though we can't parse it.
    if (err.code !== 'ENOENT') {
      try {
        fs.copyFileSync(storePath(), `${storePath()}.corrupt-${Date.now()}`)
      } catch {}
    }
    return { nextNumber: 0, sessions: [] }
  }
}

function saveStore(store) {
  fs.writeFileSync(storePath(), JSON.stringify(store, null, 2))
}

async function resolvePort(containerId) {
  const stdout = await run('docker', ['port', containerId, '8080'])
  const match = stdout.trim().match(/:(\d+)$/)
  if (!match) throw new Error(`could not resolve published port for ${containerId}`)
  return Number(match[1])
}

async function waitReady(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`)
      if (res.status < 500) return
    } catch {
      // code-server not accepting connections yet
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`code-server on port ${port} did not become ready in time`)
}

async function containerStatus(containerId) {
  try {
    const stdout = await run('docker', ['inspect', '-f', '{{.State.Status}}', containerId])
    return stdout.trim()
  } catch {
    return null // doesn't exist
  }
}

/** `.State.Running` alone isn't enough — a paused container still reports Running: true, just
 *  frozen and unresponsive, so check the actual status string instead. */
async function isRunning(containerId) {
  return (await containerStatus(containerId)) === 'running'
}

async function volumeExists(volume) {
  return run('docker', ['volume', 'inspect', volume])
    .then(() => true)
    .catch(() => false)
}

/** A session's workspace files and its Claude Code state (conversation history, settings, skills)
 *  live in two named Docker volumes, independent of any one container's lifetime — everything
 *  else in the container's filesystem (e.g. ~/.claude.json) is disposable and gets regenerated
 *  from the image + host-authoritative sync on every recreate. Returns whether the workspace
 *  volume already existed — if it didn't (deleted externally, e.g. `docker volume rm`), Docker
 *  silently creates an empty one instead of erroring, so callers reconnecting to an existing
 *  session need this to detect and surface the data loss. */
async function startContainer(containerId, volume, claudeVolume) {
  await ensureImage()

  const status = await containerStatus(containerId)
  if (status === 'paused') {
    // The container object still holds this name — `docker run --name` would conflict with it,
    // and it isn't stopped, so just wake it back up instead of trying to recreate it.
    await run('docker', ['unpause', containerId])
    return { volumeExisted: true }
  }
  if (status) {
    // Some other stale state (exited, dead, ...) is still holding the name — clear it first.
    await run('docker', ['rm', '-f', containerId]).catch(() => {})
  }

  const existed = await volumeExists(volume)
  // Sessions created before the ~/.claude volume existed won't have this yet — `volume create`
  // is idempotent, so this doubles as the one-time migration for those.
  await run('docker', ['volume', 'create', claudeVolume])
  await run('docker', [
    'run',
    '-d',
    '--rm',
    '--name',
    containerId,
    '-p',
    '127.0.0.1::8080',
    '-v',
    `${volume}:/home/clauide/workspace`,
    '-v',
    `${claudeVolume}:/home/clauide/.claude`,
    imageName(),
    '--auth',
    'none',
    '/home/clauide/workspace'
  ])
  return { volumeExisted: existed }
}

function peekNextName() {
  const store = loadStore()
  return `Session ${store.nextNumber + 1}`
}

async function createSession() {
  const store = loadStore()
  store.nextNumber += 1
  const name = `Session ${store.nextNumber}`

  const id = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const containerId = `clauide-${id}`
  const volume = `clauide-vol-${id}`
  const claudeVolume = `clauide-claude-vol-${id}`

  await run('docker', ['volume', 'create', volume])
  await startContainer(containerId, volume, claudeVolume)

  const port = await resolvePort(containerId)
  await waitReady(port)

  store.sessions.push({ id, name, containerId, volume, claudeVolume })
  saveStore(store)

  return { id, name, port, containerId }
}

/** Called on app startup: reconnects to still-running containers, recreates stopped ones from their volume. */
async function listSessions() {
  const store = loadStore()
  const results = []
  let storeChanged = false

  for (const s of store.sessions) {
    if (!s.claudeVolume) {
      // Migrate sessions created before ~/.claude got its own volume.
      s.claudeVolume = `clauide-claude-vol-${s.id}`
      storeChanged = true
    }
    if (!(await isRunning(s.containerId))) {
      const result = await startContainer(s.containerId, s.volume, s.claudeVolume).catch(() => null)
      if (result && !result.volumeExisted && !s.name.startsWith('⚠')) {
        s.name = `⚠ ${s.name} (data lost)`
        storeChanged = true
      }
    }
    try {
      const port = await resolvePort(s.containerId)
      await waitReady(port)
      results.push({ id: s.id, name: s.name, port, containerId: s.containerId })
    } catch {
      // couldn't bring this one back up; leave it in the store in case a retry helps later
    }
  }

  if (storeChanged) saveStore(store)

  return results
}

/** Called when a session's webview fails to load (e.g. its container was stopped from outside
 *  the app while Clauide was open) — brings the container back up so the caller can retry. */
async function reconnectContainer(containerId) {
  const store = loadStore()
  const record = store.sessions.find((s) => s.containerId === containerId)
  if (!record) return { port: null }
  if (!record.claudeVolume) {
    record.claudeVolume = `clauide-claude-vol-${record.id}`
    saveStore(store)
  }
  if (!(await isRunning(containerId))) {
    await startContainer(containerId, record.volume, record.claudeVolume)
  }
  const port = await resolvePort(containerId)
  await waitReady(port)
  return { port }
}

function findIdByContainerId(containerId) {
  const record = loadStore().sessions.find((s) => s.containerId === containerId)
  return record ? record.id : null
}

function renameSession(id, name) {
  const store = loadStore()
  const record = store.sessions.find((s) => s.id === id)
  if (!record) return

  record.name = name
  saveStore(store)
}

async function removeSession(id) {
  const store = loadStore()
  const record = store.sessions.find((s) => s.id === id)
  if (!record) return

  store.sessions = store.sessions.filter((s) => s.id !== id)
  saveStore(store)

  await run('docker', ['rm', '-f', record.containerId]).catch(() => {})
  await run('docker', ['volume', 'rm', record.volume]).catch(() => {})
  if (record.claudeVolume) await run('docker', ['volume', 'rm', record.claudeVolume]).catch(() => {})
}

function listContainerIds() {
  return loadStore().sessions.map((s) => s.containerId)
}

module.exports = {
  createSession,
  peekNextName,
  listSessions,
  reconnectContainer,
  renameSession,
  removeSession,
  listContainerIds,
  findIdByContainerId,
  imageExists,
  ensureImage,
  isRunning
}
