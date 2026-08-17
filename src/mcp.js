const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { app } = require('electron')
const { PORT, getToken } = require('./bridgeConfig')

const CONTAINER_CLAUDE_JSON = '/home/clauide/.claude.json'

const storePath = () => path.join(app.getPath('userData'), 'mcp-servers.json')

const run = (cmd, args) =>
  new Promise((resolve, reject) => execFile(cmd, args, (err, stdout) => (err ? reject(err) : resolve(stdout))))

function pipeToFile(containerId, containerPath, content) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'docker',
      ['exec', '-i', containerId, 'sh', '-c', `mkdir -p "$(dirname '${containerPath}')" && cat > '${containerPath}'`],
      (err) => (err ? reject(err) : resolve())
    )
    child.stdin.end(content)
  })
}

function slugify(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function loadServers() {
  try {
    return JSON.parse(fs.readFileSync(storePath(), 'utf8'))
  } catch {
    return []
  }
}

function saveServers(servers) {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true })
  fs.writeFileSync(storePath(), JSON.stringify(servers, null, 2))
}

function listServers() {
  return loadServers().sort((a, b) => a.id.localeCompare(b.id))
}

function saveServer(input) {
  const servers = loadServers()
  const id = input.id || slugify(input.name)
  const server = { ...input, id }
  const index = servers.findIndex((s) => s.id === id)
  if (index === -1) servers.push(server)
  else servers[index] = server
  saveServers(servers)
  return id
}

function deleteServer(id) {
  saveServers(loadServers().filter((s) => s.id !== id))
}

function setEnabled(id, enabled) {
  const servers = loadServers()
  const server = servers.find((s) => s.id === id)
  if (server) {
    server.enabled = enabled
    saveServers(servers)
  }
}

function toMcpConfig(server) {
  if (server.type === 'stdio') {
    return { type: 'stdio', command: server.command || '', args: server.args || [], env: server.env || {} }
  }
  return { type: server.type, url: server.url || '', headers: server.headers || {} }
}

/** Mirrors every configured server into one running container's ~/.claude.json, at the same
 *  top-level "user scope" key Claude Code itself uses — available regardless of which project
 *  the session has open. Disabling a server keeps its config but lists it in disabledMcpServers,
 *  matching how Claude Code's own toggle works rather than removing the entry. */
async function syncToContainer(containerId) {
  let config = {}
  try {
    config = JSON.parse(await run('docker', ['exec', containerId, 'cat', CONTAINER_CLAUDE_JSON]))
  } catch {
    config = {}
  }

  config.mcpServers = {}
  const disabled = []
  for (const server of loadServers()) {
    config.mcpServers[server.id] = toMcpConfig(server)
    if (server.enabled === false) disabled.push(server.id)
  }

  // Built-in server letting this container's Claude Code manage Clauide itself (sessions,
  // skills, MCP servers, rules, extensions) via the host bridge — see bridge.js.
  config.mcpServers.clauide = {
    type: 'stdio',
    command: 'node',
    args: ['/home/clauide/.clauide/mcp-server.js'],
    env: {
      CLAUIDE_API_URL: `http://host.docker.internal:${PORT}`,
      CLAUIDE_API_TOKEN: getToken(),
      CLAUIDE_CONTAINER_ID: containerId
    }
  }

  config.disabledMcpServers = disabled

  await pipeToFile(containerId, CONTAINER_CLAUDE_JSON, JSON.stringify(config, null, 2))
}

module.exports = { listServers, saveServer, deleteServer, setEnabled, syncToContainer }
