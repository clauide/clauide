// Shared handle to the (single) BrowserWindow so both the normal IPC handlers in main.js and the
// bridge.js HTTP routes (used by the "clauide" MCP server running inside containers) can tell the
// renderer to refresh — otherwise a change made via the bridge (e.g. an MCP tool call) would never
// show up in the UI, since the renderer only ever re-fetches after its own local actions.
let mainWindow = null

function setMainWindow(win) {
  mainWindow = win
}

function notify(channel, ...args) {
  mainWindow?.webContents.send(channel, ...args)
}

module.exports = { setMainWindow, notify }
