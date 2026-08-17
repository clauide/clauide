const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { app } = require('electron')

const MARKETPLACE_REPO = 'anthropics/claude-plugins-official'
const MARKETPLACE_NAME = 'claude-plugins-official'
const CONTAINER_SETTINGS_PATH = '/home/clauide/.claude/settings.json'

// Every LSP integration Anthropic ships in their official plugin marketplace — there's no
// listing API, so this mirrors the plugin names/descriptions from that marketplace's manifest.
const KNOWN_SERVERS = [
  { id: 'typescript-lsp', name: 'TypeScript / JavaScript' },
  { id: 'pyright-lsp', name: 'Python (Pyright)' },
  { id: 'gopls-lsp', name: 'Go' },
  { id: 'rust-analyzer-lsp', name: 'Rust' },
  { id: 'clangd-lsp', name: 'C / C++' },
  { id: 'jdtls-lsp', name: 'Java' },
  { id: 'csharp-lsp', name: 'C#' },
  { id: 'kotlin-lsp', name: 'Kotlin' },
  { id: 'swift-lsp', name: 'Swift' },
  { id: 'ruby-lsp', name: 'Ruby' },
  { id: 'php-lsp', name: 'PHP' },
  { id: 'lua-lsp', name: 'Lua' },
  { id: 'liquid-lsp', name: 'Shopify Liquid' }
]

const storePath = () => path.join(app.getPath('userData'), 'lsp-servers.json')

const run = (cmd, args) =>
  new Promise((resolve, reject) => execFile(cmd, args, (err, stdout) => (err ? reject(err) : resolve(stdout))))

// `claude` lives in ~/.local/bin, only on PATH in a login shell (see pty.js) — same reason every
// other exec into a container here goes through `bash -lc`.
const runClaude = (containerId, cmd) => run('docker', ['exec', containerId, 'bash', '-lc', cmd])

function loadEnabled() {
  try {
    return JSON.parse(fs.readFileSync(storePath(), 'utf8'))
  } catch {
    return {}
  }
}

function saveEnabled(map) {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true })
  fs.writeFileSync(storePath(), JSON.stringify(map, null, 2))
}

function listServers() {
  const enabled = loadEnabled()
  return KNOWN_SERVERS.map((s) => ({ ...s, enabled: enabled[s.id] === true }))
}

function setEnabled(id, isEnabled) {
  const enabled = loadEnabled()
  enabled[id] = isEnabled
  saveEnabled(enabled)
}

/** Installs every enabled language server plugin into one container (and uninstalls any disabled
 *  one that's still there) via Claude Code's own plugin CLI — its installed/enabled state already
 *  lives in ~/.claude/settings.json, which persists on the container's ~/.claude volume, so this
 *  only does real (slow, network) work the first time a given server is turned on for a session. */
async function syncToContainer(containerId) {
  const enabled = loadEnabled()
  const wantedIds = KNOWN_SERVERS.filter((s) => enabled[s.id]).map((s) => s.id)

  let settings = {}
  try {
    settings = JSON.parse(await runClaude(containerId, `cat ${CONTAINER_SETTINGS_PATH}`))
  } catch {
    settings = {}
  }

  const installedIds = Object.entries(settings.enabledPlugins || {})
    .filter(([, isEnabled]) => isEnabled)
    .map(([key]) => key.split('@')[0])

  if (wantedIds.length === 0 && installedIds.length === 0) return

  if (!settings.extraKnownMarketplaces?.[MARKETPLACE_NAME]) {
    await runClaude(containerId, `claude plugin marketplace add ${MARKETPLACE_REPO}`).catch(() => {})
  }

  for (const id of wantedIds) {
    if (!installedIds.includes(id)) await runClaude(containerId, `claude plugin install ${id} -y`).catch(() => {})
  }
  for (const id of installedIds) {
    if (!wantedIds.includes(id) && KNOWN_SERVERS.some((s) => s.id === id)) {
      await runClaude(containerId, `claude plugin uninstall ${id}`).catch(() => {})
    }
  }
}

module.exports = { listServers, setEnabled, syncToContainer }
