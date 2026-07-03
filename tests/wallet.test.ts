import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('Wallet module (MCP-01)', () => {
  let fakeHome: string
  let prevHome: string | undefined

  beforeEach(async () => {
    fakeHome = join(tmpdir(), `ci-wallet-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(join(fakeHome, '.chain-insights'), { recursive: true })
    prevHome = process.env['HOME']
    process.env['HOME'] = fakeHome
  })

  afterEach(async () => {
    process.env['HOME'] = prevHome
    await rm(fakeHome, { recursive: true, force: true })
  })

  it('isWalletConfigured() returns false when wallet.json absent', async () => {
    const { isWalletConfigured } = await import('../src/wallet/index.js')
    const result = await isWalletConfigured()
    expect(result).toBe(false)
  })

  it('encryptKey + decryptKey round-trip returns original key', async () => {
    const { encryptKey, decryptKey } = await import('../src/wallet/index.js')
    const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    await encryptKey(testKey)
    const recovered = await decryptKey()
    expect(recovered).toBe(testKey)
  })

  it('encryptKey rejects invalid EVM private keys before writing wallet.json', async () => {
    const { encryptKey, isWalletConfigured } = await import('../src/wallet/index.js')
    await expect(encryptKey('0xbadkey')).rejects.toThrow('valid 0x-prefixed EVM private key')
    await expect(isWalletConfigured()).resolves.toBe(false)
  })

  it('setWalletPrivateKey stores the key and returns the derived payer address', async () => {
    const { setWalletPrivateKey, decryptKey } = await import('../src/wallet/index.js')
    const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    const address = await setWalletPrivateKey(testKey)
    const recovered = await decryptKey()
    expect(address).toBe('0xC96aAa54E2d44c299564da76e1cD3184A2386B8D')
    expect(recovered).toBe(testKey)
  })

  it('setWalletPrivateKey refuses to overwrite an existing wallet without force', async () => {
    const { setWalletPrivateKey, decryptKey } = await import('../src/wallet/index.js')
    const firstKey = '0x1111111111111111111111111111111111111111111111111111111111111111'
    const secondKey = '0x2222222222222222222222222222222222222222222222222222222222222222'
    await setWalletPrivateKey(firstKey)

    await expect(setWalletPrivateKey(secondKey)).rejects.toThrow(/already exists/)
    // The original key is untouched.
    expect(await decryptKey()).toBe(firstKey)
  })

  it('setWalletPrivateKey with force overwrites and backs up the previous wallet', async () => {
    const { setWalletPrivateKey, decryptKey, walletPath } = await import('../src/wallet/index.js')
    const { readdir } = await import('node:fs/promises')
    const { dirname, basename } = await import('node:path')
    const firstKey = '0x1111111111111111111111111111111111111111111111111111111111111111'
    const secondKey = '0x2222222222222222222222222222222222222222222222222222222222222222'
    await setWalletPrivateKey(firstKey)

    await setWalletPrivateKey(secondKey, { force: true })

    expect(await decryptKey()).toBe(secondKey)
    const dir = dirname(walletPath())
    const entries = await readdir(dir)
    const backups = entries.filter((name) => name.startsWith(`${basename(walletPath())}.bak`))
    expect(backups.length).toBe(1)
  })

  it('wallet.json is written with 0o600 permissions', async () => {
    const { encryptKey, walletPath } = await import('../src/wallet/index.js')
    const { stat } = await import('node:fs/promises')
    const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    await encryptKey(testKey)
    const st = await stat(walletPath())
    expect((st.mode & 0o777).toString(8)).toBe('600')
  })

  it('decryptKey() throws "Wallet not configured" when wallet.json absent', async () => {
    const { decryptKey } = await import('../src/wallet/index.js')
    await expect(decryptKey()).rejects.toThrow('Wallet not configured')
  })

  it('isWalletConfigured() returns true after encryptKey() writes wallet.json', async () => {
    const { encryptKey, isWalletConfigured } = await import('../src/wallet/index.js')
    const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    await encryptKey(testKey)
    const result = await isWalletConfigured()
    expect(result).toBe(true)
  })

  it('wallet.json contains a salt field (CR-02: random per-wallet salt)', async () => {
    const { encryptKey, walletPath } = await import('../src/wallet/index.js')
    const { readFile } = await import('node:fs/promises')
    const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    await encryptKey(testKey)
    const raw = await readFile(walletPath(), 'utf8')
    const data = JSON.parse(raw) as Record<string, unknown>
    expect(typeof data['salt']).toBe('string')
    // salt is 16 random bytes stored as hex — 32 hex chars
    expect((data['salt'] as string).length).toBe(32)
  })

  it('two encryptKey() calls produce different ciphertexts (random salt)', async () => {
    const { encryptKey, walletPath } = await import('../src/wallet/index.js')
    const { readFile, writeFile } = await import('node:fs/promises')
    const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    await encryptKey(testKey)
    const raw1 = await readFile(walletPath(), 'utf8')
    // Remove wallet so encryptKey writes fresh
    await writeFile(walletPath(), '{}', 'utf8')
    await encryptKey(testKey)
    const raw2 = await readFile(walletPath(), 'utf8')
    const d1 = JSON.parse(raw1) as Record<string, unknown>
    const d2 = JSON.parse(raw2) as Record<string, unknown>
    // Different salt each time means different ciphertext
    expect(d1['salt']).not.toBe(d2['salt'])
    expect(d1['data']).not.toBe(d2['data'])
  })
})
