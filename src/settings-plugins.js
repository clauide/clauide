const pluginsGrid = document.getElementById('plugins-grid')
const pluginsSearch = document.getElementById('plugins-search')
const marketplaceRepoInput = document.getElementById('marketplace-repo')
const marketplaceAddBtn = document.getElementById('marketplace-add-btn')
const pluginsError = document.getElementById('plugins-error')

let pluginsCache = []

marketplaceRepoInput.addEventListener('input', () => {
  marketplaceAddBtn.disabled = marketplaceRepoInput.value.trim().length === 0
})

function renderPluginCards() {
  const query = pluginsSearch.value.trim().toLowerCase()
  const matches = query
    ? pluginsCache.filter(
        (p) => p.name.toLowerCase().includes(query) || p.description.toLowerCase().includes(query) || p.category.toLowerCase().includes(query)
      )
    : pluginsCache

  // Enabled first, then alphabetical. Sorting happens per render rather than on toggle, so a card
  // does not jump out from under the cursor the moment it is switched on.
  const ordered = [...matches].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))

  if (matches.length === 0) {
    renderEmptyGrid(pluginsGrid, query ? 'No matches' : 'No plugins', query ? 'Try a different search.' : 'Add a marketplace to see plugins.')
    return
  }

  pluginsGrid.classList.remove('empty')
  pluginsGrid.innerHTML = ''

  // With a single marketplace configured the chip says the same thing on every card and costs a
  // whole row of card height, so it only earns its place once there is something to distinguish.
  const showMarketplace = new Set(pluginsCache.map((p) => p.marketplace)).size > 1

  for (const plugin of ordered) {
    const card = document.createElement('div')
    card.className = 'skill-card'
    card.innerHTML = `
      <div class="skill-card-header">
        <span class="skill-name">${plugin.name}</span>
        <label class="switch">
          <input type="checkbox" ${plugin.enabled ? 'checked' : ''} />
          <span class="switch-track"></span>
        </label>
      </div>
      <p class="skill-desc">${plugin.description}</p>
      <div class="skill-meta">
        ${plugin.category ? `<span class="skill-tag">${plugin.category}</span>` : ''}
        ${showMarketplace ? `<span class="skill-tag">${plugin.marketplace}</span>` : ''}
      </div>
    `

    // Turning one on installs it into every running session, which is a network round trip per
    // container — wireToggle already dims the card until that settles.
    wireToggle(card, async (checked) => {
      plugin.enabled = checked
      await window.clauide.setPluginEnabled(plugin.id, checked)
    })

    pluginsGrid.appendChild(card)
  }
}

async function loadPlugins() {
  renderEmptyGrid(pluginsGrid, 'Loading…', 'Reading the configured marketplaces.')
  const list = await window.clauide.listPlugins()

  const failed = list.filter((entry) => entry.error)
  if (failed.length > 0) {
    pluginsError.textContent = failed.map((entry) => `${entry.repo}: ${entry.error}`).join(' · ')
    pluginsError.hidden = false
  } else {
    pluginsError.hidden = true
  }

  pluginsCache = list.filter((entry) => !entry.error)
  renderPluginCards()
}

pluginsSearch.addEventListener('input', renderPluginCards)

marketplaceAddBtn.addEventListener('click', async () => {
  marketplaceAddBtn.disabled = true
  marketplaceAddBtn.classList.add('busy')
  pluginsError.hidden = true

  try {
    await window.clauide.addMarketplace(marketplaceRepoInput.value)
    marketplaceRepoInput.value = ''
    loadPlugins()
  } catch (err) {
    pluginsError.textContent = err.message
    pluginsError.hidden = false
  } finally {
    marketplaceAddBtn.classList.remove('busy')
    marketplaceAddBtn.disabled = marketplaceRepoInput.value.trim().length === 0
  }
})

marketplaceRepoInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') marketplaceAddBtn.click()
})

loadPlugins()
