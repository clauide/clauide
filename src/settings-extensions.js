const extensionsGrid = document.getElementById('extensions-grid')
const newExtensionBtn = document.getElementById('new-extension-btn')
const extensionModal = document.getElementById('extension-modal')
const extensionSearchInput = document.getElementById('extension-search')
const extensionResults = document.getElementById('extension-results')
const extensionSelected = document.getElementById('extension-selected')
const extensionSelectedName = document.getElementById('extension-selected-name')
const extensionSelectedId = document.getElementById('extension-selected-id')
const extensionDeleteBtn = document.getElementById('extension-delete-btn')

let editingExtensionId = null
let extensionSearchTimer = null

function formatCount(n) {
  return new Intl.NumberFormat('en', { notation: 'compact' }).format(n)
}

async function renderExtensions() {
  const extensionList = await window.clauide.listExtensions()

  if (extensionList.length === 0) {
    renderEmptyGrid(extensionsGrid, 'No extensions yet', 'Add VS Code extensions for every session.')
    return
  }

  extensionsGrid.classList.remove('empty')
  extensionsGrid.innerHTML = ''

  for (const extension of extensionList) {
    const card = document.createElement('div')
    card.className = 'skill-card'
    card.innerHTML = `
      <div class="skill-card-header">
        <div class="extension-card-title">
          ${extension.icon ? `<img class="extension-result-icon" src="${extension.icon}" onerror="this.remove()" />` : ''}
          <span class="skill-name">${extension.name}</span>
        </div>
        <label class="switch">
          <input type="checkbox" ${extension.enabled !== false ? 'checked' : ''} />
          <span class="switch-track"></span>
        </label>
      </div>
      <p class="skill-desc">${extension.description || ''}</p>
      <div class="skill-meta">
        <span class="skill-tag">${extension.id}</span>
        ${extension.downloadCount ? `<span class="skill-tag skill-tag-fork">${formatCount(extension.downloadCount)} installs</span>` : ''}
      </div>
    `

    wireToggle(card, (checked) => window.clauide.setExtensionEnabled(extension.id, checked))
    card.addEventListener('click', () => openExtensionDetail(extension))
    extensionsGrid.appendChild(card)
  }
}

function openExtensionDetail(extension) {
  editingExtensionId = extension.id
  extensionSearchInput.hidden = true
  extensionResults.innerHTML = ''
  extensionSelectedName.textContent = extension.name
  extensionSelectedId.textContent = extension.id
  extensionSelected.hidden = false
  extensionDeleteBtn.hidden = false
  extensionModal.hidden = false
}

function openExtensionSearch() {
  editingExtensionId = null
  extensionSearchInput.hidden = false
  extensionSearchInput.value = ''
  extensionResults.innerHTML = ''
  extensionSelected.hidden = true
  extensionDeleteBtn.hidden = true
  extensionModal.hidden = false
  extensionSearchInput.focus()
}

function closeExtensionModal() {
  extensionModal.hidden = true
}

closeOnBackdropClick(extensionModal, closeExtensionModal)
newExtensionBtn.addEventListener('click', openExtensionSearch)
document.getElementById('extension-cancel-btn').addEventListener('click', closeExtensionModal)

extensionDeleteBtn.addEventListener('click', async () => {
  if (!editingExtensionId) return
  extensionDeleteBtn.disabled = true
  extensionDeleteBtn.textContent = 'Removing…'
  try {
    await window.clauide.deleteExtension(editingExtensionId)
    closeExtensionModal()
    renderExtensions()
  } finally {
    extensionDeleteBtn.disabled = false
    extensionDeleteBtn.textContent = 'Remove'
  }
})

async function searchExtensions(query) {
  let results = []
  try {
    const res = await fetch(`https://open-vsx.org/api/-/search?query=${encodeURIComponent(query)}&size=10`)
    const data = await res.json()
    results = data.extensions || []
  } catch {
    extensionResults.innerHTML = '<p class="empty-state-text">Search failed — check your connection.</p>'
    return
  }

  if (results.length === 0) {
    extensionResults.innerHTML = '<p class="empty-state-text">No results.</p>'
    return
  }

  extensionResults.innerHTML = ''
  for (const result of results) {
    const id = `${result.namespace}.${result.name}`
    const name = result.displayName || result.name
    const description = result.description || ''
    const icon = result.files?.icon
    const downloadCount = result.downloadCount || 0

    const item = document.createElement('div')
    item.className = 'extension-result-item'
    item.innerHTML = `
      ${icon ? `<img class="extension-result-icon" src="${icon}" onerror="this.remove()" />` : ''}
      <div class="extension-result-text">
        <div class="extension-result-name">${name}</div>
        <div class="extension-result-id">${id} · ${formatCount(downloadCount)} installs</div>
      </div>
    `
    item.addEventListener('click', async () => {
      extensionSearchInput.disabled = true
      extensionResults.innerHTML = `
        <div class="extension-installing">
          <div class="spinner"></div>
          <p class="empty-state-text">Installing ${name}…</p>
        </div>
      `
      try {
        await window.clauide.addExtension({ id, name, description, icon, downloadCount })
        closeExtensionModal()
        renderExtensions()
      } finally {
        extensionSearchInput.disabled = false
      }
    })
    extensionResults.appendChild(item)
  }
}

extensionSearchInput.addEventListener('input', () => {
  clearTimeout(extensionSearchTimer)
  const query = extensionSearchInput.value.trim()
  if (!query) {
    extensionResults.innerHTML = ''
    return
  }
  extensionSearchTimer = setTimeout(() => searchExtensions(query), 300)
})

window.clauide.onExtensionsChanged(renderExtensions)
renderExtensions()
