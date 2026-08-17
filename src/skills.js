const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { app } = require('electron')

const CONTAINER_SKILLS_DIR = '/home/clauide/.claude/skills'
const CONTAINER_SETTINGS_PATH = '/home/clauide/.claude/settings.json'

const skillsDir = () => path.join(app.getPath('userData'), 'skills')
const enabledPath = () => path.join(skillsDir(), '.enabled.json')

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

function serialize(skill) {
  const lines = ['---', `name: ${skill.name}`, `description: ${skill.description || ''}`]
  if (skill.model) lines.push(`model: ${skill.model}`)
  if (skill.effort) lines.push(`effort: ${skill.effort}`)
  if (skill.fork) lines.push('context: fork')
  if (skill.autoInvoke === false) lines.push('disable-model-invocation: true')
  lines.push('---', '', skill.body || '')
  return lines.join('\n')
}

function parse(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { body: content }

  const fields = {}
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return { ...fields, body: match[2].replace(/^\n+/, '') }
}

function loadEnabled() {
  try {
    return JSON.parse(fs.readFileSync(enabledPath(), 'utf8'))
  } catch {
    return {}
  }
}

function saveEnabled(map) {
  fs.mkdirSync(skillsDir(), { recursive: true })
  fs.writeFileSync(enabledPath(), JSON.stringify(map, null, 2))
}

function listSkills() {
  const dir = skillsDir()
  if (!fs.existsSync(dir)) return []

  const enabled = loadEnabled()
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const file = path.join(dir, d.name, 'SKILL.md')
      if (!fs.existsSync(file)) return null
      const skill = parse(fs.readFileSync(file, 'utf8'))
      return {
        id: d.name,
        name: skill.name || d.name,
        description: skill.description || '',
        model: skill.model || '',
        effort: skill.effort || '',
        fork: skill.context === 'fork',
        autoInvoke: skill['disable-model-invocation'] !== 'true',
        body: skill.body || '',
        enabled: enabled[d.name] !== false
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name))
}

function saveSkill(input) {
  const id = input.id || slugify(input.name)
  const dir = path.join(skillsDir(), id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), serialize(input))

  const enabled = loadEnabled()
  enabled[id] = input.enabled !== false
  saveEnabled(enabled)

  return id
}

function deleteSkill(id) {
  fs.rmSync(path.join(skillsDir(), id), { recursive: true, force: true })
  const enabled = loadEnabled()
  delete enabled[id]
  saveEnabled(enabled)
}

function setEnabled(id, isEnabled) {
  const enabled = loadEnabled()
  enabled[id] = isEnabled
  saveEnabled(enabled)
}

function buildOverrides() {
  const enabled = loadEnabled()
  const overrides = {}
  for (const [id, isEnabled] of Object.entries(enabled)) {
    if (!isEnabled) overrides[id] = 'off'
  }
  return overrides
}

/** Mirrors the host's skills directory + on/off state into one running container. */
async function syncToContainer(containerId) {
  await run('docker', ['exec', containerId, 'rm', '-rf', CONTAINER_SKILLS_DIR]).catch(() => {})
  await run('docker', ['exec', containerId, 'mkdir', '-p', CONTAINER_SKILLS_DIR])

  const dir = skillsDir()
  if (fs.existsSync(dir)) {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      await run('docker', ['cp', path.join(dir, d.name), `${containerId}:${CONTAINER_SKILLS_DIR}/`]).catch(() => {})
    }
  }

  let settings = {}
  try {
    settings = JSON.parse(await run('docker', ['exec', containerId, 'cat', CONTAINER_SETTINGS_PATH]))
  } catch {
    settings = {}
  }
  settings.skillOverrides = buildOverrides()

  await pipeToFile(containerId, CONTAINER_SETTINGS_PATH, JSON.stringify(settings, null, 2))
}

module.exports = { listSkills, saveSkill, deleteSkill, setEnabled, syncToContainer }
