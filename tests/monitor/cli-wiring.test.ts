import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('cia monitor CLI surface', () => {
  it('registers every spec subcommand', () => {
    const help = execFileSync('npx', ['tsx', 'src/cli.ts', 'monitor', '--help'], { encoding: 'utf8' })
    for (const sub of ['run', 'watch', 'status', 'case', 'review', 'report', 'export', 'alerts', 'rebuild']) {
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

  it('monitor run and watch acquire the PID run lock (spec req 4)', () => {
    // CLI actions are wired, not unit-run: assert at the source level that
    // both loop entry points go through acquireRunLock.
    const src = readFileSync('src/cli.ts', 'utf8')
    const matches = src.match(/acquireRunLock\(workspaceRoot\)/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(2)
    expect(src).toContain('already running (pid ')
  })
})
