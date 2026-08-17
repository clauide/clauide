const http = require('node:http')
const sessions = require('./sessions')
const skills = require('./skills')
const mcp = require('./mcp')
const rules = require('./rules')
const extensions = require('./extensions')
const lsp = require('./lsp')
const { syncEverywhere, syncAllEverywhere } = require('./sync')
const { PORT, getToken } = require('./bridgeConfig')
const windowRef = require('./windowRef')

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => {
      if (!data) return resolve({})
      try {
        resolve(JSON.parse(data))
      } catch {
        reject(httpError(400, 'invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function send(res, status, body) {
  const json = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(json)
}

const pickSession = ({ id, name, containerId }) => ({ id, name, containerId })

async function sessionIdOrThrow(containerId) {
  const id = sessions.findIdByContainerId(containerId)
  if (!id) throw httpError(404, `no session with containerId ${containerId}`)
  return id
}

/** Mirrors the same shape as main.js's ipcMain.handle blocks below, one per resource — kept
 *  as explicit per-resource branches rather than a generic CRUD loop, matching the earlier call
 *  not to generalize the IPC handlers (the underlying method names genuinely differ per module). */
async function route(method, [resource, id], body) {
  if (resource === 'sessions') {
    if (method === 'GET' && !id) return (await sessions.listSessions()).map(pickSession)
    if (method === 'GET' && id) {
      const match = (await sessions.listSessions()).find((s) => s.containerId === id)
      if (!match) throw httpError(404, `no session with containerId ${id}`)
      return pickSession(match)
    }
    if (method === 'POST' && !id) {
      const session = await sessions.createSession()
      await syncAllEverywhere(session.containerId)
      windowRef.notify('sessions:changed')
      return pickSession(session)
    }
    if (method === 'PATCH' && id) {
      sessions.renameSession(await sessionIdOrThrow(id), body.name)
      windowRef.notify('sessions:changed')
      return { ok: true }
    }
    if (method === 'DELETE' && id) {
      await sessions.removeSession(await sessionIdOrThrow(id))
      windowRef.notify('sessions:changed')
      return { ok: true }
    }
  }

  if (resource === 'skills') {
    if (method === 'GET' && !id) return skills.listSkills()
    if (method === 'POST' && !id) {
      const skillId = skills.saveSkill(body)
      await syncEverywhere('skills')
      windowRef.notify('skills:changed')
      return { id: skillId }
    }
    if (method === 'DELETE' && id) {
      skills.deleteSkill(id)
      await syncEverywhere('skills')
      windowRef.notify('skills:changed')
      return { ok: true }
    }
    if (method === 'PATCH' && id) {
      skills.setEnabled(id, body.enabled)
      await syncEverywhere('skills')
      windowRef.notify('skills:changed')
      return { ok: true }
    }
  }

  if (resource === 'mcp') {
    if (method === 'GET' && !id) return mcp.listServers()
    if (method === 'POST' && !id) {
      const serverId = mcp.saveServer(body)
      await syncEverywhere('mcp')
      windowRef.notify('mcp:changed')
      return { id: serverId }
    }
    if (method === 'DELETE' && id) {
      mcp.deleteServer(id)
      await syncEverywhere('mcp')
      windowRef.notify('mcp:changed')
      return { ok: true }
    }
    if (method === 'PATCH' && id) {
      mcp.setEnabled(id, body.enabled)
      await syncEverywhere('mcp')
      windowRef.notify('mcp:changed')
      return { ok: true }
    }
  }

  if (resource === 'rules') {
    if (method === 'GET' && !id) return rules.listRules()
    if (method === 'POST' && !id) {
      const ruleId = rules.saveRule(body)
      await syncEverywhere('rules')
      windowRef.notify('rules:changed')
      return { id: ruleId }
    }
    if (method === 'DELETE' && id) {
      rules.deleteRule(id)
      await syncEverywhere('rules')
      windowRef.notify('rules:changed')
      return { ok: true }
    }
  }

  if (resource === 'extensions') {
    if (method === 'GET' && !id) return extensions.listExtensions()
    if (method === 'POST' && !id) {
      const extensionId = extensions.addExtension(body)
      await syncEverywhere('extensions')
      windowRef.notify('extensions:changed')
      return { id: extensionId }
    }
    if (method === 'DELETE' && id) {
      extensions.deleteExtension(id)
      await syncEverywhere('extensions')
      windowRef.notify('extensions:changed')
      return { ok: true }
    }
    if (method === 'PATCH' && id) {
      extensions.setEnabled(id, body.enabled)
      await syncEverywhere('extensions')
      windowRef.notify('extensions:changed')
      return { ok: true }
    }
  }

  if (resource === 'lsp') {
    if (method === 'GET' && !id) return lsp.listServers()
    if (method === 'PATCH' && id) {
      lsp.setEnabled(id, body.enabled)
      await syncEverywhere('lsp')
      windowRef.notify('lsp:changed')
      return { ok: true }
    }
  }

  throw httpError(404, `no route for ${method} /${[resource, id].filter(Boolean).join('/')}`)
}

async function handleRequest(req, res) {
  try {
    if (req.headers.authorization !== `Bearer ${getToken()}`) throw httpError(401, 'unauthorized')

    const url = new URL(req.url, 'http://internal')
    const segments = url.pathname.split('/').filter(Boolean)
    const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req)

    const result = await route(req.method, segments, body)
    send(res, 200, result ?? { ok: true })
  } catch (err) {
    send(res, err.status || 500, { error: err.message })
  }
}

/** Lets the Claude Code process running inside each container manage Clauide itself (sessions,
 *  skills, MCP servers, rules, extensions) via the built-in "clauide" MCP server — reachable at
 *  host.docker.internal since it listens on every interface, guarded by a per-install bearer
 *  token (see bridgeConfig.js) that's injected into each container alongside the MCP entry. */
function start() {
  const server = http.createServer((req, res) => void handleRequest(req, res))
  server.on('error', (err) => console.error('[bridge] failed to start', err))
  server.listen(PORT, '0.0.0.0')
  return server
}

module.exports = { start }
