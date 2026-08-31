import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const cli = join(process.cwd(), 'bin', 'cli.js')

describe('first-release public surface', () => {
  it('does not advertise local workspace or visualization commands', () => {
    const result = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stdout).not.toMatch(/\b(init|serve|viz)\b/)
  })

  it.each(['init', 'serve', 'viz'])('%s is unavailable', (command) => {
    const result = spawnSync(process.execPath, [cli, command], { encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/unknown command/i)
  })

  it('does not ship user instructions for deferred local features', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8')
    const docs = ['docs/graph-tools.md', 'docs/mcp-proxy.md', 'docs/development.md'].map((path) =>
      readFileSync(join(process.cwd(), path), 'utf8')
    )
    const content = [readme, ...docs].join('\n')

    expect(content).not.toMatch(/\bcia (init|serve|viz)\b/)
    expect(content).not.toMatch(/graph report|graph-report|published\/viz|visualization/i)
  })

  it('keeps workflow discovery and low-level MCP access visible', () => {
    const root = execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8' })
    expect(root).toContain('workflows')
    expect(root).toContain('workflow')

    const out = execFileSync(process.execPath, [cli, 'mcp', '--help'], { encoding: 'utf8' })
    expect(out).not.toContain('aml-address-risk')
    expect(out).toContain('tools')
  })
})
