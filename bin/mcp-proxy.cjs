#!/usr/bin/env node
'use strict'

// CJS shim for stdio MCP proxy — spawned by Claude Code via ~/.claude.json mcpServers config.
// IMPORTANT: Do not write to stdout here — stdout is owned by StdioServerTransport.
// Use process.stderr.write() exclusively for pre-load errors.
import('../dist/mcp-proxy.mjs')
  .then(({ createProxy }) => createProxy())
  .catch((err) => {
    process.stderr.write(`Failed to load chain-insights MCP proxy: ${err.message}\n`)
    process.exit(1)
  })
