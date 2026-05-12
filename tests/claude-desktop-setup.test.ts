import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('Claude Desktop setup', () => {
  let tempDir: string
  let configPath: string

  beforeEach(async () => {
    tempDir = join(tmpdir(), `chain-insights-claude-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    configPath = join(tempDir, 'Claude', 'claude_desktop_config.json')
    await mkdir(join(tempDir, 'Claude'), { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('writes the chain-insights MCP server and preserves unrelated preferences', async () => {
    await writeFile(configPath, JSON.stringify({
      preferences: { sidebarMode: 'chat' },
      mcpServers: {
        other: { command: 'other-mcp' },
      },
    }, null, 2) + '\n')

    const { setupClaudeDesktop } = await import('../src/claude-desktop/setup.js')
    const result = await setupClaudeDesktop({ configPath })
    const updated = JSON.parse(await readFile(configPath, 'utf8')) as {
      preferences: Record<string, unknown>
      mcpServers: Record<string, { command: string; args?: string[] }>
    }

    expect(result.changed).toBe(true)
    expect(result.backupPath).toBeDefined()
    expect(updated.preferences.sidebarMode).toBe('chat')
    expect(updated.mcpServers.other.command).toBe('other-mcp')
    expect(updated.mcpServers['chain-insights']!.command).toBe(process.execPath)
    expect(updated.mcpServers['chain-insights']!.args![0]).toMatch(/bin\/mcp-proxy\.cjs$/)
  })

  it('backs up an existing config before writing', async () => {
    await writeFile(configPath, JSON.stringify({ mcpServers: {} }, null, 2) + '\n')

    const { setupClaudeDesktop } = await import('../src/claude-desktop/setup.js')
    const result = await setupClaudeDesktop({ configPath })

    expect(result.backupPath).toBeDefined()
    const backup = await readFile(result.backupPath!, 'utf8')
    expect(JSON.parse(backup)).toEqual({ mcpServers: {} })
  })

  it('dry-run does not write or back up config files', async () => {
    await writeFile(configPath, JSON.stringify({ preferences: { sidebarMode: 'chat' } }, null, 2) + '\n')
    const before = await readFile(configPath, 'utf8')

    const { setupClaudeDesktop } = await import('../src/claude-desktop/setup.js')
    const result = await setupClaudeDesktop({ configPath, dryRun: true })
    const after = await readFile(configPath, 'utf8')

    expect(result.dryRun).toBe(true)
    expect(result.changed).toBe(true)
    expect(result.backupPath).toBeUndefined()
    expect(after).toBe(before)
  })

  it('creates a new config with private file permissions', async () => {
    const newConfigPath = join(tempDir, 'NewClaude', 'claude_desktop_config.json')

    const { setupClaudeDesktop } = await import('../src/claude-desktop/setup.js')
    await setupClaudeDesktop({ configPath: newConfigPath })

    const mode = (await stat(newConfigPath)).mode & 0o777
    const written = JSON.parse(await readFile(newConfigPath, 'utf8')) as {
      mcpServers: Record<string, unknown>
    }
    expect(mode).toBe(0o600)
    expect(written.mcpServers['chain-insights']).toBeDefined()
  })

  it('reports no change when the config already matches', async () => {
    const { defaultProxyCommand, setupClaudeDesktop } = await import('../src/claude-desktop/setup.js')
    const expected = defaultProxyCommand()
    await writeFile(configPath, JSON.stringify({
      mcpServers: {
        'chain-insights': expected,
      },
    }, null, 2) + '\n')

    const result = await setupClaudeDesktop({ configPath })

    expect(result.changed).toBe(false)
    expect(result.backupPath).toBeUndefined()
  })
})
