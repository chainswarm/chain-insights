// fake-token detector (rbmk#462), relocated from data-pipeline
// internal/recipes/faketoken.go. Spoof-detection over the verified-token
// registry (facts_assets_view): a token whose lowercased symbol collides with a
// VERIFIED token's symbol but ships from a DIFFERENT, non-verified contract is
// a fake-token candidate. Reads only via USE facts; emits reviewable findings
// (never a direct label). Thresholds ported verbatim (DEC-7).
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { DetectionFinding } from '../../investigation/detection-findings.js'
import { graphQueryRows, type GraphRow } from '../graph-client.js'
import { numParam } from '../params.js'
import type { DetectorParams, DetectorScan, DetectionWindow } from '../runtime.js'

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

const MAX_ASSET_PAGES = 50

export interface FakeTokenConfig {
  maxPages: number
  pageSize: number
}

// resolveFakeTokenConfig: operator `--param` overrides for the assets pull.
// Params: max_pages, page_size. No per-network divergence today (the assets
// dimension is small everywhere); the resolver is the extension point.
export function resolveFakeTokenConfig(_network: string, params: DetectorParams): FakeTokenConfig {
  return {
    maxPages: numParam(params, 'max_pages', MAX_ASSET_PAGES),
    pageSize: numParam(params, 'page_size', MAX_ROWS),
  }
}

export const fakeTokenDetector: DetectorScan = {
  tool: 'aml_fake_token',
  id: 'fake-token',
  // Full-state, declared honestly. A symbol collision is a property of the
  // WHOLE asset registry: a token registered today can only be judged a spoof
  // against the verified token it impersonates, which was registered long
  // before. Scanning only assets that appeared inside a window would leave the
  // verified side of every collision outside the scan and report nothing — the
  // detector would be wrong, not incremental. The registry is a small dimension
  // (thousands of rows), so the full pull is cheap; no checkpoint is advanced,
  // and the runtime emits only spoof contracts not already reported.
  windowMode: 'full-state',
  thresholds: (network, params) => {
    const cfg = resolveFakeTokenConfig(network, params)
    return {
      ported_from: 'internal/recipes/faketoken.go',
      rule: 'verified_symbol_collision',
      max_pages: cfg.maxPages,
      page_size: cfg.pageSize,
    }
  },
  // `window` is intentionally unused — see windowMode above. The runtime always
  // passes a full window here and de-duplicates the output across runs.
  async scan(_window: DetectionWindow, client: Client, network: string, params: DetectorParams): Promise<DetectionFinding[]> {
    // The assets registry is a SMALL dimension (thousands of rows), so pull it
    // all via keyset pagination (ORDER BY asset_contract, WHERE > cursor) — an
    // unfiltered bounded Asset scan is cost-gate-allowed (not a transfer or
    // aggregate). A per-symbol query loop would issue one call per verified
    // symbol (thousands) and time out; the whole spoof-match runs client-side
    // over the pulled set instead (findSpoofs).
    const cfg = resolveFakeTokenConfig(network, params)
    const all = await pullAllAssets(client, network, cfg)
    const verified = all.filter((a) => truthy(a, 'verified'))
    return findSpoofs(verified, all)
  },
}

// DELIBERATELY NOT network-scoped by an `Address.network` predicate. Two
// independent reasons: (1) this detector matches `:Asset` registry rows, not
// `:Address` nodes — there is no address subset to narrow; (2) `USE facts`
// routes each network to its OWN backing database, so the registry pulled here
// already contains only the requested network's assets. The shared-graph
// over-selection defect (chain-insights#228) is a `USE topology` problem only.
async function pullAllAssets(client: Client, network: string, cfg: FakeTokenConfig): Promise<GraphRow[]> {
  const out: GraphRow[] = []
  let cursor = ''
  for (let page = 0; page < cfg.maxPages; page += 1) {
    const where = cursor ? `WHERE t.asset_contract > "${cursor.replace(/"/g, '')}" ` : ''
    const rows = await graphQueryRows(
      client,
      network,
      `USE facts MATCH (t:Asset) ${where}RETURN t.asset_contract AS asset_contract, t.symbol_lower AS symbol_lower, t.asset_symbol AS asset_symbol, t.verified AS verified, t.verification_source AS verification_source ORDER BY t.asset_contract LIMIT ${cfg.pageSize}`,
    )
    if (rows.length === 0) break
    out.push(...rows)
    if (rows.length < cfg.pageSize) break
    cursor = str(rows[rows.length - 1], 'asset_contract')
    if (!cursor) break
  }
  return out
}
