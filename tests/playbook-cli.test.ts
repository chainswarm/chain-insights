import { describe, it, expect } from 'vitest'
import { execSync, spawnSync } from 'node:child_process'

/** Run CLI command, capture stdout+stderr. Returns output and exit code. */
function runCLI(args: string, opts: { expectError?: boolean } = {}) {
  const result = spawnSync('node', ['bin/cli.js', ...args.split(' ')], {
    encoding: 'utf8',
    env: { ...process.env },
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    code: result.status ?? 0,
    output: (result.stdout ?? '') + (result.stderr ?? ''),
  }
}

describe('CLI playbook subcommand', () => {
  it('playbook --help includes run, list, show subcommands', () => {
    const out = execSync('node bin/cli.js playbook --help', { encoding: 'utf8' })
    expect(out).toContain('run')
    expect(out).toContain('list')
    expect(out).toContain('show')
  })

  it('playbook list outputs trace-funds, risk-check, entity-profile', () => {
    const out = execSync('node bin/cli.js playbook list', { encoding: 'utf8' })
    expect(out).toContain('trace-funds')
    expect(out).toContain('scam-topology')
    expect(out).toContain('risk-check')
    expect(out).toContain('entity-profile')
    expect(out).not.toContain('query')
  })

  it('playbook list marks built-ins with [builtin]', () => {
    const out = execSync('node bin/cli.js playbook list', { encoding: 'utf8' })
    expect(out).toContain('[builtin]')
  })

  it('playbook show trace-funds prints step list', () => {
    const out = execSync('node bin/cli.js playbook show trace-funds', { encoding: 'utf8' })
    expect(out).toContain('trace-funds')
    expect(out).toContain('Steps:')
    expect(out).toContain('address_risk')
    expect(out).toContain('track_funds')
    expect(out).not.toContain('probe')
  })

  it('playbook show trace-funds prints parameter spec', () => {
    const out = execSync('node bin/cli.js playbook show trace-funds', { encoding: 'utf8' })
    expect(out).toContain('address')
    expect(out).toContain('required')
  })

  it('playbook show scam-topology prints step list', () => {
    const out = execSync('node bin/cli.js playbook show scam-topology', { encoding: 'utf8' })
    expect(out).toContain('scam-topology')
    expect(out).toContain('address_risk')
    expect(out).toContain('scam_topology')
  })

  it('playbook run trace-funds --dry-run -p address=0x1 prints step plan without MCP calls', () => {
    const out = execSync('node bin/cli.js playbook run trace-funds --dry-run -p address=0x1', {
      encoding: 'utf8',
    })
    expect(out).toContain('dry run')
    expect(out).toContain('address_risk')
    expect(out).toContain('track_funds')
    expect(out).not.toContain('probe')
    expect(out).toContain('"network":"bittensor"')
    expect(out).not.toContain('Error')
  })

  it('playbook run --dry-run shows all steps', () => {
    const out = execSync('node bin/cli.js playbook run trace-funds --dry-run -p address=0x1', {
      encoding: 'utf8',
    })
    expect(out).toContain('Step 1')
    expect(out).toContain('Step 2')
  })

  it('playbook run without name argument exits with error', () => {
    const result = runCLI('playbook run')
    expect(result.code).not.toBe(0)
  })

  it('playbook run nonexistent-playbook exits with error message', () => {
    const result = runCLI('playbook run nonexistent-playbook --dry-run')
    // Should fail because playbook not found
    expect(result.code).not.toBe(0)
    expect(result.output).toMatch(/not found|error/i)
  })
})
