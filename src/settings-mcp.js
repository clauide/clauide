const mcpGrid = document.getElementById('mcp-grid')
const newMcpBtn = document.getElementById('new-mcp-btn')
const mcpModal = document.getElementById('mcp-modal')
const mcpNameInput = document.getElementById('mcp-name')
const mcpTypeInput = document.getElementById('mcp-type')
const mcpUrlInput = document.getElementById('mcp-url')
const mcpHeadersInput = document.getElementById('mcp-headers')
const mcpCommandInput = document.getElementById('mcp-command')
const mcpArgsInput = document.getElementById('mcp-args')
const mcpEnvInput = document.getElementById('mcp-env')
const mcpRemoteFields = document.getElementById('mcp-remote-fields')
const mcpStdioFields = document.getElementById('mcp-stdio-fields')
const mcpDeleteBtn = document.getElementById('mcp-delete-btn')
const mcpSaveBtn = document.getElementById('mcp-save-btn')

let editingMcpId = null
let mcpServersCache = []

function parseLines(text, separator) {
  const result = {}
  for (const line of text.split('\n')) {
    const idx = line.indexOf(separator)
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + separator.length).trim()
    if (key) result[key] = value
  }
  return result
}

function formatLines(obj, separator) {
  return Object.entries(obj || {})
    .map(([key, value]) => `${key}${separator} ${value}`)
    .join('\n')
}

function validateMcpForm() {
  const name = mcpNameInput.value.trim()
  const slug = slugify(name)
  const isDuplicate = mcpServersCache.some((s) => s.id === slug && s.id !== editingMcpId)
  const isStdio = mcpTypeInput.value === 'stdio'
  const requiredField = isStdio ? mcpCommandInput : mcpUrlInput
  const requiredFilled = requiredField.value.trim().length > 0

  mcpNameInput.classList.toggle('invalid', name.length > 0 && isDuplicate)
  requiredField.classList.toggle('invalid', name.length > 0 && !requiredFilled)
  ;(isStdio ? mcpUrlInput : mcpCommandInput).classList.remove('invalid')

  const valid = name.length > 0 && !isDuplicate && requiredFilled
  mcpSaveBtn.disabled = !valid
  return valid
}

mcpNameInput.addEventListener('input', validateMcpForm)
mcpUrlInput.addEventListener('input', validateMcpForm)
mcpCommandInput.addEventListener('input', validateMcpForm)

function updateMcpTypeFields() {
  const isStdio = mcpTypeInput.value === 'stdio'
  mcpStdioFields.hidden = !isStdio
  mcpRemoteFields.hidden = isStdio
}

mcpTypeInput.addEventListener('change', () => {
  updateMcpTypeFields()
  validateMcpForm()
})

async function renderMcpServers() {
  const servers = await window.clauide.listMcpServers()
  mcpServersCache = servers

  if (servers.length === 0) {
    renderEmptyGrid(mcpGrid, 'No MCP servers yet', 'Connect Claude Code to external tools.')
    return
  }

  mcpGrid.classList.remove('empty')
  mcpGrid.innerHTML = ''

  for (const server of servers) {
    const card = document.createElement('div')
    card.className = 'skill-card'
    card.innerHTML = `
      <div class="skill-card-header">
        <span class="skill-name">${server.name || server.id}</span>
        <label class="switch">
          <input type="checkbox" ${server.enabled !== false ? 'checked' : ''} />
          <span class="switch-track"></span>
        </label>
      </div>
      <div class="skill-meta">
        <span class="skill-tag">${server.type}</span>
      </div>
    `

    wireToggle(card, (checked) => window.clauide.setMcpServerEnabled(server.id, checked))
    card.addEventListener('click', () => openMcpModal(server))
    mcpGrid.appendChild(card)
  }
}

function openMcpModal(server) {
  editingMcpId = server?.id || null
  mcpNameInput.value = server?.name || ''
  mcpNameInput.classList.remove('invalid')
  mcpTypeInput.value = server?.type || 'http'
  mcpUrlInput.value = server?.url || ''
  mcpUrlInput.classList.remove('invalid')
  mcpHeadersInput.value = formatLines(server?.headers, ':')
  mcpCommandInput.value = server?.command || ''
  mcpCommandInput.classList.remove('invalid')
  mcpArgsInput.value = (server?.args || []).join(' ')
  mcpEnvInput.value = formatLines(server?.env, '=')
  mcpDeleteBtn.hidden = !server
  updateMcpTypeFields()
  validateMcpForm()
  mcpModal.hidden = false
}

function closeMcpModal() {
  mcpModal.hidden = true
}

closeOnBackdropClick(mcpModal, closeMcpModal)
newMcpBtn.addEventListener('click', () => openMcpModal(null))
document.getElementById('mcp-cancel-btn').addEventListener('click', closeMcpModal)

mcpSaveBtn.addEventListener('click', async () => {
  if (!validateMcpForm()) return

  mcpSaveBtn.disabled = true
  mcpSaveBtn.textContent = 'Saving…'

  try {
    await window.clauide.saveMcpServer({
      id: editingMcpId,
      name: mcpNameInput.value.trim(),
      type: mcpTypeInput.value,
      url: mcpUrlInput.value.trim(),
      headers: parseLines(mcpHeadersInput.value, ':'),
      command: mcpCommandInput.value.trim(),
      args: mcpArgsInput.value.trim() ? mcpArgsInput.value.trim().split(/\s+/) : [],
      env: parseLines(mcpEnvInput.value, '=')
    })

    closeMcpModal()
    renderMcpServers()
  } finally {
    mcpSaveBtn.disabled = false
    mcpSaveBtn.textContent = 'Save'
  }
})

mcpDeleteBtn.addEventListener('click', async () => {
  if (!editingMcpId) return
  await window.clauide.deleteMcpServer(editingMcpId)
  closeMcpModal()
  renderMcpServers()
})

window.clauide.onMcpChanged(renderMcpServers)
renderMcpServers()
