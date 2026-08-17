const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { app } = require('electron')

const CONTAINER_RULES_DIR = '/home/clauide/.claude/rules'

const rulesDir = () => path.join(app.getPath('userData'), 'rules')

const run = (cmd, args) =>
  new Promise((resolve, reject) => execFile(cmd, args, (err, stdout) => (err ? reject(err) : resolve(stdout))))

function slugify(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function serialize(rule) {
  const lines = []
  if (rule.paths && rule.paths.length > 0) {
    lines.push('---', 'paths:')
    for (const p of rule.paths) lines.push(`  - "${p}"`)
    lines.push('---', '')
  }
  lines.push(rule.body || '')
  return lines.join('\n')
}

function parse(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { paths: [], body: content }

  const paths = []
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('- ')) paths.push(trimmed.slice(2).replace(/^["']|["']$/g, ''))
  }
  return { paths, body: match[2].replace(/^\n+/, '') }
}

function listRules() {
  const dir = rulesDir()
  if (!fs.existsSync(dir)) return []

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const id = f.replace(/\.md$/, '')
      const { paths, body } = parse(fs.readFileSync(path.join(dir, f), 'utf8'))
      return { id, name: id, paths, body }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

function saveRule(input) {
  const id = input.id || slugify(input.name)
  fs.mkdirSync(rulesDir(), { recursive: true })
  fs.writeFileSync(path.join(rulesDir(), `${id}.md`), serialize(input))
  return id
}

function deleteRule(id) {
  fs.rmSync(path.join(rulesDir(), `${id}.md`), { force: true })
}

/** Mirrors every rule file into one running container's ~/.claude/rules/ — user-scoped rules
 *  apply to every session regardless of which files it opens. */
async function syncToContainer(containerId) {
  await run('docker', ['exec', containerId, 'rm', '-rf', CONTAINER_RULES_DIR]).catch(() => {})
  await run('docker', ['exec', containerId, 'mkdir', '-p', CONTAINER_RULES_DIR])

  const dir = rulesDir()
  if (!fs.existsSync(dir)) return

  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md')) continue
    await run('docker', ['cp', path.join(dir, f), `${containerId}:${CONTAINER_RULES_DIR}/${f}`]).catch(() => {})
  }
}

module.exports = { listRules, saveRule, deleteRule, syncToContainer }
