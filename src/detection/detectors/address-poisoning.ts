// address-poisoning detector (rbmk#462), relocated from data-pipeline
// internal/recipes/addresspoisoning.go. A duster sends a dust-value transfer
// from a vanity address that impersonates one of the victim's REAL prior
// counterparties (shared visible prefix/suffix). Detection: over a bounded
// recent facts window, find dust transfers (amount below a floor); for each
// (duster -> victim) dust edge, pull the victim's real prior counterparties and
// flag the duster when it is a vanity lookalike of one of them. Reads only via
// USE facts (bounded window, both bounds, LIMIT ≤ 1000 — cost-gate legal);
// emits reviewable findings (never a direct label). Thresholds ported (DEC-7).
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { DetectionFinding } from '../../investigation/detection-findings.js'
import { graphQueryRows, type GraphRow } from '../graph-client.js'
import { addressFamily, isLookalike } from '../lookalike.js'
import { limitFromParams, limitLiteral } from '../../config/limits.js'
import { numParam } from '../params.js'
import type { DetectorParams, DetectorScan, DetectionWindow } from '../runtime.js'

// Cluster-key prefix length per family: the shared lead a vanity spray grinds.
// A dust sender whose prefix cluster has many distinct members is far more
// likely a deliberate campaign than an incidental small transfer.
function clusterKey(addr: string): string {
  const fam = addressFamily(addr)
  const len = fam === 'ss58' ? 14 : fam === 'evm' ? 10 : 8
  return `${fam}:${addr.slice(0, len)}`
}

// Per-network default dust floors. Amounts in facts are decimals-normalized, so
// the same order-of-magnitude floor works across networks today; the table
// exists so a chain with a different token scale can be tuned without code.
const POISONING_NETWORK_DEFAULTS: Record<string, { dustFloor: number }> = {
  bittensor: { dustFloor: 0.0001 },
  bittensor_evm: { dustFloor: 0.0001 },
}

export interface PoisoningConfig {
  dustFloor: number
  scanWindowMs: number
  maxRows: number
}

// resolvePoisoningConfig layers operator `--param` overrides on the per-network
// defaults. Params: dust_floor, scan_window_days, max_rows.
export function resolvePoisoningConfig(network: string, params: DetectorParams): PoisoningConfig {
  const base = POISONING_NETWORK_DEFAULTS[network] ?? { dustFloor: POISONING_DUST_FLOOR }
  const windowDays = numParam(params, 'scan_window_days', 2)
  return {
    dustFloor: numParam(params, 'dust_floor', base.dustFloor),
    scanWindowMs: windowDays * 24 * 60 * 60 * 1000,
    // Range-checked against the shared registry's hard ceiling; an
    // out-of-range --param throws rather than being accepted.
    maxRows: limitFromParams('poisoning_max_rows', params, 'max_rows', { network }),
  }
}

// Facts scans are cost-gated to a bounded window (FACTS_MAX_SCAN_WINDOW_DAYS,
// default 2 on the backend). A --full run over genesis→now would exceed it, so
// the scan clamps to the trailing window and marks the run truncated. Chunked
// full-history sweeps are a follow-up (DEC-15/DEC-11 time_scope).
export const POISONING_SCAN_WINDOW_MS = 2 * 24 * 60 * 60 * 1000
// Dust floor: transfers strictly below this raw amount are dust candidates.
// Tunable; ported default mirrors the Go recipe's 0.0001 normalized floor and
// is flagged for morning calibration against raw facts amounts (DEC-7).
export const POISONING_DUST_FLOOR = 0.0001

function str(row: GraphRow, key: string): string {
  const v = row[key]
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

export interface DustEdge {
  duster: string
  victim: string
  amount: number
}

// findPoisoning is the pure core: given dust edges and, per victim, the set of
// that victim's REAL prior counterparties, flag each duster that vanity-matches
// one of the victim's real counterparties. Exposed for offline unit testing.
export function findPoisoning(
  dust: DustEdge[],
  realCounterpartiesByVictim: Map<string, string[]>,
): DetectionFinding[] {
  // Cluster signal: count distinct dusters sharing each ground prefix. A large
  // cluster (many vanity senders, one prefix) is the campaign fingerprint.
  const clusterMembers = new Map<string, Set<string>>()
  for (const edge of dust) {
    if (!edge.duster) continue
    const key = clusterKey(edge.duster)
    let set = clusterMembers.get(key)
    if (!set) {
      set = new Set<string>()
      clusterMembers.set(key, set)
    }
    set.add(edge.duster)
  }

  const findings: DetectionFinding[] = []
  const seen = new Set<string>()
  for (const edge of dust) {
    if (!edge.duster || !edge.victim) continue
    const reals = realCounterpartiesByVictim.get(edge.victim) ?? []
    const impersonated = reals.find((real) => isLookalike(edge.duster, real))
    if (!impersonated) continue
    const key = `${edge.duster}->${edge.victim}`
    if (seen.has(key)) continue
    seen.add(key)
    const clusterSize = clusterMembers.get(clusterKey(edge.duster))?.size ?? 1
    findings.push({
      address: edge.duster,
      classification: 'poisoning_duster',
      gate: 'vanity_lookalike_dust',
      evidence: {
        victim: edge.victim,
        impersonated_counterparty: impersonated,
        dust_amount: edge.amount,
        vanity_cluster_prefix: clusterKey(edge.duster),
        vanity_cluster_size: clusterSize,
      },
      truncated: false,
      inconclusive: false,
    })
  }
  return findings
}

function toDateStr(ms: number): string {
  // YYYY-MM-DD (UTC) for a block_date bound. Avoids Date locale drift.
  return new Date(ms).toISOString().slice(0, 10)
}

export const addressPoisoningDetector: DetectorScan = {
  tool: 'aml_address_poisoning',
  id: 'address-poisoning',
  // Event-shaped: dust TRANSFER edges carry block_date, so the scan is genuinely
  // bounded by the window and the checkpoint is meaningful.
  windowMode: 'incremental',
  thresholds: (network, params) => {
    const cfg = resolvePoisoningConfig(network, params)
    return {
      ported_from: 'internal/recipes/addresspoisoning.go',
      rule: 'vanity_lookalike_dust',
      dust_floor: cfg.dustFloor,
      scan_window_ms: cfg.scanWindowMs,
      max_rows: cfg.maxRows,
    }
  },
  async scan(window: DetectionWindow, client: Client, network: string, params: DetectorParams): Promise<DetectionFinding[]> {
    const cfg = resolvePoisoningConfig(network, params)
    // Clamp to the trailing bounded window so the facts scan stays cost-legal.
    const hiMs = window.toMs
    const loMs = Math.max(window.fromMs, hiMs - cfg.scanWindowMs)
    const lo = toDateStr(loMs)
    const hi = toDateStr(hiMs)
    // Both queries below read `USE facts`, which routes each network to its OWN
    // backing database — the dust edges and counterparties returned are already
    // the requested network's and nothing else. They are therefore deliberately
    // NOT given an `Address.network` predicate: the shared-graph over-selection
    // defect (chain-insights#228) is a `USE topology` problem, and the facts
    // `Address` label does not map a `network` property at all, so adding one
    // would fail the query outright (verified live 2026-07-26: "property
    // 'network' is not mapped on label 'Address'").
    //
    // from_address/to_address are the TRANSFER edge's endpoint NODES (facts
    // source/target columns), not edge scalars — bind them as nodes and read
    // `.address`. `amount`/`block_date` are genuine edge properties.
    const dustRows = await graphQueryRows(
      client,
      network,
      `USE facts MATCH (from:Address)-[t:TRANSFER]->(to:Address) WHERE t.block_date >= "${lo}" AND t.block_date <= "${hi}" AND t.amount < ${cfg.dustFloor} RETURN from.address AS duster, to.address AS victim, t.amount AS amount LIMIT ${limitLiteral(cfg.maxRows)}`,
    )
    const dust: DustEdge[] = dustRows.map((r) => ({
      duster: str(r, 'duster'),
      victim: str(r, 'victim'),
      amount: Number(r['amount']) || 0,
    }))
    // For each distinct victim, pull its real prior counterparties (address-
    // anchored facts query — any range allowed since it is address-indexed).
    const victims = [...new Set(dust.map((d) => d.victim).filter(Boolean))]
    const realByVictim = new Map<string, string[]>()
    for (const victim of victims) {
      const safe = victim.replace(/"/g, '')
      const rows = await graphQueryRows(
        client,
        network,
        `USE facts MATCH (from:Address)-[t:TRANSFER]->(to:Address {address: "${safe}"}) WHERE t.amount >= ${cfg.dustFloor} RETURN DISTINCT from.address AS counterparty LIMIT ${limitLiteral(cfg.maxRows)}`,
      )
      realByVictim.set(
        victim,
        rows.map((r) => str(r, 'counterparty')).filter(Boolean),
      )
    }
    const findings = findPoisoning(dust, realByVictim)
    if (window.full && window.fromMs < loMs) {
      // Full run could not cover pre-window history within the cost gate.
      for (const f of findings) f.truncated = true
    }
    return findings
  },
}
