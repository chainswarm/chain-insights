import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import type { Address, Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// Path derived at call time so tests can override HOME.
export function walletPath(): string {
  return path.join(os.homedir(), '.chain-insights', 'wallet.json')
}

// Derive a 32-byte key from the machine identity (hostname + username) and a
// random per-wallet salt. The salt prevents precomputation attacks across wallets.
function deriveKey(salt: Buffer): Buffer {
  return crypto.scryptSync(`${os.hostname()}:${os.userInfo().username}`, salt, 32)
}

interface WalletData {
  salt: string
  iv: string
  tag: string
  data: string
}

export function normalizeWalletPrivateKey(value: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('Stored wallet private key is not a valid 0x-prefixed EVM private key')
  }
  return value as Hex
}

export function walletAddressFromPrivateKey(privateKey: string): Address {
  return privateKeyToAccount(normalizeWalletPrivateKey(privateKey)).address
}

/**
 * Encrypts a private key and writes it to ~/.chain-insights/wallet.json.
 * Uses AES-256-GCM with a machine-identity-derived key and a random per-wallet salt.
 * File is written with 0o600 permissions (owner read/write only).
 *
 * @param privateKey - The EVM private key to encrypt (0x-prefixed)
 */
export async function encryptKey(privateKey: string): Promise<void> {
  const normalizedPrivateKey = normalizeWalletPrivateKey(privateKey)
  const salt = crypto.randomBytes(16)
  const key = deriveKey(salt)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)

  const encrypted = Buffer.concat([cipher.update(normalizedPrivateKey, 'utf8'), cipher.final()])

  // getAuthTag() MUST be called after final()
  const tag = cipher.getAuthTag()

  const walletData: WalletData = {
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('hex'),
  }

  const p = walletPath()
  await mkdir(path.dirname(p), { recursive: true })
  await writeFile(p, JSON.stringify(walletData, null, 2) + '\n', { mode: 0o600 })
}

export interface SetWalletPrivateKeyOptions {
  /** Overwrite an existing wallet. The previous ciphertext is backed up first. */
  force?: boolean
}

/**
 * Best-effort address of the currently stored wallet, for overwrite messaging.
 * Returns null when the wallet can't be decrypted (e.g. hostname/username
 * changed) — the overwrite is still refused, just without naming the address.
 */
async function existingWalletAddress(): Promise<Address | null> {
  try {
    return walletAddressFromPrivateKey(await decryptKey())
  } catch {
    return null
  }
}

/**
 * Copies the existing wallet.json to a timestamped `.bak-*` sibling before it
 * is overwritten, preserving the 0o600 permission. No-op when absent.
 */
async function backupExistingWallet(): Promise<void> {
  const p = walletPath()
  let raw: string
  try {
    raw = await readFile(p, 'utf8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  await writeFile(`${p}.bak-${stamp}`, raw, { mode: 0o600 })
}

/**
 * Encrypts and stores a private key, refusing to overwrite an existing wallet
 * unless `force` is set. Importing a new key over a funded wallet discards the
 * only local copy of the old key, so the overwrite is guarded and the previous
 * ciphertext is backed up.
 */
export async function setWalletPrivateKey(
  privateKey: string,
  options: SetWalletPrivateKeyOptions = {}
): Promise<Address> {
  const normalizedPrivateKey = normalizeWalletPrivateKey(privateKey)
  const address = walletAddressFromPrivateKey(normalizedPrivateKey)

  if (await isWalletConfigured()) {
    if (!options.force) {
      const existing = await existingWalletAddress()
      const which = existing ? ` (${existing})` : ''
      throw new Error(
        `A payment wallet already exists${which}. Importing a new key overwrites it and permanently ` +
          `discards the old key. Re-run \`cia wallet import <key> --force\` to replace it; ` +
          `the previous encrypted key is backed up next to wallet.json first.`
      )
    }
    await backupExistingWallet()
  }

  await encryptKey(normalizedPrivateKey)
  return address
}

/**
 * Reads and decrypts the private key from ~/.chain-insights/wallet.json.
 * Throws a human-readable error if wallet is absent or decryption fails.
 *
 * @returns The decrypted EVM private key string
 */
export async function decryptKey(): Promise<string> {
  let raw: string
  try {
    raw = await readFile(walletPath(), 'utf8')
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') {
      throw new Error(
        'Wallet not configured. Run `cia wallet create` to generate one, or `cia wallet import <private-key>` to use an existing key. Then run `cia wallet ready`.'
      )
    }
    throw err
  }

  try {
    const stored = JSON.parse(raw) as WalletData
    const salt = Buffer.from(stored.salt, 'hex')
    const key = deriveKey(salt)
    const iv = Buffer.from(stored.iv, 'hex')
    const tag = Buffer.from(stored.tag, 'hex')
    const encrypted = Buffer.from(stored.data, 'hex')

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    // setAuthTag() MUST be called before update()
    decipher.setAuthTag(tag)

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])

    return decrypted.toString('utf8')
  } catch {
    throw new Error(
      'Wallet decryption failed. If you changed your hostname or username, re-import it with `cia wallet import <private-key>`.'
    )
  }
}

/**
 * Returns true if wallet.json exists, false if absent.
 * Does not validate the wallet contents.
 */
export async function isWalletConfigured(): Promise<boolean> {
  try {
    await stat(walletPath())
    return true
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') return false
    throw err
  }
}
