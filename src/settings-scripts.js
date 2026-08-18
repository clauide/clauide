const scriptsGrid = document.getElementById('scripts-grid')
const newScriptBtn = document.getElementById('new-script-btn')
const scriptModal = document.getElementById('script-modal')
const scriptNameInput = document.getElementById('script-name')
const scriptBodyInput = document.getElementById('script-body')
const scriptContinueInput = document.getElementById('script-continue')
const scriptDeleteBtn = document.getElementById('script-delete-btn')
const scriptSaveBtn = document.getElementById('script-save-btn')

let editingScriptId = null

function validateScriptForm() {
  const valid = scriptNameInput.value.trim().length > 0
  scriptSaveBtn.disabled = !valid
  return valid
}

scriptNameInput.addEventListener('input', validateScriptForm)

async function renderScripts() {
  const scriptList = await window.clauide.listScripts()

  if (scriptList.length === 0) {
    renderEmptyGrid(scriptsGrid, 'No scripts yet', 'Prepare the workspace of every new session.')
    return
  }

  scriptsGrid.classList.remove('empty')
  scriptsGrid.innerHTML = ''

  scriptList.forEach((script, index) => {
    const card = document.createElement('div')
    card.className = 'skill-card'
    card.innerHTML = `
      <div class="skill-card-header">
        <span class="skill-name">${script.name}</span>
        <label class="switch">
          <input type="checkbox" ${script.enabled !== false ? 'checked' : ''} />
          <span class="switch-track"></span>
        </label>
      </div>
      <div class="skill-meta">
        ${script.continueOnError ? '<span class="skill-tag">continues on error</span>' : ''}
        <span class="script-order">
          <button class="script-move" data-direction="up" ${index === 0 ? 'disabled' : ''} title="Run earlier">▲</button>
          <button class="script-move" data-direction="down" ${index === scriptList.length - 1 ? 'disabled' : ''} title="Run later">▼</button>
        </span>
      </div>
    `

    wireToggle(card, (checked) => window.clauide.setScriptEnabled(script.id, checked))

    // Reordering shares the card with "open the editor", so the arrows have to stop the click
    // before it bubbles or every nudge would also pop the modal open.
    for (const button of card.querySelectorAll('.script-move')) {
      button.addEventListener('click', async (event) => {
        event.stopPropagation()
        await window.clauide.moveScript(script.id, button.dataset.direction)
        renderScripts()
      })
    }

    card.addEventListener('click', () => openScriptModal(script))
    scriptsGrid.appendChild(card)
  })
}

function openScriptModal(script) {
  editingScriptId = script?.id || null
  scriptNameInput.value = script?.name || ''
  scriptBodyInput.value = script?.body || ''
  scriptContinueInput.checked = script?.continueOnError === true
  scriptDeleteBtn.hidden = !script
  validateScriptForm()
  scriptModal.hidden = false
}

function closeScriptModal() {
  scriptModal.hidden = true
}

closeOnBackdropClick(scriptModal, closeScriptModal)
newScriptBtn.addEventListener('click', () => openScriptModal(null))
document.getElementById('script-cancel-btn').addEventListener('click', closeScriptModal)

scriptSaveBtn.addEventListener('click', async () => {
  if (!validateScriptForm()) return

  scriptSaveBtn.disabled = true
  scriptSaveBtn.textContent = 'Saving…'

  try {
    await window.clauide.saveScript({
      id: editingScriptId,
      name: scriptNameInput.value.trim(),
      body: scriptBodyInput.value,
      continueOnError: scriptContinueInput.checked
    })

    closeScriptModal()
    renderScripts()
  } finally {
    scriptSaveBtn.disabled = false
    scriptSaveBtn.textContent = 'Save'
  }
})

scriptDeleteBtn.addEventListener('click', async () => {
  if (!editingScriptId) return
  await window.clauide.deleteScript(editingScriptId)
  closeScriptModal()
  renderScripts()
})

window.clauide.onScriptsChanged(renderScripts)
renderScripts()
