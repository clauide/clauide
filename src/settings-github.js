const githubDisconnectedEl = document.getElementById('github-disconnected')
const githubConnectedEl = document.getElementById('github-connected')
const githubError = document.getElementById('github-error')
const githubUsername = document.getElementById('github-username')
const githubImportBtn = document.getElementById('github-import-btn')
const githubPatInput = document.getElementById('github-pat-input')
const githubPatBtn = document.getElementById('github-pat-btn')
const githubDisconnectBtn = document.getElementById('github-disconnect-btn')

function showGithubError(message) {
  githubError.textContent = message
  githubError.hidden = false
}

async function renderGithubPanel() {
  githubError.hidden = true
  const status = await window.clauide.getGithubStatus()
  githubDisconnectedEl.hidden = status.connected
  githubConnectedEl.hidden = !status.connected
  if (status.connected) githubUsername.textContent = `Connected as ${status.username}`
}

githubImportBtn.addEventListener('click', async () => {
  githubImportBtn.disabled = true
  githubError.hidden = true
  try {
    await window.clauide.connectGithubFromHost()
    renderGithubPanel()
  } catch (err) {
    showGithubError(err.message)
  } finally {
    githubImportBtn.disabled = false
  }
})

githubPatBtn.addEventListener('click', async () => {
  const token = githubPatInput.value.trim()
  if (!token) return
  githubPatBtn.disabled = true
  githubError.hidden = true
  try {
    await window.clauide.connectGithubWithToken(token)
    githubPatInput.value = ''
    renderGithubPanel()
  } catch (err) {
    showGithubError(err.message)
  } finally {
    githubPatBtn.disabled = false
  }
})

githubDisconnectBtn.addEventListener('click', async () => {
  githubDisconnectBtn.disabled = true
  try {
    await window.clauide.disconnectGithub()
    renderGithubPanel()
  } finally {
    githubDisconnectBtn.disabled = false
  }
})

renderGithubPanel()
