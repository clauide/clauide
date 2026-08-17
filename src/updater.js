const { app, shell } = require('electron')
const { autoUpdater } = require('electron-updater')
const windowRef = require('./windowRef')

const CHECK_INTERVAL_MS = 10 * 60 * 1000
const RELEASES_URL = 'https://github.com/clauide/clauide/releases/latest'

/** Squirrel.Mac only accepts an update whose signature matches the running app's, so both builds
 *  must be signed with the same certificate (scripts/create-signing-cert.sh makes a free
 *  self-signed one — a paid Developer ID is not required for this check to pass). When signing is
 *  missing or the download fails we fall back to pointing the user at the release page, so a
 *  broken auto-update path never leaves them stuck on an old version without knowing it. */
let pendingVersion = null

function start() {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} }

  autoUpdater.on('update-available', (info) => {
    pendingVersion = info.version
  })
  autoUpdater.on('update-downloaded', (info) => {
    windowRef.notify('update:ready', info.version)
  })
  autoUpdater.on('error', (err) => {
    log(err)
    if (pendingVersion) windowRef.notify('update:manual', pendingVersion)
  })

  autoUpdater.checkForUpdates()
  setInterval(() => autoUpdater.checkForUpdates(), CHECK_INTERVAL_MS)
}

function log(message) {
  console.log('[updater]', message)
}

function install() {
  autoUpdater.quitAndInstall()
}

function openReleases() {
  shell.openExternal(RELEASES_URL)
}

module.exports = { start, install, openReleases }
