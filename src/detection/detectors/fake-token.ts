// fake-token detector (rbmk#462), relocated from data-pipeline
// internal/recipes/faketoken.go. Spoof-detection over the verified-token
// registry (facts_assets_view): a token whose lowercased symbol collides with a
// VERIFIED token's symbol but ships from a DIFFERENT, non-verified contract is
// a fake-token candidate. Reads only via USE facts; emits reviewable findings
// (never a direct label). Thresholds ported verbatim (DEC-7).
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { DetectionFinding } from '../../investigation/detection-findings.js'
import { graphQueryRows, type GraphRow } from '../graph-client.js'
import type { DetectorScan, DetectionWindow } from '../runtime.js'

const MAX_ROWS = 1000

function str(row: GraphRow, key: string): string {
  const v = row[key]
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

function truthy(row: GraphRow, key: string): boolean {
  const v = row[key]
  return v === true || v === 1 || v === '1' || v === 'true'
}

// scanAssets is the pure core: given the verified rows and the candidate rows,
// return the spoof findings. Exposed for offline unit testing.
export function findSpoofs(verified: GraphRow[], candidates: GraphRow[]): DetectionFinding[] {
  const verifiedBySymbol = new Map<string, GraphRow>()
  for (const v of verified) {
    const sym = str(v, 'symbol_lower')
    if (sym) verifiedBySymbol.set(sym, v)
  }
  const findings: DetectionFinding[] = []
  const seen = new Set<string>()
  for (const c of candidates) {
    const sym = str(c, 'symbol_lower')
    const contract = str(c, 'asset_contract')
    if (!sym || !contract) continue
    const real = verifiedBySymbol.get(sym)
    if (!real) continue
    const realContract = str(real, 'asset_contract')
    if (contract === realContract) continue // the verified one itself
    if (truthy(c, 'verified')) continue // another verified token sharing a symbol is not a spoof
    if (seen.has(contract)) continue
    seen.add(contract)
    findings.push({
      address: contract,
      classification: 'fake_token_contract',
      gate: 'verified_symbol_collision',
      evidence: {
        symbol: str(c, 'asset_symbol'),
        symbol_lower: sym,
        spoofed_verified_contract: realContract,
        spoofed_verified_source: str(real, 'verification_source'),
      },
      truncated: false,
      inconclusive: false,
    })
  }
  return findings
}

export const fakeTokenDetector: DetectorScan = {
  tool: 'aml_fake_token',
  id: 'fake-token',
  thresholds: () => ({ ported_from: 'internal/recipes/faketoken.go', rule: 'verified_symbol_collision' }),
  async scan(_window: DetectionWindow, client: Client, network: string): Promise<DetectionFinding[]> {
    // The assets registry is a SMALL dimension (thousands of rows), so pull it
    // all via keyset pagination (ORDER BY asset_contract, WHERE > cursor) — an
    // unfiltered bounded Asset scan is cost-gate-allowed (not a transfer or
    // aggregate). A per-symbol query loop would issue one call per verified
    // symbol (thousands) and time out; the whole spoof-match runs client-side
    // over the pulled set instead (findSpoofs).
    const all = await pullAllAssets(client, network)
    const verified = all.filter((a) => truthy(a, 'verified'))
    return findSpoofs(verified, all)
  },
}

const MAX_ASSET_PAGES = 50

async function pullAllAssets(client: Client, network: string): Promise<GraphRow[]> {
  const out: GraphRow[] = []
  let cursor = ''
  for (let page = 0; page < MAX_ASSET_PAGES; page += 1) {
    const where = cursor ? `WHERE t.asset_contract > "${cursor.replace(/"/g, '')}" ` : ''
    const rows = await graphQueryRows(
      client,
      network,
      `USE facts MATCH (t:Asset) ${where}RETURN t.asset_contract AS asset_contract, t.symbol_lower AS symbol_lower, t.asset_symbol AS asset_symbol, t.verified AS verified, t.verification_source AS verification_source ORDER BY t.asset_contract LIMIT ${MAX_ROWS}`,
    )
    if (rows.length === 0) break
    out.push(...rows)
    if (rows.length < MAX_ROWS) break
    cursor = str(rows[rows.length - 1], 'asset_contract')
    if (!cursor) break
  }
  return out
}
