const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { app } = require('electron')

const storePath = () => path.join(app.getPath('userData'), 'extensions.json')

const run = (cmd, args) =>
  new Promise((resolve, reject) => execFile(cmd, args, (err, stdout) => (err ? reject(err) : resolve(stdout))))

function loadExtensions() {
  try {
    return JSON.parse(fs.readFileSync(storePath(), 'utf8'))
  } catch {
    return []
  }
}

function saveExtensions(extensions) {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true })
  fs.writeFileSync(storePath(), JSON.stringify(extensions, null, 2))
}

function listExtensions() {
  return loadExtensions().sort((a, b) => a.id.localeCompare(b.id))
}

function addExtension(input) {
  const extensions = loadExtensions()
  if (!extensions.some((e) => e.id === input.id)) {
    extensions.push({
      id: input.id,
      name: input.name || input.id,
      description: input.description || '',
      icon: input.icon || '',
      downloadCount: input.downloadCount || 0,
      enabled: true
    })
    saveExtensions(extensions)
  }
  return input.id
}

function deleteExtension(id) {
  saveExtensions(loadExtensions().filter((e) => e.id !== id))
}

function setEnabled(id, enabled) {
  const extensions = loadExtensions()
  const extension = extensions.find((e) => e.id === id)
  if (extension) {
    extension.enabled = enabled
    saveExtensions(extensions)
  }
}

/** Installs every enabled extension and uninstalls any disabled one that's still present —
 *  `code-server --install-extension` works standalone, it doesn't need the server running. */
async function syncToContainer(containerId) {
  for (const extension of loadExtensions()) {
    const args = extension.enabled
      ? ['exec', containerId, 'bash', '-lc', `code-server --install-extension ${extension.id} --force`]
      : ['exec', containerId, 'bash', '-lc', `code-server --uninstall-extension ${extension.id}`]
    await run('docker', args).catch(() => {})
  }
}

module.exports = { listExtensions, addExtension, deleteExtension, setEnabled, syncToContainer }
