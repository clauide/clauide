const pty = require('node-pty')
const { execFile } = require('node:child_process')
const claudeConfig = require('./claudeConfig')

const sessions = new Map() // ptyId -> pty process

async function createPty(containerId, token, onData, onExit) {
  // A `docker exec` pty is a process inside the container, independent of our own process
  // tree — killing Clauide (especially via SIGKILL) doesn't kill it, so a prior run's `claude`
  // can be left running. Clear any leftovers before starting a new one to avoid pile-up.
  await new Promise((resolve) => execFile('docker', ['exec', containerId, 'pkill', '-x', 'claude'], resolve))

  const ptyId = `pty-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  // Claude Code's default "fullscreen" TUI draws on the terminal's alternate screen buffer (like
  // vim/htop) — fine in a full-width real terminal, but in our fixed 420px xterm.js panel it just
  // means flicker with no working native scrollback. This forces the classic renderer instead.
  const envArgs = [
    '-e',
    'CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1',
    ...(token ? ['-e', `CLAUDE_CODE_OAUTH_TOKEN=${token}`] : [])
  ]

  const { model, effort } = claudeConfig.get()
  const flags = [model && `--model ${model}`, effort && `--effort ${effort}`].filter(Boolean).join(' ')

  // `claude` lives in ~/.local/bin, which the native installer only adds to PATH via ~/.profile —
  // a login-shell file. `-i` (interactive) alone doesn't source it, so `claude` wouldn't resolve.
  // `--continue` resumes the most recent conversation for this directory — without it, every new
  // pty (e.g. from an app restart) would silently drop the previous conversation even though the
  // container/its history are both still there. Unlike what its name suggests, `claude --continue`
  // doesn't fall back gracefully — it exits immediately with "No conversation found to continue"
  // when there isn't one (e.g. a brand new session), which without the `||` fallback here sends
  // the auto-respawn-on-exit loop into an infinite crash loop.
  const claudeCmd = `claude --continue ${flags} || claude ${flags}`.replace(/\s+/g, ' ').trim()
  const proc = pty.spawn(
    'docker',
    ['exec', '-it', ...envArgs, '-w', '/home/clauide/workspace', containerId, 'bash', '-lc', claudeCmd],
    { name: 'xterm-256color', cols: 80, rows: 24 }
  )

  proc.onData((data) => onData(ptyId, data))
  proc.onExit((event) => onExit(ptyId, event))
  sessions.set(ptyId, proc)

  return ptyId
}

function writePty(ptyId, data) {
  sessions.get(ptyId)?.write(data)
}

function resizePty(ptyId, cols, rows) {
  sessions.get(ptyId)?.resize(cols, rows)
}

function disposePty(ptyId) {
  sessions.get(ptyId)?.kill()
  sessions.delete(ptyId)
}

module.exports = { createPty, writePty, resizePty, disposePty }
