const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { app, safeStorage } = require('electron')

// Split out from bridge.js so mcp.js can read the token/port to register the built-in "clauide"
// MCP server without requiring bridge.js itself (which requires mcp.js back, for its /mcp routes).
const PORT = 47651

const tokenPath = () => path.join(app.getPath('userData'), 'bridge-token.enc')

function getToken() {
  try {
    return safeStorage.decryptString(fs.readFileSync(tokenPath()))
  } catch {
    const token = crypto.randomBytes(24).toString('hex')
    fs.mkdirSync(path.dirname(tokenPath()), { recursive: true })
    fs.writeFileSync(tokenPath(), safeStorage.encryptString(token))
    return token
  }
}

module.exports = { PORT, getToken }
