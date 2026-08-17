const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('clauide', {
  checkDocker: () => ipcRenderer.invoke('docker:check'),
  saveToken: (token) => ipcRenderer.invoke('token:save', token),
  isImageReady: () => ipcRenderer.invoke('session:imageReady'),
  nextSessionName: () => ipcRenderer.invoke('session:nextName'),
  createSession: () => ipcRenderer.invoke('session:create'),
  listSessions: () => ipcRenderer.invoke('session:list'),
  renameSession: (id, name) => ipcRenderer.invoke('session:rename', id, name),
  removeSession: (id) => ipcRenderer.invoke('session:remove', id),
  reconnectSession: (containerId) => ipcRenderer.invoke('session:reconnect', containerId),
  onSessionDown: (callback) => ipcRenderer.on('session:down', (_event, containerId) => callback(containerId)),
  // Fired when a session/skill/MCP server/rule/extension changes from somewhere other than this
  // window's own action — right now that's only the "clauide" MCP server (bridge.js), reachable
  // from inside any container's Claude Code — so the UI stays live instead of going stale.
  onSessionsChanged: (callback) => ipcRenderer.on('sessions:changed', () => callback()),
  onSkillsChanged: (callback) => ipcRenderer.on('skills:changed', () => callback()),
  onMcpChanged: (callback) => ipcRenderer.on('mcp:changed', () => callback()),
  onRulesChanged: (callback) => ipcRenderer.on('rules:changed', () => callback()),
  onExtensionsChanged: (callback) => ipcRenderer.on('extensions:changed', () => callback()),

  listSkills: () => ipcRenderer.invoke('skills:list'),
  saveSkill: (skill) => ipcRenderer.invoke('skills:save', skill),
  deleteSkill: (id) => ipcRenderer.invoke('skills:delete', id),
  setSkillEnabled: (id, enabled) => ipcRenderer.invoke('skills:setEnabled', id, enabled),

  listMcpServers: () => ipcRenderer.invoke('mcp:list'),
  saveMcpServer: (server) => ipcRenderer.invoke('mcp:save', server),
  deleteMcpServer: (id) => ipcRenderer.invoke('mcp:delete', id),
  setMcpServerEnabled: (id, enabled) => ipcRenderer.invoke('mcp:setEnabled', id, enabled),

  listRules: () => ipcRenderer.invoke('rules:list'),
  saveRule: (rule) => ipcRenderer.invoke('rules:save', rule),
  deleteRule: (id) => ipcRenderer.invoke('rules:delete', id),

  listExtensions: () => ipcRenderer.invoke('extensions:list'),
  addExtension: (extension) => ipcRenderer.invoke('extensions:add', extension),
  deleteExtension: (id) => ipcRenderer.invoke('extensions:delete', id),
  setExtensionEnabled: (id, enabled) => ipcRenderer.invoke('extensions:setEnabled', id, enabled),

  getGithubStatus: () => ipcRenderer.invoke('github:status'),
  disconnectGithub: () => ipcRenderer.invoke('github:disconnect'),
  connectGithubFromHost: () => ipcRenderer.invoke('github:connectFromHost'),
  connectGithubWithToken: (token) => ipcRenderer.invoke('github:connectWithToken', token),

  getClaudeConfig: () => ipcRenderer.invoke('claudeConfig:get'),
  saveClaudeConfig: (config) => ipcRenderer.invoke('claudeConfig:save', config),

  listLspServers: () => ipcRenderer.invoke('lsp:list'),
  setLspServerEnabled: (id, enabled) => ipcRenderer.invoke('lsp:setEnabled', id, enabled),
  onLspChanged: (callback) => ipcRenderer.on('lsp:changed', () => callback()),

  onUpdateReady: (callback) => ipcRenderer.on('update:ready', (_event, version) => callback(version)),
  onUpdateManual: (callback) => ipcRenderer.on('update:manual', (_event, version) => callback(version)),
  installUpdate: () => ipcRenderer.send('update:install'),
  openReleases: () => ipcRenderer.send('update:openReleases'),

  createPty: (containerId) => ipcRenderer.invoke('pty:create', containerId),
  writePty: (ptyId, data) => ipcRenderer.send('pty:write', ptyId, data),
  resizePty: (ptyId, cols, rows) => ipcRenderer.send('pty:resize', ptyId, cols, rows),
  disposePty: (ptyId) => ipcRenderer.send('pty:dispose', ptyId),
  onPtyData: (callback) => ipcRenderer.on('pty:data', (_event, ptyId, data) => callback(ptyId, data)),
  onPtyExit: (callback) => ipcRenderer.on('pty:exit', (_event, ptyId) => callback(ptyId))
})
