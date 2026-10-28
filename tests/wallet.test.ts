import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { keccak256, pad, toHex, type Hex } from 'viem'
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts'

// A key no one else knows. A literal such as 0xdeadbeef... repeats four bytes
// and is refused as public (src/wallet/known-keys.ts).
const privateTestKey = (label: string): Hex => keccak256(toHex(`chain-insights wallet test ${label}`))

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
    const testKey = privateTestKey('stores')
    const address = await setWalletPrivateKey(testKey)
    const recovered = await decryptKey()
    expect(address).toBe(privateKeyToAccount(testKey).address)
    expect(recovered).toBe(testKey)
  })

  it('generates a valid EVM private key for a new wallet', async () => {
    const { generateWalletPrivateKey } = await import('../src/wallet/create.js')
    const generated = generateWalletPrivateKey()
    expect(generated).toMatch(/^0x[0-9a-f]{64}$/i)
  })

  it('formats a boxed backup warning with a no-color fallback', async () => {
    const { formatWalletBackupWarning } = await import('../src/wallet/create.js')
    const key = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    const output = formatWalletBackupWarning(key, { color: false })
    const lines = output.split('\n')

    expect(lines[0]).toMatch(/^┌─+┐$/)
    expect(lines.at(-1)).toMatch(/^└─+┘$/)
    expect(output).toContain('BACK UP YOUR PRIVATE KEY NOW')
    expect(output).toContain(key)
    expect(output).toContain('Type BACKED UP to continue')
    expect(output).not.toContain('\u001b[')
    expect(lines.every((line) => line.startsWith('│ ') || /^┌|^└/.test(line))).toBe(true)
  })

  it('adds terminal color to the backup warning when enabled', async () => {
    const { formatWalletBackupWarning } = await import('../src/wallet/create.js')
    const key = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    expect(formatWalletBackupWarning(key, { color: true })).toContain('\u001b[')
  })

  it('accepts only the explicit backup confirmation phrase', async () => {
    const { isWalletBackupConfirmed } = await import('../src/wallet/create.js')
    expect(isWalletBackupConfirmed('BACKED UP')).toBe(true)
    expect(isWalletBackupConfirmed(' backed up ')).toBe(false)
    expect(isWalletBackupConfirmed('')).toBe(false)
  })

  it('setWalletPrivateKey refuses to overwrite an existing wallet without force', async () => {
    const { setWalletPrivateKey, decryptKey } = await import('../src/wallet/index.js')
    const firstKey = privateTestKey('first')
    const secondKey = privateTestKey('second')
    await setWalletPrivateKey(firstKey)

    await expect(setWalletPrivateKey(secondKey)).rejects.toThrow(/already exists/)
    // The original key is untouched.
    expect(await decryptKey()).toBe(firstKey)
  })

  it('setWalletPrivateKey with force overwrites and backs up the previous wallet', async () => {
    const { setWalletPrivateKey, decryptKey, walletPath } = await import('../src/wallet/index.js')
    const { readdir } = await import('node:fs/promises')
    const { dirname, basename } = await import('node:path')
    const firstKey = privateTestKey('first')
    const secondKey = privateTestKey('second')
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

describe('public private keys are refused (src/wallet/known-keys.ts)', () => {
  let fakeHome: string
  let prevHome: string | undefined

  beforeEach(async () => {
    fakeHome = join(tmpdir(), `ci-wallet-public-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(join(fakeHome, '.chain-insights'), { recursive: true })
    prevHome = process.env['HOME']
    process.env['HOME'] = fakeHome
  })

  afterEach(async () => {
    process.env['HOME'] = prevHome
    await rm(fakeHome, { recursive: true, force: true })
  })

  const keyOf = (value: bigint): Hex => pad(toHex(value), { size: 32 })

  it('refuses the private key 1', async () => {
    const { setWalletPrivateKey, isWalletConfigured } = await import('../src/wallet/index.js')
    await expect(setWalletPrivateKey(keyOf(1n))).rejects.toThrow('small number')
    expect(await isWalletConfigured()).toBe(false)
  })

  it('refuses a key below 2^128', async () => {
    const { publicKeyReason } = await import('../src/wallet/known-keys.js')
    for (let value = 2n; value <= 16n; value++) {
      expect(publicKeyReason(keyOf(value)), value.toString()).toBe('the key is a small number')
    }
    expect(publicKeyReason(keyOf((1n << 128n) - 1n))).toBe('the key is a small number')
    expect(publicKeyReason(keyOf(1n << 128n))).not.toBe('the key is a small number')
  })

  it('refuses a repeated-byte key', async () => {
    const { publicKeyReason } = await import('../src/wallet/known-keys.js')
    expect(publicKeyReason(`0x${'ab'.repeat(32)}`)).toBe('the key repeats a few bytes')
    expect(publicKeyReason(`0x${'deadbeef'.repeat(8)}`)).toBe('the key repeats a few bytes')
  })

  it('refuses anvil account 0 derived from the public test mnemonic', async () => {
    const { setWalletPrivateKey } = await import('../src/wallet/index.js')
    const account = mnemonicToAccount('test test test test test test test test test test test junk')
    const key = toHex(account.getHdKey().privateKey!)
    await expect(setWalletPrivateKey(key)).rejects.toThrow('public test mnemonic')
    for (const index of [1, 19]) {
      const other = mnemonicToAccount('test test test test test test test test test test test junk', { addressIndex: index })
      const { isPrivateKeyPublic } = await import('../src/wallet/known-keys.js')
      expect(isPrivateKeyPublic(toHex(other.getHdKey().privateKey!))).toBe(true)
    }
  })

  it('a generated key passes the guard 1000 times', async () => {
    const { generateWalletPrivateKey } = await import('../src/wallet/create.js')
    const { isPrivateKeyPublic } = await import('../src/wallet/known-keys.js')
    for (let i = 0; i < 1000; i++) expect(isPrivateKeyPublic(generateWalletPrivateKey())).toBe(false)
  })

  it('a stored public key loads flagged and topup refuses it', async () => {
    // encryptKey is the low-level writer: it plants the key an older version stored.
    const { encryptKey } = await import('../src/wallet/index.js')
    const { assertWalletKeyNotPublic, getWalletAccount } = await import('../src/wallet/tools.js')
    const { PUBLIC_KEY_WALLET_TEXT } = await import('../src/wallet/known-keys.js')
    await encryptKey(keyOf(1n))
    const account = await getWalletAccount()
    expect(account.address).toBe('0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf')
    expect(account.keyIsPublic).toBe(true)
    expect(() => assertWalletKeyNotPublic(account)).toThrow(PUBLIC_KEY_WALLET_TEXT)
    const { approvePaymentAllowance } = await import('../src/wallet/tools.js')
    await expect(approvePaymentAllowance(account)).rejects.toThrow(PUBLIC_KEY_WALLET_TEXT)
    await encryptKey(privateTestKey('private'))
    expect((await getWalletAccount()).keyIsPublic).toBeUndefined()
  })

  it('create --replace replaces only a public key and backs it up', async () => {
    const { encryptKey, decryptKey, replacePublicWallet, walletPath } = await import('../src/wallet/index.js')
    const { readdir } = await import('node:fs/promises')
    const { dirname, basename } = await import('node:path')
    const backups = async () =>
      (await readdir(dirname(walletPath()))).filter((name) => name.startsWith(`${basename(walletPath())}.bak`))

    await expect(replacePublicWallet(privateTestKey('new'))).rejects.toThrow('no readable wallet exists')

    const kept = privateTestKey('kept')
    await encryptKey(kept)
    await expect(replacePublicWallet(privateTestKey('new'))).rejects.toThrow("This wallet's key is private")
    expect(await decryptKey()).toBe(kept)
    expect(await backups()).toHaveLength(0)

    await encryptKey(keyOf(1n))
    const address = await replacePublicWallet(privateTestKey('new'))
    expect(address).toBe(privateKeyToAccount(privateTestKey('new')).address)
    expect(await decryptKey()).toBe(privateTestKey('new'))
    expect(await backups()).toHaveLength(1)
  })
})
