#!/usr/bin/env node
// Pins the tool list the plugin evals show the model.
//
// An eval case calls the proxy's tools for real, and a stand-in answers with a
// recorded result (plugin/evals/mocks/chain-insights/<tool>.md). The model
// must still read the tool's real title, description and input schema, because
// a tool description is the one text every host reads. This script starts the
// built proxy, asks it for tools/list, and writes the entries of the tools that
// have a stand-in to plugin/evals/mocks/chain-insights/_tools.json.
//
//   npm run build
//   node scripts/pin-eval-tools.mjs            write the file
//   node scripts/pin-eval-tools.mjs --check    exit 1 when the file is stale
//
// The proxy answers tools/list for its local tools before it reaches the graph
// endpoint, so the run needs no network and no key.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export const EVAL_MOCK_SERVER = 'chain-insights'
export const EVAL_MOCKS_DIR = join('plugin', 'evals', 'mocks', EVAL_MOCK_SERVER)
export const EVAL_TOOLS_FILE = join(EVAL_MOCKS_DIR, '_tools.json')

/** The tools that have a stand-in: one `<tool>.md` file each, `_`-files left out. */
export function mockedToolNames(base = root) {
  const dir = join(base, EVAL_MOCKS_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((file) => file.endsWith('.md') && !file.startsWith('_'))
    .map((file) => file.slice(0, -'.md'.length))
    .sort()
}

/** The pinned file's text for the tools/list entries of the mocked tools. */
export function renderToolsFile(listed, names) {
  const byName = new Map(listed.map((tool) => [tool.name, tool]))
  const missing = names.filter((name) => !byName.has(name))
  if (missing.length > 0) {
    throw new Error(`the proxy lists no tool named: ${missing.join(', ')}`)
  }
  const tools = names.map((name) => {
    const { name: toolName, title, description, inputSchema, annotations } = byName.get(name)
    return { name: toolName, title, description, inputSchema, annotations }
  })
  return `${JSON.stringify({ tools }, null, 2)}\n`
}

async function listProxyTools() {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, 'bin', 'mcp-proxy.cjs')],
    env: { ...process.env, CHAIN_INSIGHTS_SKILL_REFRESH: '0', CHAIN_INSIGHTS_SKIP_UPDATE_CHECK: '1' },
    stderr: 'ignore',
  })
  const client = new Client({ name: 'pin-eval-tools', version: '1' })
  await client.connect(transport)
  try {
    return (await client.listTools()).tools
  } finally {
    await client.close()
  }
}

async function main() {
  const check = process.argv.includes('--check')
  const names = mockedToolNames()
  const text = renderToolsFile(await listProxyTools(), names)
  const path = join(root, EVAL_TOOLS_FILE)
  if (check) {
    const current = existsSync(path) ? readFileSync(path, 'utf8') : ''
    if (current !== text) {
      console.error(`${EVAL_TOOLS_FILE} is stale: run node scripts/pin-eval-tools.mjs`)
      process.exit(1)
    }
    console.log(`${EVAL_TOOLS_FILE}: ${names.length} tools, in step with the proxy`)
    return
  }
  writeFileSync(path, text)
  console.log(`wrote ${EVAL_TOOLS_FILE}: ${names.join(', ')}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
