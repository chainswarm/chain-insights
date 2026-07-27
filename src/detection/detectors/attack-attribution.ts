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
import { graphQueryRows, networkPredicate, type GraphRow } from '../graph-client.js'
import { LIMIT_SPECS, limitFromParams, limitLiteral } from '../../config/limits.js'
import { listParam } from '../params.js'
import type { DetectorParams, DetectorScan, DetectionWindow } from '../runtime.js'

// Built-in defaults now live in the shared limits registry (config/limits.ts),
// which is the generalization of the per-network default table this detector
// pioneered. Re-exported here so existing importers and thresholds output are
// unchanged. `max_hops` used to be overridable with NO ceiling at all via
// numParam; it is now hard-bounded, because attribution cost grows
// exponentially with depth.
export const ATTRIBUTION_MAX_HOPS = LIMIT_SPECS.attribution_max_hops.builtin
export const ATTRIBUTION_MAX_FRONTIER = LIMIT_SPECS.attribution_max_frontier.builtin
const MAX_ROWS = LIMIT_SPECS.attribution_max_rows.builtin
// Seeds are matched by TAXONOMY NODE LABEL, not an address_subtype property:
// the graphsync overlay stamps the scam family as node labels (:Scam, :Poisoned)
// and never projects address_subtype onto Address nodes (verified live
// 2026-07-23 — 0 nodes carry it). The curated seed subtypes (poisoning_duster,
// dusting_source, fake_token_contract) all map to address_type 'scam' → :Scam,
// so :Scam is the graph-expressible seed set. Kept for provenance/docs.
export const ATTRIBUTION_SEED_SUBTYPES = ['poisoning_duster', 'dusting_source', 'fake_token_contract']
export const ATTRIBUTION_SEED_LABELS = ['Scam']
// Cypher label tokens are not parameterizable, so they are validated to a safe
// identifier charset before interpolation.
const SEED_LABEL_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/
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

export interface AttributionConfig {
  maxHops: number
  maxFrontier: number
  maxRows: number
  seedLabels: string[]
  boundaryKeywords: string[]
}

// Per-network NON-NUMERIC default overrides (seed labels / boundary keywords).
// The numeric bounds moved to NETWORK_LIMIT_DEFAULTS in config/limits.ts so
// every tool's caps are tuned from one table; this one keeps the parts that
// are taxonomy, not budget.
const ATTRIBUTION_NETWORK_DEFAULTS: Record<string, Pick<Partial<AttributionConfig>, 'seedLabels' | 'boundaryKeywords'>> = {}

// resolveAttributionConfig layers operator `--param` overrides (from a CLI
// `--param key=value` or a monitor config cell's `params`) on the per-network
// defaults. Params: max_hops, max_frontier, max_rows, seed_labels (comma list
// of taxonomy node labels), boundary_keywords (comma list).
//
// The three numeric knobs resolve through the shared registry, so each one is
// range-checked against a hard ceiling and an out-of-range value throws
// LimitRangeError rather than being accepted (previously `numParam` accepted
// any non-negative number, so `--param max_hops=40` was a live way to hang the
// graph). Seed labels are validated to a safe identifier charset — they
// interpolate into a Cypher label position, which cannot be parameterized.
export function resolveAttributionConfig(network: string, params: DetectorParams): AttributionConfig {
  const base = ATTRIBUTION_NETWORK_DEFAULTS[network] ?? {}
  const rawLabels = params.seed_labels
    ? params.seed_labels.split(',').map((l) => l.trim()).filter(Boolean)
    : base.seedLabels ?? ATTRIBUTION_SEED_LABELS
  const seedLabels = rawLabels.filter((l) => SEED_LABEL_PATTERN.test(l))
  return {
    maxHops: limitFromParams('attribution_max_hops', params, 'max_hops', { network }),
    maxFrontier: limitFromParams('attribution_max_frontier', params, 'max_frontier', { network }),
    maxRows: limitFromParams('attribution_max_rows', params, 'max_rows', { network }),
    seedLabels: seedLabels.length > 0 ? seedLabels : ATTRIBUTION_SEED_LABELS,
    boundaryKeywords: listParam(params, 'boundary_keywords', base.boundaryKeywords ?? ATTRIBUTION_BOUNDARY_KEYWORDS),
  }
}

function str(row: GraphRow, key: string): string {
  const v = row[key]
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

export interface AttributedNode {
  address: string
  hop: number
  seed: string
}

export interface DownstreamNode {
  address: string
  boundary: boolean
}

// bfsAttribution is the pure core: a bounded breadth-first downstream walk.
// `expand(frontierAddresses)` returns, for each frontier address, its direct
// downstream nodes each tagged with a boundary flag — expanding the WHOLE
// frontier in ONE call per hop (the graph-side batches it; a per-node walk
// times out on a wide graph). Seeds are hop 0 and NOT emitted (already labeled).
// Each non-boundary address is attributed once, at the shortest hop, to the seed
// that reached it first; boundary nodes are neither attributed nor expanded.
// Exposed for offline testing.
export async function bfsAttribution(
  seeds: string[],
  expand: (frontierAddresses: string[]) => Promise<Map<string, DownstreamNode[]>>,
  maxHops: number = ATTRIBUTION_MAX_HOPS,
): Promise<AttributedNode[]> {
  const attributed = new Map<string, AttributedNode>()
  const visited = new Set<string>(seeds.map((s) => s.toLowerCase()))
  // seed-of-frontier: the reaching seed for each current frontier address.
  let frontierSeed = new Map<string, string>(seeds.map((s) => [s, s]))
  for (let hop = 1; hop <= maxHops && frontierSeed.size > 0; hop += 1) {
    const downstreamBySrc = await expand([...frontierSeed.keys()])
    const nextSeed = new Map<string, string>()
    for (const [src, seed] of frontierSeed) {
      const downstream = downstreamBySrc.get(src) ?? []
      for (const cand of downstream) {
        const key = cand.address.toLowerCase()
        if (visited.has(key)) continue
        visited.add(key)
        if (cand.boundary) continue // boundary: don't attribute or expand
        attributed.set(key, { address: cand.address, hop, seed })
        if (!nextSeed.has(cand.address)) nextSeed.set(cand.address, seed)
      }
    }
    frontierSeed = nextSeed
  }
  return [...attributed.values()]
}

export const attackAttributionDetector: DetectorScan = {
  tool: 'aml_attack_attribution',
  id: 'attack-attribution',
  // Full-state, declared honestly. Attribution is only correct over the COMPLETE
  // labelled seed set and the complete downstream reachability from it: a seed
  // labelled months ago still owns every address it ever reached, and the
  // shortest-hop attribution of an address depends on paths of any age. Bounding
  // the seed pull or the FLOWS_TO walk by a scan window would silently drop
  // seeds and mis-assign hops — a wrong attribution, not merely a cheaper one.
  // So the full walk stays, no checkpoint is advanced, and the runtime emits
  // only addresses not attributed in a previous run.
  windowMode: 'full-state',
  thresholds: (network, params) => {
    const cfg = resolveAttributionConfig(network, params)
    return {
      ported_from: 'internal/recipes/attribution.go',
      rule: 'downstream_flow_attribution',
      max_hops: cfg.maxHops,
      max_frontier: cfg.maxFrontier,
      seed_labels: cfg.seedLabels,
      seed_subtypes: ATTRIBUTION_SEED_SUBTYPES,
      boundary_keywords: cfg.boundaryKeywords,
    }
  },
  // `window` is intentionally unused — see windowMode above. The runtime always
  // passes a full window here and de-duplicates the output across runs.
  async scan(_window: DetectionWindow, client: Client, network: string, params: DetectorParams): Promise<DetectionFinding[]> {
    const cfg = resolveAttributionConfig(network, params)
    const seeds = await pullSeeds(client, network, cfg)
    if (seeds.length === 0) return []

    // Expand the whole frontier per hop in one (chunked) query — a per-node walk
    // times out on a wide graph. Each row carries the downstream node's boundary
    // flag (is_exchange / boundary-keyword label) so no separate lookup is needed.
    const expand = (frontier: string[]) => expandFrontier(client, network, frontier, cfg)

    const attributed = await bfsAttribution(seeds, expand, cfg.maxHops)
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

async function pullSeeds(client: Client, network: string, cfg: AttributionConfig): Promise<string[]> {
  // Seeds are addresses carrying a scam-family taxonomy node label (the overlay
  // stamps :Scam/:Poisoned, not an address_subtype property). Labels are
  // pre-validated to a safe identifier charset in resolveAttributionConfig.
  const predicate = cfg.seedLabels.map((l) => `a:${l}`).join(' OR ')
  // The topology graph is shared by every network view over the same shards, so
  // the seed pull MUST scope by the Address.network node property. Without it
  // each network's sweep returns the same rows and publishes wrong-network
  // attributions (chain-insights#228).
  const rows = await graphQueryRows(
    client,
    network,
    `USE topology MATCH (a:Address) WHERE ${networkPredicate('a', network)} AND (${predicate}) RETURN a.address AS address LIMIT ${limitLiteral(cfg.maxRows)}`,
  )
  return [...new Set(rows.map((r) => str(r, 'address')).filter(Boolean))]
}

// Frontier addresses per IN-list chunk — bounds the query size while still
// expanding many frontier nodes per round-trip.
const FRONTIER_CHUNK = 200

// expandFrontier expands an entire BFS frontier: one chunked query returns every
// (src -> downstream) edge for the frontier addresses, each downstream node
// tagged with its boundary flag (is_exchange / boundary-keyword label). The walk
// therefore costs ~maxHops * ceil(frontier/chunk) queries instead of one per
// node. A global cap (maxFrontier per hop) bounds a runaway high-degree fan-out.
async function expandFrontier(
  client: Client,
  network: string,
  frontier: string[],
  cfg: AttributionConfig,
): Promise<Map<string, DownstreamNode[]>> {
  const bySrc = new Map<string, DownstreamNode[]>()
  let emitted = 0
  for (let i = 0; i < frontier.length && emitted < cfg.maxFrontier; i += FRONTIER_CHUNK) {
    const chunk = frontier.slice(i, i + FRONTIER_CHUNK)
    const list = chunk.map((a) => `"${a.replace(/"/g, '')}"`).join(', ')
    const rows = await graphQueryRows(
      client,
      network,
      // Both endpoints are network-scoped: the frontier stays inside the
      // requested network view, and a downstream node belonging to a SIBLING
      // view of the same shared topology graph is neither attributed nor
      // expanded through. That is a deliberate bound — an attribution emitted
      // under network X must be an X address (chain-insights#228). A cash-out
      // that crosses the SS58/H160 boundary is therefore attributed only by the
      // sweep whose seeds live on that side.
      `USE topology MATCH (a:Address)-[:FLOWS_TO]->(b:Address) WHERE ${networkPredicate('a', network)} AND ${networkPredicate('b', network)} AND a.address IN [${list}] RETURN a.address AS src, b.address AS address, b.labels AS labels, b.is_exchange AS is_exchange LIMIT ${cfg.maxFrontier}`,
    )
    for (const row of rows) {
      const src = str(row, 'src')
      const address = str(row, 'address')
      if (!src || !address) continue
      const isExchange = row['is_exchange'] === true || row['is_exchange'] === 1
      const labels = Array.isArray(row['labels']) ? row['labels'].map((x) => String(x).toLowerCase()) : []
      const boundary = isExchange || labels.some((l) => cfg.boundaryKeywords.some((k) => l.includes(k)))
      const arr = bySrc.get(src) ?? []
      arr.push({ address, boundary })
      bySrc.set(src, arr)
      emitted += 1
    }
  }
  return bySrc
}
