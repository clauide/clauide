const sessions = require('./sessions')
const skills = require('./skills')
const mcp = require('./mcp')
const rules = require('./rules')
const extensions = require('./extensions')
const github = require('./github')
const lsp = require('./lsp')
const scripts = require('./scripts')

// Skills/MCP/rules/extensions/github/lsp are all "host-managed, mirrored into every container"
// resources — each module exposes the same syncToContainer(containerId) shape, so syncing them
// shares one error-logging helper instead of repeating the same try/catch per caller. Scripts ride
// the same shape but run user code, so they go last: by then the container has its git credentials,
// skills and MCP servers in place and a script can rely on them.
const syncables = { skills, mcp, rules, extensions, github, lsp, scripts }

async function syncEverywhere(name) {
  for (const containerId of sessions.listContainerIds()) {
    await syncables[name].syncToContainer(containerId).catch((err) => console.error(`[${name}] sync failed for`, containerId, err))
  }
}

async function syncAllEverywhere(containerId) {
  for (const name of Object.keys(syncables)) {
    await syncables[name].syncToContainer(containerId).catch((err) => console.error(`[${name}] sync failed for`, containerId, err))
  }
}

module.exports = { syncEverywhere, syncAllEverywhere }
