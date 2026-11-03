/**
 * A node label or link type written in the wrong case is spelled the graph's way.
 *
 * Labels and link types are case sensitive. `(a:address {address: "0x…"})`
 * matches nothing and the read answers zero rows with no error, so the model
 * tells the user the address has no activity. Claude Desktop did exactly that
 * for the basket router on 2026-10-21 (skill loop, basket round 8): its links
 * were there under `:Address`.
 *
 * Only a name that is a known label or link type, in another case, after the
 * `:` (or `|`) of a node or link pattern is rewritten. Text inside quotes and a
 * map value such as `{address: address}` stay as written.
 */

const NAMES = [
  // topology node labels
  'Account', 'Address', 'Bridge', 'Bundler', 'Chain', 'Contract', 'EntryPoint', 'Exchange', 'IssuerFrozen', 'Launchpad',
  'Mixer', 'NFT', 'OnMoneyTrail', 'Paymaster', 'Poisoned', 'Pool', 'Protocol', 'Sanctioned', 'Scam', 'SmartAccount',
  'Targeted', 'Token', 'Victim',
  // chain lookups
  'Transaction', 'Block', 'Head',
  // topology link types
  'ADDED_LIQUIDITY', 'APPROVED', 'BRIDGED', 'BUNDLED', 'DEPLOYED_CONTRACT', 'FLOWS_TO', 'LINKED', 'OPERATED_BY',
  'REMOVED_LIQUIDITY', 'SIGNED_AUTHORIZATION', 'SIGNED_FOR', 'SPONSORED', 'SWAPPED', 'TRANSFERRED',
  // facts link types
  'TRANSFER', 'BRIDGE_CROSSING', 'SWAP', 'LIQUIDITY_ADD', 'LIQUIDITY_REMOVE',
]

const CANONICAL = new Map(NAMES.map((name) => [name.toLowerCase(), name]))
const IDENT = /[A-Za-z0-9_]/

function prevNonSpace(text: string, from: number): number {
  let i = from
  while (i >= 0 && /\s/.test(text[i])) i--
  return i
}

/** True when the `:` or `|` at `at` opens a label or link type, not a map value. */
function opensLabel(text: string, at: number): boolean {
  let i = prevNonSpace(text, at - 1)
  if (i < 0) return false
  // `[:TRANSFER|swap]`: a `|` counts only after a link type of its own.
  if (text[at] !== '|' && (text[i] === '(' || text[i] === '[')) return true
  if (!IDENT.test(text[i])) return false
  while (i >= 0 && IDENT.test(text[i])) i--
  const before = prevNonSpace(text, i)
  // `(a:Address:contract)`: the name before this `:` is itself a label.
  if (before >= 0 && (text[before] === ':' || text[before] === '|')) return opensLabel(text, before)
  return text[at] === ':' && before >= 0 && (text[before] === '(' || text[before] === '[')
}

function fixSegment(segment: string): string {
  return segment.replace(/([:|])(\s*)([A-Za-z_][A-Za-z0-9_]*)/g, (whole, mark: string, space: string, name: string, at: number) => {
    const canonical = CANONICAL.get(name.toLowerCase())
    if (!canonical || canonical === name || !opensLabel(segment, at)) return whole
    return `${mark}${space}${canonical}`
  })
}

/** The query with every known label and link type in the graph's case; quoted text is untouched. */
export function fixLabelCase(query: string): string {
  return query
    .split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)/)
    .map((part, index) => (index % 2 === 1 ? part : fixSegment(part)))
    .join('')
}
