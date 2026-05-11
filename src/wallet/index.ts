import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'

// Path derived at call time so tests can override HOME.
export function walletPath(): string {
  return path.join(os.homedir(), '.chain-insights', 'wallet.json')
}

// Derive a 32-byte key from the machine identity (hostname + username) and a
// random per-wallet salt. The salt prevents precomputation attacks across wallets.
function deriveKey(salt: Buffer): Buffer {
  return crypto.scryptSync(
    `${os.hostname()}:${os.userInfo().username}`,
    salt,
    32,
  )
}

interface WalletData {
  salt: string
  iv: string
  tag: string
  data: string
}

/**
 * Encrypts a private key and writes it to ~/.chain-insights/wallet.json.
 * Uses AES-256-GCM with a machine-identity-derived key and a random per-wallet salt.
 * File is written with 0o600 permissions (owner read/write only).
 *
 * @param privateKey - The EVM private key to encrypt (0x-prefixed)
 */
export async function encryptKey(privateKey: string): Promise<void> {
  const salt = crypto.randomBytes(16)
  const key = deriveKey(salt)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)

  const encrypted = Buffer.concat([
    cipher.update(privateKey, 'utf8'),
    cipher.final(),
  ])

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
        'Wallet not configured. Run `chain-insights config set walletPrivateKey <key>` to enable paid MCP calls',
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

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ])

    return decrypted.toString('utf8')
  } catch {
    throw new Error(
      'Wallet decryption failed. If you changed your hostname or username, re-configure with `chain-insights config set walletPrivateKey <key>`.',
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
