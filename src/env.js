const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { app, safeStorage } = require('electron')

const CONTAINER_ENV_PATH = '/home/clauide/.clauide/env'
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

const storePath = () => path.join(app.getPath('userData'), 'claude-env.enc')

function loadVars() {
  try {
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(storePath())))
  } catch {
    return {}
  }
}

function saveVars(vars) {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true })
  fs.writeFileSync(storePath(), safeStorage.encryptString(JSON.stringify(vars)))
}

/** Only the names — the values stay in the main process until the UI asks for one by name, so a
 *  renderer that never reveals anything never holds a secret. */
function listKeys() {
  return Object.keys(loadVars()).sort()
}

function reveal(key) {
  return loadVars()[key] ?? null
}

function setVar(key, value) {
  if (!KEY_PATTERN.test(key)) throw new Error(`"${key}" is not a valid environment variable name`)
  const vars = loadVars()
  vars[key] = value
  saveVars(vars)
}

function deleteVar(key) {
  const vars = loadVars()
  delete vars[key]
  saveVars(vars)
}

// The file is sourced by a shell, so every value has to survive as a single-quoted literal —
// otherwise a space, a $ or a newline in an API key would be re-interpreted on the way in.
const quote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`

function serialize(vars) {
  return Object.entries(vars)
    .map(([key, value]) => `${key}=${quote(value)}`)
    .join('\n')
}

function pipeToFile(containerId, content) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'docker',
      [
        'exec',
        '-i',
        containerId,
        'sh',
        '-c',
        `mkdir -p "$(dirname '${CONTAINER_ENV_PATH}')" && cat > '${CONTAINER_ENV_PATH}' && chmod 600 '${CONTAINER_ENV_PATH}'`
      ],
      (err) => (err ? reject(err) : resolve())
    )
    child.stdin.end(content)
  })
}

/** Writes the variables into one running container as a file the shell startup files source, rather
 *  than passing them as `docker exec -e` flags: flags would put every secret in the host's process
 *  arguments, where any local `ps` can read them, and would only reach the one process we spawn —
 *  the file reaches the terminals opened inside VS Code too. */
async function syncToContainer(containerId) {
  await pipeToFile(containerId, serialize(loadVars()))
}

module.exports = { listKeys, reveal, setVar, deleteVar, syncToContainer }
