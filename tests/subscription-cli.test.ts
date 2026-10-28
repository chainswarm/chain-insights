import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pad, toHex } from 'viem'

const srcCli = join(process.cwd(), 'src', 'cli.ts')
const tsxLoader = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'loader.mjs')

describe('cia subscription', () => {
  let home: string

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'ci-subscription-cli-'))
    // The low-level writer plants the public key 1, as an older version stored it.
    const previous = process.env['HOME']
    process.env['HOME'] = home
    try {
      const { encryptKey } = await import('../src/wallet/index.js')
      await encryptKey(pad(toHex(1n), { size: 32 }))
    } finally {
      process.env['HOME'] = previous
    }
  })

  afterAll(() => rmSync(home, { recursive: true, force: true }))

  const cia = (...args: string[]) =>
    spawnSync(process.execPath, ['--import', tsxLoader, srcCli, ...args], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home, NO_COLOR: '1' },
      input: '',
    })

  it('cia subscription lists topup, buy and status', () => {
    const out = cia('subscription', '--help').stdout
    for (const sub of ['topup', 'buy', 'status']) expect(out).toMatch(new RegExp(`^\\s+${sub}\\b`, 'm'))
  })

  it('subscription topup refuses a public-key wallet', () => {
    const result = cia('subscription', 'topup', '--no-open')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("This wallet's key is public")
    expect(result.stdout).not.toContain('Top-up page')
  })

  it('buy refuses a non-TTY stdin, over-cap days and a public key before any read', () => {
    const cases = [
      { args: ['--days', '1'], error: 'stdin is not a terminal' },
      { args: ['--days', '91'], error: 'from 1 to 90' },
      { args: ['--days', '1', '--yes'], error: "This wallet's key is public" },
    ]
    for (const { args, error } of cases) {
      const result = cia('subscription', 'buy', ...args)
      expect(result.status, args.join(' ')).toBe(1)
      expect(result.stderr).toContain(error)
    }
  })

  it('wallet create without --replace names the replace path for a public key', () => {
    const result = cia('wallet', 'create')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('cia wallet create --replace')
  })
})
