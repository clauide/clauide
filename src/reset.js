const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const sessions = require('./sessions')

/** electron-updater keeps downloaded builds beside userData rather than inside it, so wiping
 *  userData alone would leave a staged update behind for the relaunched app to install. */
const updaterCacheDir = () => path.join(app.getPath('appData'), 'Caches', 'clauide-updater')

function wipe(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true })
  }
}

/** Docker first — the session store names the containers and volumes, so it has to outlive them.
 *  Relaunching rather than staying open avoids a live renderer holding on to state that no longer
 *  exists on disk. */
async function resetEverything() {
  await sessions.destroyAll()

  wipe(app.getPath('userData'))
  fs.rmSync(updaterCacheDir(), { recursive: true, force: true })

  app.relaunch()
  app.exit(0)
}

module.exports = { resetEverything }
