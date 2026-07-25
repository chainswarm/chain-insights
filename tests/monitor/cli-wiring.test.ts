import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('cia monitor CLI surface', () => {
  it('registers every spec subcommand', () => {
    const help = execFileSync('npx', ['tsx', 'src/cli.ts', 'monitor', '--help'], { encoding: 'utf8' })
    for (const sub of ['run', 'watch', 'status', 'case', 'review', 'report', 'export', 'alerts', 'rebuild']) {
      expect(help).toContain(sub)
    }
  })
})
