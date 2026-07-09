import { execSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { PUBLIC_MCP_TOOL_ALLOWED_ARGS, PUBLIC_MCP_TOOL_REQUIRED_ARGS } from '../src/mcp/tool-visibility.js'

const INTERNAL_TOOL_NAMES = ['aml_scam_corridor_trace', 'aml_exchange_likeness']

describe('detection tools stay off the public MCP tool surface (A5)', () => {
  it('neither tool appears in PUBLIC_MCP_TOOL_REQUIRED_ARGS', () => {
    for (const name of INTERNAL_TOOL_NAMES) {
      expect(Object.keys(PUBLIC_MCP_TOOL_REQUIRED_ARGS)).not.toContain(name)
    }
  })

  it('neither tool appears in PUBLIC_MCP_TOOL_ALLOWED_ARGS', () => {
    for (const name of INTERNAL_TOOL_NAMES) {
      expect(Object.keys(PUBLIC_MCP_TOOL_ALLOWED_ARGS)).not.toContain(name)
    }
  })

  it('bare `cia --help` (the public/top-level surface) never names either tool', () => {
    const out = execSync('node bin/cli.js --help', { encoding: 'utf8' })
    expect(out).not.toMatch(/aml[-_]scam[-_]corridor[-_]trace/)
    expect(out).not.toMatch(/aml[-_]exchange[-_]likeness/)
  })
})

describe('detection tools are still cia-invocable (commander-registered, help-discoverable)', () => {
  it('`cia mcp --help` lists both commander subcommands', () => {
    const out = execSync('node bin/cli.js mcp --help', { encoding: 'utf8' })
    expect(out).toContain('aml-scam-corridor-trace')
    expect(out).toContain('aml-exchange-likeness')
  })

  it('`cia mcp aml-scam-corridor-trace --help` exposes its flags', () => {
    const out = execSync('node bin/cli.js mcp aml-scam-corridor-trace --help', { encoding: 'utf8' })
    expect(out).toContain('--seed-address')
    expect(out).toContain('--network')
    expect(out).toContain('--max-hops')
  })

  it('`cia mcp aml-exchange-likeness --help` exposes its flags', () => {
    const out = execSync('node bin/cli.js mcp aml-exchange-likeness --help', { encoding: 'utf8' })
    expect(out).toContain('--addresses')
    expect(out).toContain('--network')
  })
})
