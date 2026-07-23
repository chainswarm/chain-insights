// Vanity-address lookalike matching (rbmk#462), the string-similarity core of
// the address-poisoning detector. Poisoning attackers mint a vanity address
// that shares the visible prefix and suffix of a victim's real counterparty
// (the part a human eyeballs) while the middle differs, then send dust from it
// so the spoofed address lands in the victim's history and gets copy-pasted
// into a later send. A lookalike therefore: has the same length as the real
// address, shares the first K and last K characters, is NOT the real address,
// and differs somewhere in the middle. Ported from the vanity-match arm of
// data-pipeline internal/recipes/addresspoisoning.go (DEC-7).

export const LOOKALIKE_PREFIX_LEN = 6
export const LOOKALIKE_SUFFIX_LEN = 4

function normalize(addr: string): string {
  return addr.trim().toLowerCase()
}

// isLookalike reports whether `candidate` is a vanity lookalike of `real`.
// prefixLen/suffixLen are the visible-character counts a human compares.
export function isLookalike(
  candidate: string,
  real: string,
  prefixLen: number = LOOKALIKE_PREFIX_LEN,
  suffixLen: number = LOOKALIKE_SUFFIX_LEN,
): boolean {
  const c = normalize(candidate)
  const r = normalize(real)
  if (!c || !r) return false
  if (c === r) return false // identical is the real address, not a lookalike
  if (c.length !== r.length) return false
  if (c.length < prefixLen + suffixLen) return false
  if (c.slice(0, prefixLen) !== r.slice(0, prefixLen)) return false
  if (c.slice(c.length - suffixLen) !== r.slice(r.length - suffixLen)) return false
  return true // shared visible envelope, different middle
}
