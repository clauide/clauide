const clauideVersion = document.getElementById('clauide-version')
const clauideUpdateStatus = document.getElementById('clauide-update-status')
const clauideCheckBtn = document.getElementById('clauide-check-btn')
const clauideResetBtn = document.getElementById('clauide-reset-btn')

const UPDATE_IDLE_TEXT = clauideUpdateStatus.textContent

window.clauide.getVersion().then((version) => {
  clauideVersion.textContent = version
})

// The download continues in the background after this resolves — the update toast is what
// announces it is ready, so this only has to report what the check itself found.
clauideCheckBtn.addEventListener('click', async () => {
  clauideCheckBtn.disabled = true
  clauideCheckBtn.classList.add('busy')
  clauideCheckBtn.textContent = 'Checking…'
  try {
    const result = await window.clauide.checkForUpdates()
    if (result.status === 'available') clauideUpdateStatus.textContent = `Version ${result.version} is downloading…`
    else if (result.status === 'error') clauideUpdateStatus.textContent = `Could not check for updates — ${result.message}`
    else if (result.status === 'dev') clauideUpdateStatus.textContent = 'Updates are disabled in development.'
    else clauideUpdateStatus.textContent = "You're up to date."
  } finally {
    clauideCheckBtn.classList.remove('busy')
    clauideCheckBtn.textContent = 'Check for Updates'
    clauideCheckBtn.disabled = false
  }
})

// Two clicks rather than a modal: the second click is the confirmation, and wandering off the
// button cancels it, so the destructive path can never be reached by one stray click.
let resetArmed = false

function disarmReset() {
  resetArmed = false
  clauideResetBtn.textContent = 'Reset Everything'
  clauideResetBtn.classList.remove('armed')
}

clauideResetBtn.addEventListener('mouseleave', () => {
  if (resetArmed) disarmReset()
})

clauideResetBtn.addEventListener('click', async () => {
  if (!resetArmed) {
    resetArmed = true
    clauideResetBtn.textContent = 'Click again to confirm'
    clauideResetBtn.classList.add('armed')
    return
  }

  disarmReset()
  clauideResetBtn.disabled = true
  clauideResetBtn.classList.add('busy')
  clauideResetBtn.textContent = 'Erasing…'
  try {
    // Resolves only if the relaunch never happens, so restoring the button is the error path.
    await window.clauide.resetEverything()
  } finally {
    clauideResetBtn.classList.remove('busy')
    clauideResetBtn.textContent = 'Reset Everything'
    clauideResetBtn.disabled = false
  }
})
