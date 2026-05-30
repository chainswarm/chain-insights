import type { CaseExportMode } from './schema.js'

const EVM_ADDRESS_RE = /\b0x[a-fA-F0-9]{40}\b/g
const SUBSTRATE_ADDRESS_RE = /\b5[1-9A-HJ-NP-Za-km-z]{20,64}\b/g
const SECRET_PATTERNS = [
  /\bci_test_[A-Za-z0-9_-]+\b/g,
  /\b(?:privateKey|walletPrivateKey|secret|token|authorization)\s*[:=]\s*["']?[^"'\s]+/gi,
  /\b0x[a-fA-F0-9]{64}\b/g,
]

export type Redactor = {
  text(input: string): string
  value<T>(input: T): T
  aliasFor(address: string): string
  redactions(): string[]
}

export function createRedactor(mode: CaseExportMode): Redactor {
  const aliases = new Map<string, string>()
  const redactions = new Set<string>()

  function aliasFor(address: string): string {
    const existing = aliases.get(address)
    if (existing) return existing
    const alias = `addr_${String(aliases.size + 1).padStart(3, '0')}`
    aliases.set(address, alias)
    redactions.add(`aliased:${alias}`)
    return alias
  }

  function redactSecrets(input: string): string {
    let output = input
    for (const pattern of SECRET_PATTERNS) {
      output = output.replace(pattern, () => {
        redactions.add('secret')
        return '[redacted-secret]'
      })
    }
    return output
  }

  function text(input: string): string {
    let output = redactSecrets(input)
    if (mode === 'public') {
      output = output.replace(SUBSTRATE_ADDRESS_RE, match => aliasFor(match))
      output = output.replace(EVM_ADDRESS_RE, match => aliasFor(match))
    }
    return output
  }

  function value<T>(input: T): T {
    if (typeof input === 'string') return text(input) as T
    if (Array.isArray(input)) return input.map(item => value(item)) as T
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input).map(([key, entry]) => [key, value(entry)]),
      ) as T
    }
    return input
  }

  return {
    text,
    value,
    aliasFor,
    redactions: () => [...redactions].sort(),
  }
}
