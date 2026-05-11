import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'

describe('CLI scaffold (FOUND-02)', () => {
  it('--help prints chain-insights name', () => {
    const out = execSync('node bin/cli.js --help', { encoding: 'utf8' })
    expect(out).toContain('chain-insights')
  })

  it('--help lists serve subcommand', () => {
    const out = execSync('node bin/cli.js --help', { encoding: 'utf8' })
    expect(out).toContain('serve')
  })

  it('--help lists status subcommand', () => {
    const out = execSync('node bin/cli.js --help', { encoding: 'utf8' })
    expect(out).toContain('status')
  })

  it('--help lists wallet subcommand', () => {
    const out = execSync('node bin/cli.js --help', { encoding: 'utf8' })
    expect(out).toContain('wallet')
  })

  it('wallet --help lists balance and topup subcommands', () => {
    const out = execSync('node bin/cli.js wallet --help', { encoding: 'utf8' })
    expect(out).toContain('balance')
    expect(out).toContain('topup')
  })

  it('--version prints version from package.json', () => {
    const out = execSync('node bin/cli.js --version', { encoding: 'utf8' })
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
