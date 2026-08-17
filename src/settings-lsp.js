const lspGrid = document.getElementById('lsp-grid')

async function renderLspServers() {
  const servers = await window.clauide.listLspServers()
  lspGrid.innerHTML = ''

  for (const server of servers) {
    const card = document.createElement('div')
    card.className = 'skill-card'
    card.innerHTML = `
      <div class="skill-card-header">
        <span class="skill-name">${server.name}</span>
        <label class="switch">
          <input type="checkbox" ${server.enabled ? 'checked' : ''} />
          <span class="switch-track"></span>
        </label>
      </div>
      <p class="skill-desc">Code intelligence — definitions, references, diagnostics — for every session.</p>
    `
    wireToggle(card, (checked) => window.clauide.setLspServerEnabled(server.id, checked))
    lspGrid.appendChild(card)
  }
}

window.clauide.onLspChanged(renderLspServers)
renderLspServers()
