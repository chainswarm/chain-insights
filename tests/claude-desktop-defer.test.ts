import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  claudeDesktopConfigPath,
  defersToClaudeDesktop,
  DEFERRED_SERVER_INSTRUCTIONS,
} from '../src/mcp/claude-desktop.js'

describe('the Claude Code copy steps aside inside Claude Desktop', () => {
  let home: string
  let configFile: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ci-desktop-defer-'))
    configFile = claudeDesktopConfigPath({ XDG_CONFIG_HOME: join(home, '.config') }, 'linux', home)
    mkdirSync(join(configFile, '..'), { recursive: true })
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  const desktopEntry = (servers: Record<string, unknown>) =>
    writeFileSync(configFile, JSON.stringify({ mcpServers: servers }))

  it.each([
    [
      'inside Claude Desktop, drawing copy configured',
      'claude-desktop',
      { 'chain-insights': {} },
      true,
    ],
    ['inside Claude Desktop, no drawing copy', 'claude-desktop', {}, false],
    ['inside Claude Desktop, another server only', 'claude-desktop', { other: {} }, false],
    ['Claude Code in a terminal', 'cli', { 'chain-insights': {} }, false],
    ['started by Claude Desktop itself (no marker)', undefined, { 'chain-insights': {} }, false],
  ] as const)('%s', (_name, entrypoint, servers, defers) => {
    desktopEntry(servers)
    const env: NodeJS.ProcessEnv = entrypoint ? { CLAUDE_CODE_ENTRYPOINT: entrypoint } : {}
    expect(defersToClaudeDesktop(env, configFile)).toBe(defers)
  })

  it('a missing or broken settings file never makes the copy step aside', () => {
    const env = { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' }
    expect(defersToClaudeDesktop(env, configFile)).toBe(false)
    writeFileSync(configFile, '{ not json')
    expect(defersToClaudeDesktop(env, configFile)).toBe(false)
  })

  it('the built proxy lists no tools and starts no view server when it is the Claude Code copy in Claude Desktop', async () => {
    desktopEntry({ 'chain-insights': {} })
    const child = spawn(process.execPath, [join(__dirname, '..', 'bin', 'mcp-proxy.cjs')], {
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: join(home, '.config'),
        CLAUDE_CODE_ENTRYPOINT: 'claude-desktop',
        CHAIN_INSIGHTS_SKILL_REFRESH: '0',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    const replies = new Map<number, any>()
    let buffer = ''
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        const message = JSON.parse(line)
        if (typeof message.id === 'number') replies.set(message.id, message)
      }
    })
    const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`)
    const reply = async (id: number) => {
      for (let i = 0; i < 100 && !replies.has(id); i++) await new Promise((r) => setTimeout(r, 50))
      return replies.get(id)
    }
    try {
      send({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 't', version: '1' },
        },
      })
      const init = await reply(0)
      expect(init.result.instructions).toBe(DEFERRED_SERVER_INSTRUCTIONS)
      send({ jsonrpc: '2.0', method: 'notifications/initialized' })
      send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      const tools = await reply(1)
      // An McpServer with no tool answers tools/list with "method not found";
      // either way the host sees no Chain Insights tool from this copy.
      expect(tools.result?.tools ?? []).toEqual([])
      // A graph call reaches no tool here, so this copy never opens the
      // browser view server either: only the drawing copy serves the window.
      send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'graph_query',
          arguments: { network: 'robinhood', query: 'USE topology MATCH (a) RETURN a LIMIT 1' },
        },
      })
      const call = await reply(2)
      expect(call.error ?? call.result?.isError).toBeTruthy()
      expect(JSON.stringify(call)).not.toContain('view_url')
      expect(stderr).not.toContain('view.server')
    } finally {
      child.kill()
    }
  }, 20_000)
})
