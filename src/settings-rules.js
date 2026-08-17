const rulesGrid = document.getElementById('rules-grid')
const newRuleBtn = document.getElementById('new-rule-btn')
const ruleModal = document.getElementById('rule-modal')
const ruleNameInput = document.getElementById('rule-name')
const rulePathsInput = document.getElementById('rule-paths')
const ruleBodyInput = document.getElementById('rule-body')
const ruleDeleteBtn = document.getElementById('rule-delete-btn')
const ruleSaveBtn = document.getElementById('rule-save-btn')

let editingRuleId = null
let rulesCache = []

function validateRuleForm() {
  const name = ruleNameInput.value.trim()
  const slug = slugify(name)
  const isDuplicate = rulesCache.some((r) => r.id === slug && r.id !== editingRuleId)

  ruleNameInput.classList.toggle('invalid', name.length > 0 && isDuplicate)
  const valid = name.length > 0 && !isDuplicate
  ruleSaveBtn.disabled = !valid
  return valid
}

ruleNameInput.addEventListener('input', validateRuleForm)

async function renderRules() {
  const ruleList = await window.clauide.listRules()
  rulesCache = ruleList

  if (ruleList.length === 0) {
    renderEmptyGrid(rulesGrid, 'No rules yet', 'Give Claude Code standing instructions.')
    return
  }

  rulesGrid.classList.remove('empty')
  rulesGrid.innerHTML = ''

  for (const rule of ruleList) {
    const card = document.createElement('div')
    card.className = 'skill-card'
    card.innerHTML = `
      <div class="skill-card-header">
        <span class="skill-name">${rule.name}</span>
      </div>
      <div class="skill-meta">
        <span class="skill-tag">${rule.paths.length > 0 ? rule.paths.join(', ') : 'All files'}</span>
      </div>
    `

    card.addEventListener('click', () => openRuleModal(rule))
    rulesGrid.appendChild(card)
  }
}

function openRuleModal(rule) {
  editingRuleId = rule?.id || null
  ruleNameInput.value = rule?.name || ''
  ruleNameInput.classList.remove('invalid')
  rulePathsInput.value = (rule?.paths || []).join(', ')
  ruleBodyInput.value = rule?.body || ''
  ruleDeleteBtn.hidden = !rule
  validateRuleForm()
  ruleModal.hidden = false
}

function closeRuleModal() {
  ruleModal.hidden = true
}

closeOnBackdropClick(ruleModal, closeRuleModal)
newRuleBtn.addEventListener('click', () => openRuleModal(null))
document.getElementById('rule-cancel-btn').addEventListener('click', closeRuleModal)

ruleSaveBtn.addEventListener('click', async () => {
  if (!validateRuleForm()) return

  ruleSaveBtn.disabled = true
  ruleSaveBtn.textContent = 'Saving…'

  try {
    await window.clauide.saveRule({
      id: editingRuleId,
      name: ruleNameInput.value.trim(),
      paths: rulePathsInput.value
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean),
      body: ruleBodyInput.value
    })

    closeRuleModal()
    renderRules()
  } finally {
    ruleSaveBtn.disabled = false
    ruleSaveBtn.textContent = 'Save'
  }
})

ruleDeleteBtn.addEventListener('click', async () => {
  if (!editingRuleId) return
  await window.clauide.deleteRule(editingRuleId)
  closeRuleModal()
  renderRules()
})

window.clauide.onRulesChanged(renderRules)
renderRules()
