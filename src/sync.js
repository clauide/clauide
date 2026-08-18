const sessions = require('./sessions')
const skills = require('./skills')
const mcp = require('./mcp')
const rules = require('./rules')
const extensions = require('./extensions')
const github = require('./github')
const lsp = require('./lsp')
const env = require('./env')

// Skills/MCP/rules/extensions/github/lsp are all "host-managed, mirrored into every container"
// resources — each module exposes the same syncToContainer(containerId) shape, so syncing them
// shares one error-logging helper instead of repeating the same try/catch per caller. Setup scripts
// deliberately stay out of this map: they run once, when a session is created, not every time a
// container comes back up.
const syncables = { skills, mcp, rules, extensions, github, lsp, env }

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
