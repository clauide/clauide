const claudeModelSelect = document.getElementById('claude-model')
const claudeEffortSelect = document.getElementById('claude-effort')
const claudeSaveBtn = document.getElementById('claude-save-btn')

let savedClaudeConfig = { model: '', effort: '' }

function updateClaudeSaveState() {
  const changed = claudeModelSelect.value !== savedClaudeConfig.model || claudeEffortSelect.value !== savedClaudeConfig.effort
  claudeSaveBtn.disabled = !changed
}

async function renderClaudeConfig() {
  const config = await window.clauide.getClaudeConfig()
  savedClaudeConfig = { model: config.model || '', effort: config.effort || '' }
  claudeModelSelect.value = savedClaudeConfig.model
  claudeEffortSelect.value = savedClaudeConfig.effort
  updateClaudeSaveState()
}

claudeModelSelect.addEventListener('change', updateClaudeSaveState)
claudeEffortSelect.addEventListener('change', updateClaudeSaveState)

claudeSaveBtn.addEventListener('click', async () => {
  claudeSaveBtn.disabled = true
  claudeSaveBtn.textContent = 'Saving…'
  try {
    savedClaudeConfig = await window.clauide.saveClaudeConfig({ model: claudeModelSelect.value, effort: claudeEffortSelect.value })
  } finally {
    claudeSaveBtn.textContent = 'Save'
    updateClaudeSaveState()
  }
})

renderClaudeConfig()
