import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('cia monitor CLI surface', () => {
  it('registers every case-tracking subcommand', () => {
    const help = execFileSync('npx', ['tsx', 'src/cli.ts', 'monitor', '--help'], { encoding: 'utf8' })
    for (const sub of ['run', 'status', 'case', 'render', 'init']) {
      expect(help).toContain(sub)
    }
  })

  it('removes the retired subcommands from the help surface', () => {
    const help = execFileSync('npx', ['tsx', 'src/cli.ts', 'monitor', '--help'], { encoding: 'utf8' })
    for (const sub of ['watch', 'watchlist', 'review', 'report', 'export', 'alerts', 'rebuild']) {
      expect(help).not.toContain(sub)
    }
  })

  it('registers monitor case add|add-seed|remove-seed|list|close', () => {
    const sub = execFileSync('npx', ['tsx', 'src/cli.ts', 'monitor', 'case', '--help'], { encoding: 'utf8' })
    for (const cmd of ['add', 'add-seed', 'remove-seed', 'list', 'close']) {
      expect(sub).toContain(cmd)
    }
  })

  it('registers monitor render with --force and optional case_id', () => {
    const sub = execFileSync('npx', ['tsx', 'src/cli.ts', 'monitor', 'render', '--help'], { encoding: 'utf8' })
    expect(sub).toContain('--force')
    expect(sub).toContain('[case_id]')
  })

  it('monitor run calls the new runMonitorOnce signature (no hooks, no client wiring)', () => {
    const src = readFileSync('src/cli.ts', 'utf8')
    expect(src).toContain('runMonitorOnce(undefined as never, workspaceRoot, config, Date.now())')
    expect(src).not.toContain('traceCase: (')
    expect(src).not.toContain('renderCase: (')
  })

  it('monitor run acquires the PID run lock (spec req 4)', () => {
    // CLI actions are wired, not unit-run: assert at the source level that
    // the run entry point goes through acquireRunLock.
    const src = readFileSync('src/cli.ts', 'utf8')
    const matches = src.match(/acquireRunLock\(workspaceRoot\)/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(1)
    expect(src).toContain('already running (pid ')
  })

  it('registers monitor init victim with the spec options (victim lane spec req 7)', () => {
    const help = execFileSync('npx', ['tsx', 'src/cli.ts', 'monitor', '--help'], { encoding: 'utf8' })
    expect(help).toContain('init')
    const sub = execFileSync('npx', ['tsx', 'src/cli.ts', 'monitor', 'init', '--help'], { encoding: 'utf8' })
    for (const opt of ['--case-id', '--network', '--seed', '--note']) expect(sub).toContain(opt)
  })

  it('init output references no watchlist or alerts tripwires', () => {
    const src = readFileSync('src/cli.ts', 'utf8')
    expect(src).not.toContain('managed seed entr')
    expect(src).not.toContain('cia monitor alerts list')
  })
})