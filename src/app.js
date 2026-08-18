const tabbar = document.getElementById('tabbar')
const tabbarSpacer = document.getElementById('tabbar-spacer')
const list = document.getElementById('session-list')
const mainEl = document.getElementById('main')
const newBtn = document.getElementById('new-session-btn')
const settingsBtn = document.getElementById('settings-btn')
const settingsView = document.getElementById('settings-view')
const webviews = new Map() // sessionId -> element (either the <webview> or a loading placeholder)
const webviewsByContainerId = new Map() // containerId -> <webview>
const terminalsByPtyId = new Map() // ptyId -> xterm Terminal instance
const refsBySessionId = new Map() // sessionId -> the same ref object passed to attachHandlers/attachWebview

// ---------- Shared helpers used by the settings panels (skills/MCP/rules/extensions) ----------

function slugify(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function closeOnBackdropClick(modal, close) {
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close()
  })
}

function renderEmptyGrid(grid, title, text) {
  grid.classList.add('empty')
  grid.innerHTML = `
    <div class="empty-state">
      <p class="empty-state-title">${title}</p>
      <p class="empty-state-text">${text}</p>
    </div>
  `
}

/** Wires a card's enable/disable switch: stops the click from also opening the card, and dims
 *  the card while the (network-touching) toggle change is in flight. */
function wireToggle(card, onChange) {
  const toggle = card.querySelector('input')
  card.querySelector('.switch').addEventListener('click', (event) => event.stopPropagation())
  toggle.addEventListener('change', async (event) => {
    toggle.disabled = true
    card.classList.add('syncing')
    try {
      await onChange(event.target.checked)
    } finally {
      toggle.disabled = false
      card.classList.remove('syncing')
    }
  })
}

// ---------- Sessions ----------

// The main process polls container health and tells us if one died out from under a session
// (stopped/removed manually, OOM, etc.) — show an error instead of silently recreating it, since
// the user may have stopped it on purpose.
window.clauide.onSessionDown((containerId) => {
  const webview = webviewsByContainerId.get(containerId)
  if (webview) showSessionError(webview.closest('.session-pane'), webview, containerId)
})

// Scrolling over the tabbar's empty space (not just directly over a tab) should still scroll
// the session list horizontally, instead of only working when the cursor is precisely on a tab.
tabbar.addEventListener('wheel', (event) => {
  event.preventDefault()
  list.scrollLeft += event.deltaY !== 0 ? event.deltaY : event.deltaX
})

window.clauide.onPtyData((ptyId, data) => terminalsByPtyId.get(ptyId)?.term.write(data))
window.clauide.onPtyExit((ptyId) => {
  const entry = terminalsByPtyId.get(ptyId)
  if (!entry) return
  terminalsByPtyId.delete(ptyId)
  entry.term.writeln('\r\n[Claude Code exited — restarting…]')
  setTimeout(entry.respawn, 1000)
})

const mainEmpty = document.createElement('div')
mainEmpty.id = 'main-empty'
mainEmpty.className = 'main-overlay'
mainEmpty.hidden = true
mainEmpty.innerHTML = `
  <div class="empty-state">
    <p class="empty-state-title">No sessions yet</p>
    <p class="empty-state-text">Start your first isolated session.</p>
    <button id="empty-new-session-btn" class="overlay-btn">+ New Session</button>
  </div>
`
mainEl.appendChild(mainEmpty)
const emptyNewBtn = document.getElementById('empty-new-session-btn')

const dockerError = document.createElement('div')
dockerError.id = 'docker-error'
dockerError.className = 'main-overlay'
dockerError.hidden = true
dockerError.innerHTML = `
  <div class="empty-state">
    <p class="empty-state-title">Docker isn't running</p>
    <p class="empty-state-text">Start Docker or OrbStack, then retry.</p>
    <button id="docker-retry-btn" class="overlay-btn">Retry</button>
  </div>
`
mainEl.appendChild(dockerError)
document.getElementById('docker-retry-btn').addEventListener('click', restoreSessions)

const updateToast = document.createElement('div')
updateToast.id = 'update-toast'
updateToast.hidden = true
updateToast.innerHTML = `
  <p id="update-toast-text"></p>
  <button id="update-toast-action" class="overlay-btn"></button>
  <button id="update-toast-dismiss" title="Dismiss">✕</button>
`
document.body.appendChild(updateToast)

const updateToastText = document.getElementById('update-toast-text')
const updateToastAction = document.getElementById('update-toast-action')

function showUpdateToast(text, actionLabel, onAction) {
  updateToastText.textContent = text
  updateToastAction.textContent = actionLabel
  updateToastAction.onclick = onAction
  updateToast.hidden = false
}

document.getElementById('update-toast-dismiss').addEventListener('click', () => {
  updateToast.hidden = true
})

window.clauide.onUpdateReady((version) =>
  showUpdateToast(`Version ${version} is ready.`, 'Restart', () => window.clauide.installUpdate())
)
window.clauide.onUpdateManual((version) =>
  showUpdateToast(`Version ${version} is available.`, 'Download', () => window.clauide.openReleases())
)

// Covers the gap between "no pane/overlay is showing yet" and "we know whether there are
// sessions or not" — without it, #main briefly shows its bare background (a "gray flash") both
// on first launch (while listSessions() is still in flight) and when closing the last session
// (while its container/volume are still being torn down).
const mainLoading = document.createElement('div')
mainLoading.id = 'main-loading'
mainLoading.className = 'main-overlay'
mainLoading.innerHTML = '<div class="spinner"></div>'
mainEl.appendChild(mainLoading)

function updateEmptyState() {
  const empty = list.children.length === 0
  mainEmpty.hidden = !empty
  // The tabbar itself (settings gear, and "+ New Session") stays usable even with no sessions
  // and even while Settings is open — only the (empty anyway) session list is hidden.
  list.hidden = empty
}

function updateTabbarSettingsState() {
  tabbar.classList.toggle('settings-open', !settingsView.hidden)
}

settingsBtn.addEventListener('click', () => {
  const opening = settingsView.hidden
  settingsView.hidden = !opening
  mainEl.hidden = opening
  updateTabbarSettingsState()
})

document.querySelectorAll('.settings-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.settings-tab').forEach((el) => el.classList.remove('active'))
    tab.classList.add('active')
    document.querySelectorAll('.settings-panel').forEach((panel) => {
      panel.hidden = panel.id !== tab.dataset.panel
    })
  })
})

function selectItem(item, sessionId) {
  list.querySelectorAll('.session-item').forEach((el) => el.classList.remove('active'))
  item.classList.add('active')
  webviews.forEach((el, id) => {
    el.style.display = id === sessionId ? 'flex' : 'none'
  })
  settingsView.hidden = true
  mainEl.hidden = false
  updateTabbarSettingsState()
}

async function deleteItem(item, ref) {
  const wasActive = item.classList.contains('active')
  item.remove()
  webviews.get(ref.id)?.remove()
  webviews.delete(ref.id)
  refsBySessionId.delete(ref.id)
  ref.webview?.remove()
  if (ref.containerId) webviewsByContainerId.delete(ref.containerId)
  if (ref.ptyId) {
    terminalsByPtyId.delete(ref.ptyId)
    window.clauide.disposePty(ref.ptyId)
  }

  const willBeEmpty = list.children.length === 0
  if (willBeEmpty) mainLoading.hidden = false

  if (ref.ready) await window.clauide.removeSession(ref.id)

  mainLoading.hidden = true
  if (wasActive) list.querySelector('.session-item')?.click()
  updateEmptyState()
}

function attachHandlers(item, ref) {
  item.addEventListener('click', () => selectItem(item, ref.id))
  item.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    if (!ref.ready) return // still loading — nothing to rename/delete yet
    showContextMenu(event.clientX, event.clientY, item, ref)
  })
}

function startRename(item, ref) {
  if (!ref.ready) return

  const currentName = item.textContent
  const input = document.createElement('input')
  input.className = 'session-rename-input'
  input.value = currentName
  item.replaceChildren(input)
  input.focus()
  input.select()

  let cancelled = false

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur()
    if (event.key === 'Escape') {
      cancelled = true
      input.blur()
    }
  })
  input.addEventListener('click', (event) => event.stopPropagation())
  input.addEventListener(
    'blur',
    async () => {
      const newName = input.value.trim()
      setTabName(item, cancelled || !newName ? currentName : newName)
      if (!cancelled && newName && newName !== currentName) {
        await window.clauide.renameSession(ref.id, newName)
      }
    },
    { once: true }
  )
}

const menu = document.createElement('div')
menu.id = 'context-menu'
menu.innerHTML = `
  <div class="context-menu-item" id="context-menu-rename">Rename</div>
  <div class="context-menu-item" id="context-menu-scripts">Script output</div>
  <div class="context-menu-item" id="context-menu-delete">Delete</div>
`
document.body.appendChild(menu)

function showContextMenu(x, y, item, ref) {
  menu.style.left = `${x}px`
  menu.style.top = `${y}px`
  menu.classList.add('open')
  // The tabbar's empty area is a window-drag region that swallows every mouse event, so a
  // click there can never reach our outside-click listener — make it briefly clickable instead.
  tabbarSpacer.classList.add('no-drag')
  document.getElementById('context-menu-rename').onclick = () => {
    startRename(item, ref)
    hideContextMenu()
  }
  document.getElementById('context-menu-delete').onclick = () => {
    deleteItem(item, ref)
    hideContextMenu()
  }
  const scriptsItem = document.getElementById('context-menu-scripts')
  scriptsItem.classList.toggle('disabled', !ref.containerId)
  scriptsItem.onclick = () => {
    if (!ref.containerId) return
    showScriptOutput(ref.containerId)
    hideContextMenu()
  }
}

function hideContextMenu() {
  menu.classList.remove('open')
  tabbarSpacer.classList.remove('no-drag')
}

document.addEventListener('click', hideContextMenu)
document.addEventListener('contextmenu', (event) => {
  if (!event.target.closest('.session-item')) hideContextMenu()
})

const scriptOutputModal = document.getElementById('script-output-modal')
const scriptOutputList = document.getElementById('script-output-list')
const failedScriptRuns = new Set()

// Setup scripts run one container at a time and hold the session back until they finish, so the
// progress line can go to whichever loading view is on screen without tracking which container it
// belongs to — a session being created has no containerId here yet anyway.
window.clauide.onScriptProgress(({ name, index, total }) => {
  const text = `Running script ${index}/${total} — ${name}`
  for (const el of mainEl.querySelectorAll('.session-webview.loading .loading-text')) el.textContent = text
  const mainLoadingText = mainLoading.querySelector('.loading-text')
  if (mainLoadingText) mainLoadingText.textContent = text
})

window.clauide.onScriptsDone(({ containerId, failed }) => {
  if (failed) failedScriptRuns.add(containerId)
  else failedScriptRuns.delete(containerId)
})

async function showScriptOutput(containerId) {
  const results = await window.clauide.getScriptRun(containerId)
  scriptOutputList.innerHTML = results.length
    ? ''
    : '<p class="empty-state-text">No scripts ran for this session.</p>'

  for (const result of results) {
    const row = document.createElement('div')
    row.className = 'script-output-row'
    const status = result.skipped
      ? 'skipped'
      : result.exitCode === 0
        ? 'ok'
        : `exit ${result.exitCode}`
    row.innerHTML = `
      <div class="script-output-head">
        <span class="skill-name">${result.name}</span>
        <span class="skill-tag ${result.exitCode ? 'failed' : ''}">${status}</span>
      </div>
    `
    if (result.output) {
      const pre = document.createElement('pre')
      pre.className = 'script-output-body'
      pre.textContent = result.output
      row.appendChild(pre)
    }
    scriptOutputList.appendChild(row)
  }

  scriptOutputModal.hidden = false
}

closeOnBackdropClick(scriptOutputModal, () => {
  scriptOutputModal.hidden = true
})
document.getElementById('script-output-close-btn').addEventListener('click', () => {
  scriptOutputModal.hidden = true
})

function createLoadingView(message) {
  const el = document.createElement('div')
  el.className = 'session-webview loading'
  el.innerHTML = `<div class="spinner"></div>${message ? `<p class="loading-text">${message}</p>` : ''}`
  mainEl.appendChild(el)
  return el
}

function setTabName(item, name) {
  const label = document.createElement('span')
  label.className = 'session-item-name'
  label.textContent = name
  label.title = name
  item.replaceChildren(label)
}

function createTab(name, id) {
  const item = document.createElement('div')
  item.className = 'session-item'
  item.dataset.id = id
  setTabName(item, name)
  list.prepend(item)
  return item
}

/** Attaches an xterm.js terminal backed by a PTY running `claude` inside the container. A
 *  ResizeObserver re-fits it whenever its container's size actually changes (tab becomes
 *  visible, window resizes) instead of relying on brittle "is this the active tab" bookkeeping. */
function attachTerminal(container, containerId, ref) {
  const term = new Terminal({
    theme: { background: '#1e1f1c', foreground: '#f8f8f2' },
    fontSize: 13,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    cursorBlink: true
  })
  const fitAddon = new FitAddon.FitAddon()
  term.loadAddon(fitAddon)
  term.open(container)
  term.onData((data) => ref.ptyId && window.clauide.writePty(ref.ptyId, data))

  new ResizeObserver(() => {
    if (container.clientWidth === 0 || container.clientHeight === 0) return
    fitAddon.fit()
    if (ref.ptyId) window.clauide.resizePty(ref.ptyId, term.cols, term.rows)
  }).observe(container)

  function spawnPty() {
    window.clauide.createPty(containerId).then((ptyId) => {
      ref.ptyId = ptyId
      terminalsByPtyId.set(ptyId, { term, respawn: spawnPty })
      fitAddon.fit()
      window.clauide.resizePty(ptyId, term.cols, term.rows)
    })
  }

  spawnPty()
}

function attachResizer(pane, resizer, terminalEl) {
  resizer.addEventListener('mousedown', (event) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = terminalEl.getBoundingClientRect().width
    // Dragging over the <webview> would stop delivering mousemove (it's a separate process),
    // so make it ignore pointer events for the duration of the drag.
    pane.classList.add('resizing')

    function onMove(moveEvent) {
      const min = 240
      const max = pane.getBoundingClientRect().width - 240
      const width = startWidth - (moveEvent.clientX - startX)
      terminalEl.style.width = `${Math.min(max, Math.max(min, width))}px`
    }

    function onUp() {
      pane.classList.remove('resizing')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  })
}

/** The Accounts icon's visibility has no setting and its hide toggle wasn't reliably automatable
 *  (VS Code's own context menu didn't respond the same way the aux bar's button did) — simplest
 *  robust fix is to just hide it with injected CSS instead of replicating VS Code's own UI flow. */
function hideAccountsIcon(webview) {
  webview.insertCSS(`.activitybar [aria-label="Accounts"] { display: none !important; }`)
}

/** Outline/Timeline have no stable selector to target with pure CSS (no text-content match in
 *  CSS), so this polls for their pane header by text and hides the whole pane via inline style —
 *  same "just hide it, don't replicate VS Code's own toggle flow" approach as the Accounts icon. */
function hideExplorerSections(webview, titles) {
  webview.executeJavaScript(`
    (function hide(attemptsLeft) {
      const remaining = ${JSON.stringify(titles)}.filter((title) => {
        const header = [...document.querySelectorAll('.pane-header')].find(
          (el) => el.textContent.trim().toUpperCase() === title.toUpperCase()
        )
        const pane = header?.closest('.pane')
        if (pane) pane.style.display = 'none'
        return !pane
      })
      if (remaining.length > 0 && attemptsLeft > 0) setTimeout(() => hide(attemptsLeft - 1), 500)
    })(20)
  `)
}

/** Shows a "session disconnected" overlay over a pane instead of silently recreating the
 *  container — the user may have stopped/removed it on purpose, so recreation is opt-in. */
function showSessionError(pane, webview, containerId) {
  if (!pane || pane.querySelector('.session-error')) return

  const overlay = document.createElement('div')
  overlay.className = 'session-error'
  overlay.innerHTML = `
    <div class="empty-state">
      <p class="empty-state-title">Session disconnected</p>
      <p class="empty-state-text">The container isn't running anymore.</p>
      <button class="overlay-btn">Recreate</button>
    </div>
  `
  pane.appendChild(overlay)

  overlay.querySelector('button').addEventListener('click', async () => {
    const button = overlay.querySelector('button')
    button.disabled = true
    button.textContent = 'Recreating…'
    try {
      const { port: newPort } = await window.clauide.reconnectSession(containerId)
      if (newPort) webview.src = `http://127.0.0.1:${newPort}/`
      overlay.remove()
    } catch (err) {
      console.error('[session] recreate failed for', containerId, err)
      button.disabled = false
      button.textContent = 'Recreate'
    }
  })
}

/** Swaps the loading placeholder for a real code-server + Claude Code split pane once the
 *  webview (and code-server inside it) has painted. */
function attachWebview(item, ref, realId, port, containerId) {
  const pane = document.createElement('div')
  pane.className = 'session-pane'
  pane.style.display = 'none'

  const webview = document.createElement('webview')
  webview.className = 'session-webview'
  webview.src = `http://127.0.0.1:${port}/`
  pane.appendChild(webview)

  const resizer = document.createElement('div')
  resizer.className = 'session-resizer'
  pane.appendChild(resizer)

  const terminalEl = document.createElement('div')
  terminalEl.className = 'session-terminal'
  pane.appendChild(terminalEl)

  attachResizer(pane, resizer, terminalEl)

  ref.webview = webview
  ref.containerId = containerId
  webviewsByContainerId.set(containerId, webview)
  mainEl.appendChild(pane)

  // Clicks inside a <webview> happen in a separate renderer process and never bubble to
  // `document`, so the outside-click listener on the context menu can't see them directly —
  // but focus moving into the webview does fire a normal DOM 'focus' event we can catch.
  webview.addEventListener('focus', hideContextMenu)

  // The container can die out from under a running session (stopped manually from OrbStack,
  // OOM, etc.) — show an error instead of leaving a dead connection silently on screen.
  webview.addEventListener('did-fail-load', (event) => {
    if (event.errorCode === -3) return // ERR_ABORTED — our own navigations/reloads, not a failure
    showSessionError(pane, webview, containerId)
  })

  // VS Code opens the (empty, since AI features are disabled) Secondary Side Bar by default and
  // there's no setting to change that — its open/closed state only lives in server memory, not in
  // any config we can pre-seed. Hiding its part element with pure CSS leaves a gap: VS Code's own
  // grid layout engine sizes the surrounding sash/columns in JS and doesn't know we hid it, so the
  // space it used to occupy stays reserved (an empty gray gutter). Clicking its real toggle button
  // makes VS Code's own layout code reclaim that space properly — but since it's a *toggle*,
  // clicking it unconditionally on an interval just flips it open/closed forever, so only click
  // when it's actually open and empty (showing VS Code's own "drag a view here" placeholder),
  // which also catches it reopening later (e.g. once hideExplorerSections's Outline pane retries).
  webview.addEventListener('dom-ready', () => {
    webview.executeJavaScript(`
      setInterval(() => {
        // Checking for the "drag a view here" placeholder text isn't a real open/closed signal —
        // it stays in the DOM (just invisible) even while the part is hidden, so that alone
        // toggled the hide button open/closed every second. Checking its actual rendered width
        // is the real signal: 0 means already hidden (don't touch it), so no more flicker.
        const aux = document.querySelector('.part.auxiliarybar')
        if (aux && aux.getBoundingClientRect().width > 0) {
          document.querySelector('[aria-label*="Hide Secondary Side Bar" i], [title*="Hide Secondary Side Bar" i]')?.click()
        }
      }, 1000)
    `)

    hideAccountsIcon(webview)
    hideExplorerSections(webview, ['Outline', 'Timeline'])
  })

  webview.addEventListener(
    'did-finish-load',
    () => {
      setTimeout(() => {
        webviews.get(ref.id)?.remove()
        webviews.delete(ref.id)
        refsBySessionId.delete(ref.id)
        item.dataset.id = realId
        ref.id = realId
        ref.ready = true
        webviews.set(realId, pane)
        refsBySessionId.set(realId, ref)
        attachTerminal(terminalEl, containerId, ref)
        if (item.classList.contains('active')) {
          // Always make the pane visible so #main isn't empty once Settings closes, but only
          // run the rest of selectItem's side effects (closing Settings, etc.) if it isn't open.
          pane.style.display = 'flex'
          if (settingsView.hidden) selectItem(item, realId)
        }
      }, 1000)
    },
    { once: true }
  )
}

/** Adds a tab for an already-created session (from restoreSessions or a live sync pass) — shared
 *  so both start from the exact same wiring instead of drifting apart. */
function addSessionTab(s, { select = false } = {}) {
  const ref = { id: s.id, ready: true, webview: null }
  refsBySessionId.set(s.id, ref)
  const item = createTab(s.name, s.id)
  attachHandlers(item, ref)
  webviews.set(s.id, createLoadingView())
  if (select) selectItem(item, s.id)
  attachWebview(item, ref, s.id, s.port, s.containerId)
  return item
}

async function startNewSession() {
  newBtn.disabled = true
  emptyNewBtn.disabled = true

  const [firstBuild, name] = await Promise.all([
    window.clauide.isImageReady().then((ready) => !ready),
    window.clauide.nextSessionName()
  ])
  const message = firstBuild ? 'Setting up your environment for the first time — this can take a few minutes…' : null
  if (firstBuild) settingsBtn.disabled = true

  const ref = { id: `pending-${Date.now()}`, ready: false, webview: null }
  refsBySessionId.set(ref.id, ref)
  const item = createTab(name, ref.id)
  attachHandlers(item, ref)
  webviews.set(ref.id, createLoadingView(message))
  selectItem(item, ref.id)
  updateEmptyState()

  try {
    const { id, port, containerId } = await window.clauide.createSession()
    attachWebview(item, ref, id, port, containerId)
  } finally {
    newBtn.disabled = false
    emptyNewBtn.disabled = false
    settingsBtn.disabled = false
  }
}

newBtn.addEventListener('click', startNewSession)
emptyNewBtn.addEventListener('click', startNewSession)

async function restoreSessions() {
  dockerError.hidden = true

  if (!(await window.clauide.checkDocker())) {
    tabbar.hidden = true
    dockerError.hidden = false
    mainLoading.hidden = true
    return
  }

  const sessions = await window.clauide.listSessions()
  sessions.forEach((s, index) => addSessionTab(s, { select: index === 0 }))
  mainLoading.hidden = true
  updateEmptyState()
}

/** Keeps the tab bar in sync with sessions created/renamed/removed from outside this window's own
 *  actions — right now that's only the "clauide" MCP server, which any container's Claude Code can
 *  call to manage sessions, so without this the tab bar would silently go stale. Diffs against the
 *  current tabs instead of a full rebuild so an untouched, already-loaded session's webview is
 *  never torn down and reloaded. */
async function syncSessions() {
  if (!(await window.clauide.checkDocker())) return

  const sessionsList = await window.clauide.listSessions()
  const seenIds = new Set(sessionsList.map((s) => s.id))

  for (const id of [...webviews.keys()]) {
    if (seenIds.has(id)) continue
    const item = list.querySelector(`[data-id="${id}"]`)
    const ref = refsBySessionId.get(id)
    if (item && ref) await deleteItem(item, ref)
  }

  sessionsList.forEach((s) => {
    const item = list.querySelector(`[data-id="${s.id}"]`)
    if (item) {
      setTabName(item, s.name)
      return
    }
    addSessionTab(s)
  })

  updateEmptyState()
}

window.clauide.onSessionsChanged(syncSessions)

restoreSessions()
