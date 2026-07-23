// attack-attribution detector (rbmk#462), relocated from data-pipeline
// internal/recipes/attribution.go. Starting from confirmed bad-actor seeds
// (addresses already labeled poisoning_duster / dusting_source /
// fake_token_contract), walk downstream over FLOWS_TO up to a bounded hop depth
// to attribute the cash-out chain, stopping at infrastructure boundaries
// (exchanges, bridges, mixers, contracts, validators — never labeled or
// expanded through). Reads only via USE topology graph_query with federation-
// safe RETURNs (node addresses only, never a relationship scalar); emits
// reviewable findings (never a direct label). Thresholds ported (DEC-7).
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { DetectionFinding } from '../../investigation/detection-findings.js'
import { graphQueryRows, type GraphRow } from '../graph-client.js'
import type { DetectorScan, DetectionWindow } from '../runtime.js'

export const ATTRIBUTION_MAX_HOPS = 3
export const ATTRIBUTION_MAX_FRONTIER = 500
const MAX_ROWS = 1000
export const ATTRIBUTION_SEED_SUBTYPES = ['poisoning_duster', 'dusting_source', 'fake_token_contract']
// Infrastructure families that terminate the walk (mirrors the Go recipe's
// attributionBoundaryTypes): never attribute or expand through shared infra.
export const ATTRIBUTION_BOUNDARY_KEYWORDS = [
  'exchange',
  'bridge',
  'dex',
  'mixer',
  'contract',
  'token',
  'validator',
  'miner',
  'subnet',
]

function str(row: GraphRow, key: string): string {
  const v = row[key]
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

export interface AttributedNode {
  address: string
  hop: number
  seed: string
}

// bfsAttribution is the pure core: a bounded breadth-first downstream walk.
// `neighbors(addr)` yields the direct downstream addresses of `addr`;
// `isBoundary(addr)` reports whether an address is infrastructure (not
// attributed, not expanded). Seeds are hop 0 and are NOT emitted (they are
// already labeled). Each non-boundary address is attributed once, at the
// shortest hop, to the seed that reached it first. Exposed for offline testing.
export async function bfsAttribution(
  seeds: string[],
  neighbors: (addr: string) => Promise<string[]>,
  isBoundary: (addr: string) => Promise<boolean>,
  maxHops: number = ATTRIBUTION_MAX_HOPS,
): Promise<AttributedNode[]> {
  const attributed = new Map<string, AttributedNode>()
  const visited = new Set<string>(seeds.map((s) => s.toLowerCase()))
  let frontier: Array<{ address: string; seed: string }> = seeds.map((s) => ({ address: s, seed: s }))
  for (let hop = 1; hop <= maxHops && frontier.length > 0; hop += 1) {
    const next: Array<{ address: string; seed: string }> = []
    for (const node of frontier) {
      const downstream = await neighbors(node.address)
      for (const cand of downstream) {
        const key = cand.toLowerCase()
        if (visited.has(key)) continue
        visited.add(key)
        if (await isBoundary(cand)) continue // boundary: don't attribute or expand
        attributed.set(key, { address: cand, hop, seed: node.seed })
        next.push({ address: cand, seed: node.seed })
      }
    }
    frontier = next
  }
  return [...attributed.values()]
}

export const attackAttributionDetector: DetectorScan = {
  tool: 'aml_attack_attribution',
  id: 'attack-attribution',
  thresholds: () => ({
    ported_from: 'internal/recipes/attribution.go',
    rule: 'downstream_flow_attribution',
    max_hops: ATTRIBUTION_MAX_HOPS,
    seed_subtypes: ATTRIBUTION_SEED_SUBTYPES,
  }),
  async scan(_window: DetectionWindow, client: Client, network: string): Promise<DetectionFinding[]> {
    const seeds = await pullSeeds(client, network)
    if (seeds.length === 0) return []

    const boundaryCache = new Map<string, boolean>()
    const isBoundary = async (addr: string): Promise<boolean> => {
      const key = addr.toLowerCase()
      const cached = boundaryCache.get(key)
      if (cached !== undefined) return cached
      const b = await addressIsBoundary(client, network, addr)
      boundaryCache.set(key, b)
      return b
    }
    const neighbors = (addr: string) => downstreamAddresses(client, network, addr)

    const attributed = await bfsAttribution(seeds, neighbors, isBoundary)
    return attributed.map((node) => ({
      address: node.address,
      classification: 'attributed_bad_actor' as const,
      gate: 'downstream_flow_attribution',
      evidence: { seed: node.seed, hop: node.hop },
      truncated: false,
      inconclusive: false,
    }))
  },
}

async function pullSeeds(client: Client, network: string): Promise<string[]> {
  const list = ATTRIBUTION_SEED_SUBTYPES.map((s) => `"${s}"`).join(', ')
  const rows = await graphQueryRows(
    client,
    network,
    `USE topology MATCH (a:Address) WHERE a.address_subtype IN [${list}] RETURN a.address AS address LIMIT ${MAX_ROWS}`,
  )
  return [...new Set(rows.map((r) => str(r, 'address')).filter(Boolean))]
}

async function downstreamAddresses(client: Client, network: string, addr: string): Promise<string[]> {
  const safe = addr.replace(/"/g, '')
  const rows = await graphQueryRows(
    client,
    network,
    `USE topology MATCH (a:Address {address: "${safe}"})-[:FLOWS_TO]->(b:Address) RETURN b.address AS address LIMIT ${ATTRIBUTION_MAX_FRONTIER}`,
  )
  return rows.map((r) => str(r, 'address')).filter(Boolean)
}

async function addressIsBoundary(client: Client, network: string, addr: string): Promise<boolean> {
  const safe = addr.replace(/"/g, '')
  const rows = await graphQueryRows(
    client,
    network,
    `USE topology MATCH (a:Address {address: "${safe}"}) RETURN a.labels AS labels, a.is_exchange AS is_exchange LIMIT 1`,
  )
  const row = rows[0]
  if (!row) return false
  if (row['is_exchange'] === true || row['is_exchange'] === 1) return true
  const labels = Array.isArray(row['labels']) ? row['labels'].map((x) => String(x).toLowerCase()) : []
  return labels.some((l) => ATTRIBUTION_BOUNDARY_KEYWORDS.some((k) => l.includes(k)))
}
