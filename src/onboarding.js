const steps = [
  {
    type: 'welcome',
    tagline: 'Claude Code, fully isolated in a throwaway Docker container.',
    cards: [
      { title: 'Isolated', text: 'Every session gets its own throwaway container.' },
      { title: 'Untouched Mac', text: 'No file access, no installs on your machine.' },
      { title: 'Nvim + Claude', text: 'Editor and agent side by side, per session.' },
      { title: 'Multiple Sessions', text: 'Switch between isolated sessions instantly.' },
      { title: 'Zero Setup', text: 'Claude Code CLI comes pre-installed, ready to go.' },
      { title: 'Always Ephemeral', text: 'Remove a session and everything in it disappears.' }
    ]
  },
  { type: 'docker' },
  { type: 'token' },
  { type: 'github' }
]

// Guards against an IPC call that never settles (e.g. a hidden OS permission prompt stealing
// focus) leaving a step's button disabled forever with no way for the user to recover.
function withTimeout(promise, ms, message) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))])
}

const root = document.getElementById('onboarding')
const app = document.getElementById('app')
let step = 0

function render() {
  const type = steps[step].type
  if (type === 'docker') return renderDocker()
  if (type === 'token') return renderToken()
  if (type === 'github') return renderGithub()
  renderWelcome()
}

function renderWelcome() {
  const { tagline, cards } = steps[step]
  const last = step === steps.length - 1

  root.innerHTML = `
    <div class="header">
      <h1>Clauide</h1>
      <p>${tagline}</p>
    </div>
    <div class="cards">${cards.map((c) => `<div class="card"><h3>${c.title}</h3><p>${c.text}</p></div>`).join('')}</div>
    <button>${last ? 'Finish' : 'Next'}</button>
  `

  root.querySelector('button').onclick = () => (last ? finish() : (step++, render()))
}

async function renderDocker() {
  const last = step === steps.length - 1

  root.innerHTML = `
    <div class="header">
      <h1>Docker Check</h1>
      <p>Clauide runs every session in an isolated Docker container.</p>
    </div>
    <div class="status">
      <div class="status-dot pending"></div>
      <div class="status-message"><p class="status-text">Checking for Docker…</p></div>
    </div>
    <button disabled>${last ? 'Finish' : 'Next'}</button>
  `

  const ok = await window.clauide.checkDocker()
  const dot = root.querySelector('.status-dot')
  const message = root.querySelector('.status-message')
  const button = root.querySelector('button')
  button.disabled = false

  if (ok) {
    dot.className = 'status-dot ok'
    message.innerHTML = '<p class="status-text">Docker is ready.</p>'
    button.textContent = last ? 'Finish' : 'Next'
    button.onclick = () => (last ? finish() : (step++, render()))
    return
  }

  dot.className = 'status-dot fail'
  message.innerHTML = '<p class="status-text">Docker not ready.</p><p class="status-text">You can open or install OrbStack.</p>'
  button.textContent = 'Retry'
  button.onclick = renderDocker
}

function renderToken() {
  const last = step === steps.length - 1

  root.innerHTML = `
    <div class="header">
      <h1>Claude Token</h1>
      <p>Run the following command in your terminal:</p>
    </div>
    <div class="content">
      <div class="cmd-box">
        <code>claude setup-token</code>
        <button class="copy-btn" type="button">Copy</button>
      </div>
      <div class="token-box">
        <input type="password" id="token-input" placeholder="Paste your token" />
      </div>
      <p class="status-text token-status" hidden></p>
    </div>
    <button id="next-btn" disabled>${last ? 'Finish' : 'Next'}</button>
  `

  root.querySelector('.copy-btn').onclick = (e) => {
    navigator.clipboard.writeText('claude setup-token')
    e.target.textContent = 'Copied'
    setTimeout(() => (e.target.textContent = 'Copy'), 1200)
  }

  const input = root.querySelector('#token-input')
  const button = root.querySelector('#next-btn')
  const status = root.querySelector('.token-status')

  input.addEventListener('input', () => {
    button.disabled = input.value.trim().length === 0
  })

  button.onclick = async () => {
    button.disabled = true
    status.hidden = true
    try {
      await withTimeout(window.clauide.saveToken(input.value.trim()), 8000, 'Saving the token timed out — try again')
      last ? finish() : (step++, render())
    } catch (err) {
      status.textContent = err.message
      status.hidden = false
      button.disabled = false
    }
  }
}

function renderGithub() {
  const last = step === steps.length - 1

  root.innerHTML = `
    <div class="header">
      <h1>GitHub</h1>
      <p>Optional — lets every session clone, push and pull over HTTPS.</p>
    </div>
    <div class="content">
      <button class="github-import-btn" type="button">Import from this Mac</button>
      <p class="status-text github-status" hidden></p>
      <div class="github-pat-section">
        <div class="github-pat-row">
          <input type="text" id="github-pat-input" placeholder="or paste a token (ghp_...)" />
          <button class="copy-btn" id="github-pat-btn" type="button">Save</button>
        </div>
        <p class="github-pat-hint">GitHub → Settings → Developer settings → Personal access tokens, scope: repo</p>
      </div>
    </div>
    <button id="next-btn">${last ? 'Finish' : 'Next'}</button>
  `

  const importBtn = root.querySelector('.github-import-btn')
  const status = root.querySelector('.github-status')
  const patSection = root.querySelector('.github-pat-section')
  const input = root.querySelector('#github-pat-input')
  const patBtn = root.querySelector('#github-pat-btn')
  const nextBtn = root.querySelector('#next-btn')

  function showStatus(text) {
    status.textContent = text
    status.hidden = false
  }

  function connected(username) {
    showStatus(`Connected as ${username}`)
    patSection.hidden = true
  }

  importBtn.onclick = async () => {
    importBtn.disabled = true
    try {
      const { username } = await withTimeout(window.clauide.connectGithubFromHost(), 8000, 'Timed out — try again')
      connected(username)
    } catch (err) {
      showStatus(err.message)
    } finally {
      importBtn.disabled = false
    }
  }

  patBtn.onclick = async () => {
    const token = input.value.trim()
    if (!token) return
    patBtn.disabled = true
    try {
      const { username } = await withTimeout(window.clauide.connectGithubWithToken(token), 8000, 'Timed out — try again')
      connected(username)
    } catch (err) {
      showStatus(err.message)
    } finally {
      patBtn.disabled = false
    }
  }

  nextBtn.onclick = () => (last ? finish() : (step++, render()))
}

function finish() {
  localStorage.setItem('clauide.onboarded', '1')
  root.hidden = true
  app.hidden = false
}

localStorage.getItem('clauide.onboarded') ? finish() : render()
