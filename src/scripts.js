const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { app } = require('electron')
const windowRef = require('./windowRef')

const WORKDIR = '/home/clauide/workspace'
const MAX_OUTPUT = 10 * 1024 * 1024

const storePath = () => path.join(app.getPath('userData'), 'scripts.json')

// Keyed by containerId. Only ever holds the most recent run, which is all the session's "View
// output" button shows — scripts re-run whenever a container comes up, so nothing worth persisting
// across an app restart survives the containers it describes anyway.
const lastRuns = new Map()

function loadScripts() {
  try {
    return JSON.parse(fs.readFileSync(storePath(), 'utf8'))
  } catch {
    return []
  }
}

function saveScripts(scripts) {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true })
  fs.writeFileSync(storePath(), JSON.stringify(scripts, null, 2))
}

function listScripts() {
  return loadScripts()
}

function saveScript(input) {
  const scripts = loadScripts()
  const id = input.id || `sc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const existing = scripts.findIndex((s) => s.id === id)
  const script = {
    id,
    name: input.name,
    body: input.body || '',
    enabled: input.enabled !== false,
    continueOnError: input.continueOnError === true
  }

  if (existing === -1) scripts.push(script)
  else scripts[existing] = { ...scripts[existing], ...script }

  saveScripts(scripts)
  return id
}

function deleteScript(id) {
  saveScripts(loadScripts().filter((s) => s.id !== id))
}

function setEnabled(id, enabled) {
  const scripts = loadScripts()
  const script = scripts.find((s) => s.id === id)
  if (!script) return
  script.enabled = enabled
  saveScripts(scripts)
}

/** Array order is execution order, so reordering is what gives a script a dependency on the one
 *  before it (clone a repo, then install its dependencies). */
function moveScript(id, direction) {
  const scripts = loadScripts()
  const from = scripts.findIndex((s) => s.id === id)
  const to = from + (direction === 'up' ? -1 : 1)
  if (from === -1 || to < 0 || to >= scripts.length) return

  const [script] = scripts.splice(from, 1)
  scripts.splice(to, 0, script)
  saveScripts(scripts)
}

function lastRun(containerId) {
  return lastRuns.get(containerId) || []
}

function execScript(containerId, body) {
  return new Promise((resolve) => {
    const child = execFile(
      'docker',
      ['exec', '-i', '-w', WORKDIR, containerId, 'bash', '-s'],
      { maxBuffer: MAX_OUTPUT },
      (err, stdout, stderr) =>
        resolve({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, output: `${stdout}${stderr}`.trim() })
    )
    // Feeding the body over stdin rather than as an argument keeps quoting, newlines and length
    // limits out of the picture entirely — whatever the user typed is what bash reads.
    child.stdin.end(body)
  })
}

/** Runs every enabled script, in order, inside one container. Unlike the other syncables this is
 *  an action rather than mirrored state: it runs on each container start (including recreates,
 *  where anything installed outside the two volumes is gone) and the session is held back until it
 *  finishes, so nobody gets a session that looks ready while its setup is still running. */
async function syncToContainer(containerId) {
  const enabled = loadScripts().filter((s) => s.enabled)
  const results = []
  lastRuns.set(containerId, results)
  if (enabled.length === 0) return

  let halted = false
  for (const [index, script] of enabled.entries()) {
    if (halted) {
      results.push({ id: script.id, name: script.name, skipped: true })
      continue
    }

    windowRef.notify('scripts:progress', { containerId, name: script.name, index: index + 1, total: enabled.length })
    const { exitCode, output } = await execScript(containerId, script.body)
    results.push({ id: script.id, name: script.name, exitCode, output })

    if (exitCode !== 0 && !script.continueOnError) halted = true
  }

  windowRef.notify('scripts:done', { containerId, failed: results.some((r) => r.exitCode) })
}

module.exports = { listScripts, saveScript, deleteScript, setEnabled, moveScript, lastRun, syncToContainer }
