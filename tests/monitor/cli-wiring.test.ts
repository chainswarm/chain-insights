import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('cia monitor CLI surface', () => {
  it('registers every spec subcommand', () => {
    const help = execFileSync('npx', ['tsx', 'src/cli.ts', 'monitor', '--help'], { encoding: 'utf8' })
    for (const sub of ['run', 'watch', 'status', 'case', 'review', 'report', 'export', 'alerts', 'rebuild', 'render']) {
      expect(help).toContain(sub)
    }
  })

  it('registers monitor case add|add-seed|remove-seed|list|close', () => {
    const sub = execFileSync('npx', ['tsx', 'src/cli.ts', 'monitor', 'case', '--help'], { encoding: 'utf8' })
    for (const cmd of ['add', 'add-seed', 'remove-seed', 'list', 'close']) {
      expect(sub).toContain(cmd)
    }
  })

  it('registers monitor watchlist add|list|remove', () => {
    const help = execFileSync('npx', ['tsx', 'src/cli.ts', 'monitor', '--help'], { encoding: 'utf8' })
    expect(help).toContain('watchlist')
    const sub = execFileSync('npx', ['tsx', 'src/cli.ts', 'monitor', 'watchlist', '--help'], { encoding: 'utf8' })
    for (const cmd of ['add', 'list', 'remove']) {
      expect(sub).toContain(cmd)
    }
  })

  it('registers monitor render with --force and optional case_id', () => {
    const sub = execFileSync('npx', ['tsx', 'src/cli.ts', 'monitor', 'render', '--help'], { encoding: 'utf8' })
    expect(sub).toContain('--force')
    expect(sub).toContain('[case_id]')
  })

  it('monitor run and watch wire the render hook (spec req 1)', () => {
    const src = readFileSync('src/cli.ts', 'utf8')
    const matches = src.match(/renderCase: \(/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })

  it('monitor run and watch acquire the PID run lock (spec req 4)', () => {
    // CLI actions are wired, not unit-run: assert at the source level that
    // both loop entry points go through acquireRunLock.
    const src = readFileSync('src/cli.ts', 'utf8')
    const matches = src.match(/acquireRunLock\(workspaceRoot\)/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(2)
    expect(src).toContain('already running (pid ')
  })

  it('registers monitor init victim with the spec options (victim lane spec req 7)', () => {
    const help = execFileSync('npx', ['tsx', 'src/cli.ts', 'monitor', '--help'], { encoding: 'utf8' })
    expect(help).toContain('init')
    const sub = execFileSync('npx', ['tsx', 'src/cli.ts', 'monitor', 'init', '--help'], { encoding: 'utf8' })
    for (const opt of ['--case-id', '--network', '--seed', '--note']) expect(sub).toContain(opt)
  })

  it('monitor run registers --force-trace (victim lane spec req 2)', () => {
    const sub = execFileSync('npx', ['tsx', 'src/cli.ts', 'monitor', 'run', '--help'], { encoding: 'utf8' })
    expect(sub).toContain('--force-trace')
  })
})
