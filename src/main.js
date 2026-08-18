const { app, BrowserWindow, ipcMain, safeStorage } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { execFile } = require('node:child_process')
const sessions = require('./sessions')
const skills = require('./skills')
const mcp = require('./mcp')
const rules = require('./rules')
const extensions = require('./extensions')
const github = require('./github')
const lsp = require('./lsp')
const claudeConfig = require('./claudeConfig')
const ptyManager = require('./pty')
const scripts = require('./scripts')
const bridge = require('./bridge')
const updater = require('./updater')
const reset = require('./reset')
const windowRef = require('./windowRef')
const { syncEverywhere, syncAllEverywhere } = require('./sync')

const tokenPath = () => path.join(app.getPath('userData'), 'token.enc')

function readToken() {
  try {
    return safeStorage.decryptString(fs.readFileSync(tokenPath()))
  } catch {
    return null
  }
}

let mainWindow = null
const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

/** Apps launched from Finder don't inherit the user's shell PATH, so `docker` (installed via
 *  OrbStack/Homebrew into a shell-rc-managed location) can be invisible to execFile. A single
 *  `$SHELL -ilc` probe isn't reliable across machines (custom prompts/rc plugins can hang it or
 *  corrupt its output), so try a few candidate PATHs and keep whichever one actually runs docker. */
function readShellPath(args) {
  return new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/zsh'
    const timer = setTimeout(() => resolve(null), 3000)
    execFile(shell, args, (err, stdout) => {
      clearTimeout(timer)
      const match = !err && stdout && stdout.match(/__PATH_START__(.*)__PATH_END__/)
      resolve(match ? match[1] : null)
    })
  })
}

function dockerWorksWith(pathValue) {
  return new Promise((resolve) => {
    execFile('docker', ['--version'], { env: { ...process.env, PATH: pathValue } }, (err) => resolve(!err))
  })
}

async function resolveDockerPath() {
  const echoCmd = 'echo "__PATH_START__$PATH__PATH_END__"'
  const home = require('node:os').homedir()

  const candidates = [
    process.env.PATH,
    await readShellPath(['-lc', echoCmd]),
    await readShellPath(['-ilc', echoCmd]),
    [process.env.PATH, `${home}/.orbstack/bin`, '/opt/homebrew/bin', '/usr/local/bin', `${home}/.docker/bin`].join(
      ':'
    )
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (await dockerWorksWith(candidate)) return candidate
  }
  return process.env.PATH
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 900,
    minHeight: 640,
    titleBarStyle: 'hiddenInset',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), webviewTag: true }
  })
  mainWindow.loadFile(path.join(__dirname, 'index.html'))
  mainWindow.webContents.on('console-message', (_e, _level, message) => console.log('[renderer]', message))
  windowRef.setMainWindow(mainWindow)
}

ipcMain.handle('docker:check', () => new Promise((resolve) => execFile('docker', ['info'], (err) => resolve(!err))))

ipcMain.handle('token:save', (_event, token) => {
  fs.writeFileSync(tokenPath(), safeStorage.encryptString(token))
})

ipcMain.handle('session:imageReady', () => sessions.imageExists())
ipcMain.handle('session:nextName', () => sessions.peekNextName())

ipcMain.handle('session:create', async () => {
  const session = await sessions.createSession()
  await syncAllEverywhere(session.containerId)
  return session
})

ipcMain.handle('session:list', async () => {
  const list = await sessions.listSessions()
  for (const s of list) await syncAllEverywhere(s.containerId)
  return list
})

// No windowRef.notify() here — the renderer already updates its own tab immediately after these
// resolve, and broadcasting too would race that (the tab's real id/containerId aren't wired up
// until its own attachWebview() runs, briefly after this handler returns). Only bridge.js (the
// MCP path, where nothing else tells the renderer) needs to broadcast session changes.
ipcMain.handle('session:rename', (_event, id, name) => sessions.renameSession(id, name))
ipcMain.handle('session:remove', (_event, id) => sessions.removeSession(id))
// Recreating drops the container's own filesystem, and only skills/rules/LSP live in the ~/.claude
// volume that survives it — the GitHub credentials, gh auth, MCP config (~/.claude.json sits beside
// the volume, not inside it) and code-server extensions all have to be pushed back in, or the
// session comes back looking intact while quietly unable to push, run gh, or reach any MCP server.
ipcMain.handle('session:reconnect', async (_event, containerId) => {
  const result = await sessions.reconnectContainer(containerId)
  await syncAllEverywhere(containerId)
  return result
})

ipcMain.handle('pty:create', (event, containerId) =>
  ptyManager.createPty(
    containerId,
    readToken(),
    (ptyId, data) => event.sender.send('pty:data', ptyId, data),
    (ptyId) => event.sender.send('pty:exit', ptyId)
  )
)
ipcMain.on('pty:write', (_event, ptyId, data) => ptyManager.writePty(ptyId, data))
ipcMain.on('pty:resize', (_event, ptyId, cols, rows) => ptyManager.resizePty(ptyId, cols, rows))
ipcMain.on('pty:dispose', (_event, ptyId) => ptyManager.disposePty(ptyId))

ipcMain.handle('skills:list', () => skills.listSkills())
ipcMain.handle('skills:save', async (_event, input) => {
  const id = skills.saveSkill(input)
  await syncEverywhere('skills')
  windowRef.notify('skills:changed')
  return id
})
ipcMain.handle('skills:delete', async (_event, id) => {
  skills.deleteSkill(id)
  await syncEverywhere('skills')
  windowRef.notify('skills:changed')
})
ipcMain.handle('skills:setEnabled', async (_event, id, enabled) => {
  skills.setEnabled(id, enabled)
  await syncEverywhere('skills')
  windowRef.notify('skills:changed')
})

ipcMain.handle('mcp:list', () => mcp.listServers())
ipcMain.handle('mcp:save', async (_event, input) => {
  const id = mcp.saveServer(input)
  await syncEverywhere('mcp')
  windowRef.notify('mcp:changed')
  return id
})
ipcMain.handle('mcp:delete', async (_event, id) => {
  mcp.deleteServer(id)
  await syncEverywhere('mcp')
  windowRef.notify('mcp:changed')
})
ipcMain.handle('mcp:setEnabled', async (_event, id, enabled) => {
  mcp.setEnabled(id, enabled)
  await syncEverywhere('mcp')
  windowRef.notify('mcp:changed')
})

ipcMain.handle('rules:list', () => rules.listRules())
ipcMain.handle('rules:save', async (_event, input) => {
  const id = rules.saveRule(input)
  await syncEverywhere('rules')
  windowRef.notify('rules:changed')
  return id
})
ipcMain.handle('rules:delete', async (_event, id) => {
  rules.deleteRule(id)
  await syncEverywhere('rules')
  windowRef.notify('rules:changed')
})

ipcMain.handle('extensions:list', () => extensions.listExtensions())
ipcMain.handle('extensions:add', async (_event, input) => {
  const id = extensions.addExtension(input)
  await syncEverywhere('extensions')
  windowRef.notify('extensions:changed')
  return id
})
ipcMain.handle('extensions:delete', async (_event, id) => {
  extensions.deleteExtension(id)
  await syncEverywhere('extensions')
  windowRef.notify('extensions:changed')
})
ipcMain.handle('extensions:setEnabled', async (_event, id, enabled) => {
  extensions.setEnabled(id, enabled)
  await syncEverywhere('extensions')
  windowRef.notify('extensions:changed')
})

ipcMain.handle('github:status', () => github.status())
ipcMain.handle('github:disconnect', () => github.disconnect())

ipcMain.handle('github:connectFromHost', async () => {
  const result = await github.connectFromHost()
  await syncEverywhere('github')
  return result
})

ipcMain.handle('github:connectWithToken', async (_event, token) => {
  const result = await github.connectWithToken(token)
  await syncEverywhere('github')
  return result
})

ipcMain.handle('claudeConfig:get', () => claudeConfig.get())
ipcMain.handle('claudeConfig:save', (_event, input) => claudeConfig.save(input))

// Saving a script deliberately does not sync: unlike the mirrored resources, a script is an action
// that belongs to a container coming up, and running it the moment someone edits the text would fire
// it against every open session with no warning.
ipcMain.handle('scripts:list', () => scripts.listScripts())
ipcMain.handle('scripts:save', (_event, input) => {
  const id = scripts.saveScript(input)
  windowRef.notify('scripts:changed')
  return id
})
ipcMain.handle('scripts:delete', (_event, id) => {
  scripts.deleteScript(id)
  windowRef.notify('scripts:changed')
})
ipcMain.handle('scripts:setEnabled', (_event, id, enabled) => {
  scripts.setEnabled(id, enabled)
  windowRef.notify('scripts:changed')
})
ipcMain.handle('scripts:move', (_event, id, direction) => {
  scripts.moveScript(id, direction)
  windowRef.notify('scripts:changed')
})
ipcMain.handle('scripts:lastRun', (_event, containerId) => scripts.lastRun(containerId))

ipcMain.on('update:install', () => updater.install())
ipcMain.on('update:openReleases', () => updater.openReleases())
ipcMain.handle('update:check', () => updater.check())

ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('app:reset', () => reset.resetEverything())

ipcMain.handle('lsp:list', () => lsp.listServers())
ipcMain.handle('lsp:setEnabled', async (_event, id, enabled) => {
  lsp.setEnabled(id, enabled)
  await syncEverywhere('lsp')
  windowRef.notify('lsp:changed')
})

/** A container can die out from under a running session (stopped/removed manually, OOM, etc.)
 *  without the webview ever attempting a new navigation, so did-fail-load alone can't catch it —
 *  poll and proactively reconnect+notify instead of waiting for a load that may never happen. */
setInterval(async () => {
  if (!mainWindow) return
  for (const containerId of sessions.listContainerIds()) {
    if (!(await sessions.isRunning(containerId))) mainWindow.webContents.send('session:down', containerId)
  }
}, 2000)

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    process.env.PATH = await resolveDockerPath()
    bridge.start()
    createWindow()
    updater.start()
    // An app update can ship a new Dockerfile, and the rebuild that follows takes minutes. Kicking
    // it off here (rather than awaiting it, or leaving it to the first session start) means it
    // overlaps with the user getting their bearings instead of blocking them.
    sessions.ensureImage().catch((err) => console.error('[image] build failed', err))
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
