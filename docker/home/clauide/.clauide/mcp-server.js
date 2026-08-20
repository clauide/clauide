const readline = require('node:readline')

const API = process.env.CLAUIDE_API_URL
const TOKEN = process.env.CLAUIDE_API_TOKEN
const CURRENT_CONTAINER_ID = process.env.CLAUIDE_CONTAINER_ID

const tools = [
  {
    name: 'get_current_session',
    description: 'Get info (id, name, containerId) about the session this MCP server is running in — i.e. the one Claude is currently working in.',
    inputSchema: { type: 'object', properties: {} }
  },
  { name: 'list_sessions', description: 'List every Clauide session (id, name, containerId).', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_session', description: 'Create a new isolated Clauide session (new container + volume).', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'rename_session',
    description: 'Rename a Clauide session. Omit containerId to rename the current session.',
    inputSchema: { type: 'object', properties: { containerId: { type: 'string' }, name: { type: 'string' } }, required: ['name'] }
  },
  {
    name: 'remove_session',
    description: 'Permanently delete a session and its container/volume. Irreversible. Omit containerId to remove the current session.',
    inputSchema: { type: 'object', properties: { containerId: { type: 'string' } } }
  },

  { name: 'list_skills', description: 'List every skill (shared across all sessions).', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'save_skill',
    description:
      'Create or update a skill. Pass id to update an existing one (get it from list_skills first) — this replaces the whole skill, so include every field you want to keep, not just the ones changing.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        body: { type: 'string' },
        model: { type: 'string', enum: ['', 'sonnet', 'opus', 'haiku'] },
        effort: { type: 'string', enum: ['', 'low', 'medium', 'high', 'xhigh', 'max'] },
        fork: { type: 'boolean', description: 'Run as a background subagent' },
        autoInvoke: { type: 'boolean', description: 'Let Claude invoke this automatically' },
        enabled: { type: 'boolean' }
      },
      required: ['name', 'body']
    }
  },
  { name: 'delete_skill', description: 'Delete a skill.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  {
    name: 'set_skill_enabled',
    description: 'Enable or disable a skill.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['id', 'enabled'] }
  },

  { name: 'list_mcp_servers', description: 'List every configured MCP server.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'save_mcp_server',
    description:
      'Create or update an MCP server. Pass id to update an existing one (get it from list_mcp_servers first) — this replaces the whole entry, so include every field you want to keep.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        type: { type: 'string', enum: ['http', 'sse', 'stdio'] },
        url: { type: 'string' },
        headers: { type: 'object' },
        command: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
        env: { type: 'object' },
        enabled: { type: 'boolean' }
      },
      required: ['name', 'type']
    }
  },
  { name: 'delete_mcp_server', description: 'Delete an MCP server.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  {
    name: 'set_mcp_enabled',
    description: 'Enable or disable an MCP server.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['id', 'enabled'] }
  },

  { name: 'list_rules', description: 'List every rule.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'save_rule',
    description:
      'Create or update a rule. Pass id to update an existing one (get it from list_rules first) — this replaces the whole rule, so include every field you want to keep.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        paths: { type: 'array', items: { type: 'string' }, description: 'Glob paths this rule applies to; empty means always' },
        body: { type: 'string' }
      },
      required: ['name', 'body']
    }
  },
  { name: 'delete_rule', description: 'Delete a rule.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },

  { name: 'list_extensions', description: 'List every installed VS Code extension.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'add_extension',
    description: 'Install a VS Code extension by its Open VSX id, e.g. "esbenp.prettier-vscode".',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } }, required: ['id'] }
  },
  { name: 'delete_extension', description: 'Remove a VS Code extension.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  {
    name: 'set_extension_enabled',
    description: 'Enable or disable a VS Code extension.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['id', 'enabled'] }
  },

  {
    name: 'list_plugins',
    description: 'List every Claude Code plugin available across the configured marketplaces (id, name, description, category, marketplace, enabled). Enabled plugins are installed into every session — this is also where language servers live, e.g. "typescript-lsp@claude-plugins-official".',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'set_plugin_enabled',
    description: 'Enable or disable a plugin by its full id (get ids from list_plugins, e.g. "pyright-lsp@claude-plugins-official"). Installing one for the first time takes a bit — it is fetched from its marketplace.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['id', 'enabled'] }
  },
  {
    name: 'list_marketplaces',
    description: 'List the plugin marketplaces Clauide reads plugins from.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'add_marketplace',
    description: 'Add a plugin marketplace by GitHub repository, e.g. "anthropics/claude-plugins-official". Its plugins then show up in list_plugins.',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' } }, required: ['repo'] }
  },

  {
    name: 'list_scripts',
    description: 'List every setup script, in the order they run (id, name, enabled, continueOnError). Setup scripts run once per session, when it is created.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'save_script',
    description:
      'Create or update a setup script. Scripts run with bash in /home/clauide/workspace once per session, at the moment it is created — not when an existing session is reopened or its container recreated. Use them to prepare the workspace (clone repositories, drop in config); tools and packages belong in the base image, since anything installed outside the session volumes is lost when its container is recreated. Pass an existing id to update.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        body: { type: 'string', description: 'The bash script to run' },
        enabled: { type: 'boolean' },
        continueOnError: { type: 'boolean', description: 'Keep running later scripts if this one exits non-zero' }
      },
      required: ['name', 'body']
    }
  },
  { name: 'delete_script', description: 'Delete a setup script.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  {
    name: 'set_script_enabled',
    description: 'Enable or disable a setup script.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['id', 'enabled'] }
  }
]

function toolToRequest(name, args) {
  switch (name) {
    case 'get_current_session':
      return { method: 'GET', path: `/sessions/${CURRENT_CONTAINER_ID}` }
    case 'list_sessions':
      return { method: 'GET', path: '/sessions' }
    case 'create_session':
      return { method: 'POST', path: '/sessions' }
    case 'rename_session':
      return { method: 'PATCH', path: `/sessions/${args.containerId || CURRENT_CONTAINER_ID}`, body: { name: args.name } }
    case 'remove_session':
      return { method: 'DELETE', path: `/sessions/${args.containerId || CURRENT_CONTAINER_ID}` }

    case 'list_skills':
      return { method: 'GET', path: '/skills' }
    case 'save_skill':
      return { method: 'POST', path: '/skills', body: args }
    case 'delete_skill':
      return { method: 'DELETE', path: `/skills/${args.id}` }
    case 'set_skill_enabled':
      return { method: 'PATCH', path: `/skills/${args.id}`, body: { enabled: args.enabled } }

    case 'list_mcp_servers':
      return { method: 'GET', path: '/mcp' }
    case 'save_mcp_server':
      return { method: 'POST', path: '/mcp', body: args }
    case 'delete_mcp_server':
      return { method: 'DELETE', path: `/mcp/${args.id}` }
    case 'set_mcp_enabled':
      return { method: 'PATCH', path: `/mcp/${args.id}`, body: { enabled: args.enabled } }

    case 'list_rules':
      return { method: 'GET', path: '/rules' }
    case 'save_rule':
      return { method: 'POST', path: '/rules', body: args }
    case 'delete_rule':
      return { method: 'DELETE', path: `/rules/${args.id}` }

    case 'list_extensions':
      return { method: 'GET', path: '/extensions' }
    case 'add_extension':
      return { method: 'POST', path: '/extensions', body: args }
    case 'delete_extension':
      return { method: 'DELETE', path: `/extensions/${args.id}` }
    case 'set_extension_enabled':
      return { method: 'PATCH', path: `/extensions/${args.id}`, body: { enabled: args.enabled } }

    case 'list_plugins':
      return { method: 'GET', path: '/plugins' }
    case 'set_plugin_enabled':
      return { method: 'PATCH', path: `/plugins/${args.id}`, body: { enabled: args.enabled } }
    case 'list_marketplaces':
      return { method: 'GET', path: '/marketplaces' }
    case 'add_marketplace':
      return { method: 'POST', path: '/marketplaces', body: { repo: args.repo } }

    case 'list_scripts':
      return { method: 'GET', path: '/scripts' }
    case 'save_script':
      return { method: 'POST', path: '/scripts', body: args }
    case 'delete_script':
      return { method: 'DELETE', path: `/scripts/${args.id}` }
    case 'set_script_enabled':
      return { method: 'PATCH', path: `/scripts/${args.id}`, body: { enabled: args.enabled } }

    default:
      throw new Error(`unknown tool ${name}`)
  }
}

async function callApi({ method, path, body }) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`)
  return data
}

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

const rl = readline.createInterface({ input: process.stdin })

rl.on('line', async (line) => {
  if (!line.trim()) return

  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }

  const { id, method, params } = msg
  if (id === undefined) return // notification, no response expected

  if (method === 'initialize') {
    respond(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'clauide', version: '1.0.0' } })
    return
  }
  if (method === 'tools/list') {
    respond(id, { tools })
    return
  }
  if (method === 'ping') {
    respond(id, {})
    return
  }
  if (method === 'tools/call') {
    try {
      const result = await callApi(toolToRequest(params.name, params.arguments || {}))
      respond(id, { content: [{ type: 'text', text: JSON.stringify(result) }] })
    } catch (err) {
      respond(id, { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true })
    }
    return
  }
  respond(id, { error: { code: -32601, message: `unknown method ${method}` } })
})
