const envList = document.getElementById('env-list')
const envKeyInput = document.getElementById('env-key')
const envValueInput = document.getElementById('env-value')
const envAddBtn = document.getElementById('env-add-btn')
const envError = document.getElementById('env-error')

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const MASK = '••••••••••'

function validateEnvForm() {
  const key = envKeyInput.value.trim()
  const valid = KEY_PATTERN.test(key) && envValueInput.value.length > 0
  envKeyInput.classList.toggle('invalid', key.length > 0 && !KEY_PATTERN.test(key))
  envAddBtn.disabled = !valid
  return valid
}

envKeyInput.addEventListener('input', validateEnvForm)
envValueInput.addEventListener('input', validateEnvForm)

async function renderEnvVars() {
  const keys = await window.clauide.listEnvVars()
  envList.innerHTML = ''
  envList.hidden = keys.length === 0

  for (const key of keys) {
    const row = document.createElement('div')
    row.className = 'env-row'
    row.innerHTML = `
      <span class="env-key">${key}</span>
      <span class="env-value">${MASK}</span>
      <button class="env-icon-btn env-reveal" title="Show value">👁</button>
      <button class="env-icon-btn env-delete" title="Delete">✕</button>
    `

    const value = row.querySelector('.env-value')
    const revealBtn = row.querySelector('.env-reveal')
    let shown = false

    // The value is fetched per click rather than kept alongside the row, so hiding it again really
    // does put it back out of the renderer's reach.
    revealBtn.addEventListener('click', async () => {
      shown = !shown
      if (!shown) {
        value.textContent = MASK
        value.classList.remove('revealed')
        revealBtn.title = 'Show value'
        return
      }
      value.textContent = await window.clauide.revealEnvVar(key)
      value.classList.add('revealed')
      revealBtn.title = 'Hide value'
    })

    row.querySelector('.env-delete').addEventListener('click', async () => {
      row.classList.add('syncing')
      await window.clauide.deleteEnvVar(key)
      renderEnvVars()
    })

    envList.appendChild(row)
  }
}

envAddBtn.addEventListener('click', async () => {
  if (!validateEnvForm()) return

  envAddBtn.disabled = true
  envAddBtn.classList.add('busy')
  envError.hidden = true

  try {
    await window.clauide.saveEnvVar(envKeyInput.value.trim(), envValueInput.value)
    envKeyInput.value = ''
    envValueInput.value = ''
    renderEnvVars()
  } catch (err) {
    envError.textContent = err.message
    envError.hidden = false
  } finally {
    envAddBtn.classList.remove('busy')
    validateEnvForm()
  }
})

envValueInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') envAddBtn.click()
})

window.clauide.onEnvChanged(renderEnvVars)
renderEnvVars()
