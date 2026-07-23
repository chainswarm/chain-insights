// Vanity-address lookalike matching (rbmk#462), the string-similarity core of
// the address-poisoning detector. Poisoning attackers mint a vanity address
// that visually mimics a victim's real counterparty, then dust the victim so
// the spoofed address lands in their history and gets copy-pasted into a later
// send. WHICH characters an attacker can cheaply grind depends on the address
// family:
//
//   • EVM (hex, `0x…`): a human eyeballs `0xABCD…1234` — both ends. Grinding
//     both a prefix and a suffix is feasible, so the match requires shared
//     prefix AND suffix at equal length.
//   • ss58 (Substrate, base58, `5…`): the address carries a trailing checksum,
//     so only the PREFIX can be cheaply ground. Real campaigns (seen live on
//     bittensor 2026-07: 129 vanity senders sharing `5EYCAe5jLQhn6ofDS…`
//     impersonating a ~2M-TAO hot wallet) match a long shared prefix only. The
//     match requires a long shared prefix at equal length; the suffix is NOT
//     required.
//
// Ported and generalized from the vanity-match arm of data-pipeline
// internal/recipes/addresspoisoning.go (DEC-7); ss58 flexibility added
// 2026-07-23 from the live bittensor finding.

export type AddressFamily = 'evm' | 'ss58' | 'other'

// EVM: prefix + suffix envelope a human compares.
export const EVM_PREFIX_LEN = 6
export const EVM_SUFFIX_LEN = 4
// ss58: prefix-only, but long enough to clear the constant `5…` lead and the
// low-entropy leading bytes (the SS58 type prefix). 14 chars ≈ the full type
// prefix plus several ground public-key bytes — below this, collisions are
// structural noise, not deliberate grinding.
export const SS58_PREFIX_MIN = 14

const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/
// Base58 (Bitcoin alphabet: no 0 O I l), Substrate addresses start with '5'
// and are ~47–48 chars for the generic (type 42) network.
const SS58_ADDRESS = /^5[1-9A-HJ-NP-Za-km-z]{45,49}$/

export function addressFamily(addr: string): AddressFamily {
  const a = addr.trim()
  if (HEX_ADDRESS.test(a)) return 'evm'
  if (SS58_ADDRESS.test(a)) return 'ss58'
  return 'other'
}

function sharedPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i += 1
  return i
}

// isLookalike reports whether `candidate` is a vanity lookalike of `real`,
// applying the family-appropriate rule. EVM comparison is case-insensitive
// (hex); ss58 is case-SENSITIVE (base58 encodes information in case).
export function isLookalike(candidate: string, real: string): boolean {
  const cRaw = candidate.trim()
  const rRaw = real.trim()
  if (!cRaw || !rRaw) return false
  if (cRaw === rRaw) return false // identical is the real address, not a lookalike
  if (cRaw.length !== rRaw.length) return false

  const family = addressFamily(rRaw)
  if (family !== addressFamily(cRaw)) return false // never cross address families

  if (family === 'ss58') {
    // Prefix-only: long shared lead, different tail (checksum can't be ground).
    if (sharedPrefixLen(cRaw, rRaw) < SS58_PREFIX_MIN) return false
    return true
  }

  // EVM and 'other' both use the prefix+suffix envelope. EVM is
  // case-insensitive; 'other' we compare verbatim (unknown alphabet).
  const c = family === 'evm' ? cRaw.toLowerCase() : cRaw
  const r = family === 'evm' ? rRaw.toLowerCase() : rRaw
  if (c === r) return false
  const [p, s] = family === 'evm' ? [EVM_PREFIX_LEN, EVM_SUFFIX_LEN] : [EVM_PREFIX_LEN, EVM_SUFFIX_LEN]
  if (c.length < p + s) return false
  if (c.slice(0, p) !== r.slice(0, p)) return false
  if (c.slice(c.length - s) !== r.slice(r.length - s)) return false
  return true
}

// sharedVanityPrefix returns the shared prefix length between two addresses of
// the SAME family, or 0 if they are not comparable. Used by the cluster signal
// to group a spray of vanity dusters by the prefix they ground.
export function sharedVanityPrefix(a: string, b: string): number {
  if (addressFamily(a) !== addressFamily(b)) return 0
  if (a.length !== b.length) return 0
  return sharedPrefixLen(a, b)
}
