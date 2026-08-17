const skillsGrid = document.getElementById('skills-grid')
const newSkillBtn = document.getElementById('new-skill-btn')
const skillModal = document.getElementById('skill-modal')
const skillNameInput = document.getElementById('skill-name')
const skillDescInput = document.getElementById('skill-description')
const skillModelInput = document.getElementById('skill-model')
const skillEffortInput = document.getElementById('skill-effort')
const skillForkInput = document.getElementById('skill-fork')
const skillAutoInvokeInput = document.getElementById('skill-auto-invoke')
const skillBodyInput = document.getElementById('skill-body')
const skillDeleteBtn = document.getElementById('skill-delete-btn')
const skillSaveBtn = document.getElementById('skill-save-btn')

let editingSkillId = null
let skillsCache = []

function validateSkillForm() {
  const name = skillNameInput.value.trim()
  const slug = slugify(name)
  const isDuplicate = skillsCache.some((s) => s.id === slug && s.id !== editingSkillId)

  skillNameInput.classList.toggle('invalid', name.length > 0 && isDuplicate)
  const valid = name.length > 0 && !isDuplicate
  skillSaveBtn.disabled = !valid
  return valid
}

skillNameInput.addEventListener('input', validateSkillForm)

async function renderSkills() {
  const skillsList = await window.clauide.listSkills()
  skillsCache = skillsList

  if (skillsList.length === 0) {
    renderEmptyGrid(skillsGrid, 'No skills yet', 'Create a skill to extend what Claude Code can do.')
    return
  }

  skillsGrid.classList.remove('empty')
  skillsGrid.innerHTML = ''

  for (const skill of skillsList) {
    const card = document.createElement('div')
    card.className = 'skill-card'
    card.innerHTML = `
      <div class="skill-card-header">
        <span class="skill-name">${skill.name}</span>
        <label class="switch">
          <input type="checkbox" ${skill.enabled ? 'checked' : ''} />
          <span class="switch-track"></span>
        </label>
      </div>
      <p class="skill-desc">${skill.description || ''}</p>
      <div class="skill-meta">
        <span class="skill-tag">Model: ${skill.model || 'inherit'}</span>
        <span class="skill-tag skill-tag-effort">Effort: ${skill.effort || 'inherit'}</span>
        ${skill.fork ? '<span class="skill-tag skill-tag-fork">Background</span>' : ''}
      </div>
    `

    wireToggle(card, (checked) => window.clauide.setSkillEnabled(skill.id, checked))
    card.addEventListener('click', () => openSkillModal(skill))
    skillsGrid.appendChild(card)
  }
}

function openSkillModal(skill) {
  editingSkillId = skill?.id || null
  skillNameInput.value = skill?.name || ''
  skillNameInput.classList.remove('invalid')
  skillDescInput.value = skill?.description || ''
  skillModelInput.value = skill?.model || ''
  skillEffortInput.value = skill?.effort || ''
  skillForkInput.checked = skill?.fork || false
  skillAutoInvokeInput.checked = skill?.autoInvoke !== false
  skillBodyInput.value = skill?.body || ''
  skillDeleteBtn.hidden = !skill
  skillModal.hidden = false
  validateSkillForm()
}

function closeSkillModal() {
  skillModal.hidden = true
}

closeOnBackdropClick(skillModal, closeSkillModal)
newSkillBtn.addEventListener('click', () => openSkillModal(null))
document.getElementById('skill-cancel-btn').addEventListener('click', closeSkillModal)

skillSaveBtn.addEventListener('click', async () => {
  if (!validateSkillForm()) return

  skillSaveBtn.disabled = true
  skillSaveBtn.textContent = 'Saving…'

  try {
    await window.clauide.saveSkill({
      id: editingSkillId,
      name: skillNameInput.value.trim(),
      description: skillDescInput.value.trim(),
      model: skillModelInput.value,
      effort: skillEffortInput.value,
      fork: skillForkInput.checked,
      autoInvoke: skillAutoInvokeInput.checked,
      body: skillBodyInput.value
    })

    closeSkillModal()
    renderSkills()
  } finally {
    skillSaveBtn.disabled = false
    skillSaveBtn.textContent = 'Save'
  }
})

skillDeleteBtn.addEventListener('click', async () => {
  if (!editingSkillId) return
  await window.clauide.deleteSkill(editingSkillId)
  closeSkillModal()
  renderSkills()
})

window.clauide.onSkillsChanged(renderSkills)
renderSkills()
