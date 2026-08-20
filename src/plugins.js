const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { app } = require('electron')
const sessions = require('./sessions')

const CONTAINER_SETTINGS_PATH = '/home/clauide/.claude/settings.json'
const OFFICIAL_REPO = 'anthropics/claude-plugins-official'
const MANIFEST_PATH = '.claude-plugin/marketplace.json'

const storePath = () => path.join(app.getPath('userData'), 'plugins.json')
const legacyLspPath = () => path.join(app.getPath('userData'), 'lsp-servers.json')

const run = (cmd, args) =>
  new Promise((resolve, reject) => execFile(cmd, args, (err, stdout) => (err ? reject(err) : resolve(stdout))))

// `claude` lives in ~/.local/bin, only on PATH in a login shell (see pty.js) — same reason every
// other exec into a container here goes through `bash -lc`.
const runClaude = (containerId, cmd) => run('docker', ['exec', containerId, 'bash', '-lc', cmd])

const manifestCache = new Map()

/** The language servers used to be their own hardcoded panel; they were always ordinary plugins in
 *  the official marketplace, so carry whichever ones a user had enabled over to their plugin ids —
 *  otherwise the first sync after upgrading would read them as unwanted and uninstall them. */
function migrateLegacyLsp() {
  let legacy
  try {
    legacy = JSON.parse(fs.readFileSync(legacyLspPath(), 'utf8'))
  } catch {
    return {}
  }

  const enabled = {}
  for (const [id, isEnabled] of Object.entries(legacy)) {
    if (isEnabled) enabled[`${id}@claude-plugins-official`] = true
  }
  return enabled
}

function loadStore() {
  try {
    const store = JSON.parse(fs.readFileSync(storePath(), 'utf8'))
    return { marketplaces: store.marketplaces || [], enabled: store.enabled || {} }
  } catch {
    return { marketplaces: [{ repo: OFFICIAL_REPO }], enabled: migrateLegacyLsp() }
  }
}

function saveStore(store) {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true })
  fs.writeFileSync(storePath(), JSON.stringify(store, null, 2))
}

async function fetchManifest(repo) {
  if (manifestCache.has(repo)) return manifestCache.get(repo)

  // Marketplaces are just git repos and GitHub never settled on one default branch name, so try
  // both rather than making the user care which one their repo uses.
  for (const ref of ['main', 'master']) {
    const res = await fetch(`https://raw.githubusercontent.com/${repo}/${ref}/${MANIFEST_PATH}`).catch(() => null)
    if (!res?.ok) continue
    const manifest = await res.json().catch(() => null)
    if (!manifest?.name) continue
    manifestCache.set(repo, manifest)
    return manifest
  }
  throw new Error(`No marketplace manifest found in ${repo}`)
}

/** Private marketplaces are the reason this exists: raw.githubusercontent.com will not serve their
 *  manifest, but a container can reach them, because github.js has already given it a token and a
 *  logged-in `gh`. Costs a running session and a couple of round trips, so it is only ever the
 *  fallback for a repo the direct fetch could not read. */
async function resolveViaContainer(repo) {
  const containerId = (await Promise.all(sessions.listContainerIds().map(async (id) => ((await sessions.isRunning(id)) ? id : null))))
    .filter(Boolean)[0]
  if (!containerId) return null

  await runClaude(containerId, `claude plugin marketplace add ${repo}`).catch(() => {})

  const configured = await runClaude(containerId, 'claude plugin marketplace list --json')
    .then((out) => JSON.parse(out))
    .catch(() => [])
  const match = configured.find((m) => m.repo === repo)
  if (!match) return null

  const listing = await runClaude(containerId, 'claude plugin list --available --json')
    .then((out) => JSON.parse(out))
    .catch(() => null)
  if (!listing) return null

  return {
    name: match.name,
    plugins: (listing.available || [])
      .filter((plugin) => plugin.marketplaceName === match.name)
      .map((plugin) => ({ name: plugin.name, description: plugin.description || '', category: '' }))
  }
}

async function resolveMarketplace(repo) {
  const manifest = await fetchManifest(repo).catch(() => null)
  if (manifest) return { name: manifest.name, plugins: manifest.plugins || [] }
  return resolveViaContainer(repo)
}

function listMarketplaces() {
  return loadStore().marketplaces
}

async function addMarketplace(repo) {
  const cleaned = repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '')
  if (!/^[\w.-]+\/[\w.-]+$/.test(cleaned)) throw new Error(`"${repo}" is not an owner/repo reference`)

  const resolved = await resolveMarketplace(cleaned)
  if (!resolved) throw new Error(`Could not read a marketplace from ${cleaned} — if it is private, open a session first`)

  const store = loadStore()
  if (!store.marketplaces.some((m) => m.repo === cleaned)) {
    store.marketplaces.push({ repo: cleaned })
    saveStore(store)
  }
  return { repo: cleaned, name: resolved.name }
}

function removeMarketplace(repo) {
  const store = loadStore()
  store.marketplaces = store.marketplaces.filter((m) => m.repo !== repo)
  saveStore(store)
}

/** Reads each marketplace over HTTPS where it can, so the panel fills in without a session running,
 *  and reports the ones it could not read rather than dropping them silently. */
async function listPlugins() {
  const { marketplaces, enabled } = loadStore()
  const results = []

  for (const marketplace of marketplaces) {
    const resolved = await resolveMarketplace(marketplace.repo).catch(() => null)
    if (!resolved) {
      results.push({
        repo: marketplace.repo,
        error: 'Could not read this marketplace — if it is private, open a session first'
      })
      continue
    }

    for (const plugin of resolved.plugins) {
      const id = `${plugin.name}@${resolved.name}`
      results.push({
        id,
        name: plugin.name,
        description: plugin.description || '',
        category: plugin.category || '',
        marketplace: resolved.name,
        repo: marketplace.repo,
        enabled: enabled[id] === true
      })
    }
  }

  return results
}

function setEnabled(id, isEnabled) {
  const store = loadStore()
  if (isEnabled) store.enabled[id] = true
  else delete store.enabled[id]
  saveStore(store)
}

/** Installs every enabled plugin into one container (and uninstalls any that were turned off) via
 *  Claude Code's own plugin CLI. Its installed state already lives in ~/.claude/settings.json,
 *  which sits on the container's ~/.claude volume, so this only does real (slow, network) work the
 *  first time a given plugin is turned on for a session. */
async function syncToContainer(containerId) {
  const { marketplaces, enabled } = loadStore()
  const wanted = Object.keys(enabled).filter((id) => enabled[id])

  let settings = {}
  try {
    settings = JSON.parse(await runClaude(containerId, `cat ${CONTAINER_SETTINGS_PATH}`))
  } catch {
    settings = {}
  }

  const installed = Object.entries(settings.enabledPlugins || {})
    .filter(([, isEnabled]) => isEnabled)
    .map(([id]) => id)

  if (wanted.length === 0 && installed.length === 0) return

  const known = settings.extraKnownMarketplaces || {}
  for (const marketplace of marketplaces) {
    const resolved = await resolveMarketplace(marketplace.repo).catch(() => null)
    if (resolved && !known[resolved.name]) {
      await runClaude(containerId, `claude plugin marketplace add ${marketplace.repo}`).catch(() => {})
    }
  }

  for (const id of wanted) {
    if (!installed.includes(id)) await runClaude(containerId, `claude plugin install ${id} -y`).catch(() => {})
  }

  // Only ever uninstall from marketplaces this app manages — a plugin someone installed by hand
  // inside their session is theirs, not ours to remove.
  const managed = new Set()
  for (const marketplace of marketplaces) {
    const resolved = await resolveMarketplace(marketplace.repo).catch(() => null)
    if (resolved) managed.add(resolved.name)
  }

  for (const id of installed) {
    if (!wanted.includes(id) && managed.has(id.split('@')[1])) {
      await runClaude(containerId, `claude plugin uninstall ${id}`).catch(() => {})
    }
  }
}

module.exports = { listMarketplaces, addMarketplace, removeMarketplace, listPlugins, setEnabled, syncToContainer }
