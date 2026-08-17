const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')

const configPath = () => path.join(app.getPath('userData'), 'claude-config.json')

function get() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'))
  } catch {
    return { model: '', effort: '' }
  }
}

function save(input) {
  const config = { model: input.model || '', effort: input.effort || '' }
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2))
  return config
}

module.exports = { get, save }
