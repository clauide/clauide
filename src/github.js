const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { app, safeStorage } = require('electron')

const CONTAINER_TOKEN_PATH = '/home/clauide/.git-credentials-token'
const CONTAINER_GH_HOSTS_PATH = '/home/clauide/.config/gh/hosts.yml'

const authPath = () => path.join(app.getPath('userData'), 'github-auth.enc')

const run = (cmd, args) =>
  new Promise((resolve, reject) => execFile(cmd, args, (err, stdout) => (err ? reject(err) : resolve(stdout))))

function runWithInput(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, (err, stdout) => (err ? reject(err) : resolve(stdout)))
    child.stdin.end(input)
  })
}

function pipeToFile(containerId, containerPath, content) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'docker',
      ['exec', '-i', containerId, 'sh', '-c', `mkdir -p "$(dirname '${containerPath}')" && cat > '${containerPath}' && chmod 600 '${containerPath}'`],
      (err) => (err ? reject(err) : resolve())
    )
    child.stdin.end(content)
  })
}

function loadAuth() {
  try {
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(authPath())))
  } catch {
    return null
  }
}

function saveAuth(auth) {
  fs.mkdirSync(path.dirname(authPath()), { recursive: true })
  fs.writeFileSync(authPath(), safeStorage.encryptString(JSON.stringify(auth)))
}

function disconnect() {
  fs.rmSync(authPath(), { force: true })
}

function status() {
  const auth = loadAuth()
  return auth ? { connected: true, username: auth.username } : { connected: false }
}

async function fetchUser(token) {
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Clauide' }
  })
  if (!res.ok) throw new Error('Token rejected by GitHub')
  return res.json()
}

// If the user already has `gh` CLI logged in on their Mac, its token is a plain command away.
async function tokenFromGhCli() {
  try {
    return (await run('gh', ['auth', 'token'])).trim() || null
  } catch {
    return null
  }
}

// Otherwise fall back to whatever git's own credential store (Keychain on macOS) already has
// cached for github.com, e.g. from a prior `git clone https://...` on the host.
async function tokenFromGitCredentialStore() {
  try {
    const output = await runWithInput('git', ['credential', 'fill'], 'protocol=https\nhost=github.com\n\n')
    const match = output.match(/^password=(.*)$/m)
    return match ? match[1] : null
  } catch {
    return null
  }
}

async function connectFromHost() {
  const token = (await tokenFromGhCli()) || (await tokenFromGitCredentialStore())
  if (!token) throw new Error('No GitHub login found on this Mac — try gh auth login, or paste a token below')
  return connectWithToken(token)
}

async function connectWithToken(token) {
  const profile = await fetchUser(token)
  const email = profile.email || `${profile.id}+${profile.login}@users.noreply.github.com`
  saveAuth({ token, username: profile.login, email })
  return { username: profile.login }
}

/** Mirrors the host's GitHub token into one running container as (a) a git credential helper, so
 *  `git clone/push/pull` over HTTPS just works, and (b) a `gh` CLI auth file, so `gh pr create`
 *  etc. work with zero setup — neither ever exposes the raw token outside of those two files. */
async function syncToContainer(containerId) {
  const auth = loadAuth()
  if (!auth) return

  await pipeToFile(containerId, CONTAINER_TOKEN_PATH, auth.token)
  await run('docker', [
    'exec',
    containerId,
    'git',
    'config',
    '--global',
    'credential.helper',
    `!f() { echo username=x-access-token; echo password=$(cat ${CONTAINER_TOKEN_PATH}); }; f`
  ])
  await run('docker', ['exec', containerId, 'git', 'config', '--global', 'user.name', auth.username])
  await run('docker', ['exec', containerId, 'git', 'config', '--global', 'user.email', auth.email])

  const hostsYml = `github.com:\n    oauth_token: ${auth.token}\n    user: ${auth.username}\n    git_protocol: https\n`
  await pipeToFile(containerId, CONTAINER_GH_HOSTS_PATH, hostsYml)
}

module.exports = { status, disconnect, connectFromHost, connectWithToken, syncToContainer }
