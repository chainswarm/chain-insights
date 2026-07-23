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
import { isLookalike } from '../lookalike.js'
import type { DetectorScan, DetectionWindow } from '../runtime.js'

const MAX_ROWS = 1000
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
    findings.push({
      address: edge.duster,
      classification: 'poisoning_duster',
      gate: 'vanity_lookalike_dust',
      evidence: {
        victim: edge.victim,
        impersonated_counterparty: impersonated,
        dust_amount: edge.amount,
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
  thresholds: () => ({
    ported_from: 'internal/recipes/addresspoisoning.go',
    rule: 'vanity_lookalike_dust',
    dust_floor: POISONING_DUST_FLOOR,
    scan_window_ms: POISONING_SCAN_WINDOW_MS,
  }),
  async scan(window: DetectionWindow, client: Client, network: string): Promise<DetectionFinding[]> {
    // Clamp to the trailing bounded window so the facts scan stays cost-legal.
    const hiMs = window.toMs
    const loMs = Math.max(window.fromMs, hiMs - POISONING_SCAN_WINDOW_MS)
    const lo = toDateStr(loMs)
    const hi = toDateStr(hiMs)
    const dustRows = await graphQueryRows(
      client,
      network,
      `USE facts MATCH ()-[t:TRANSFER]->() WHERE t.block_date >= "${lo}" AND t.block_date <= "${hi}" AND t.amount < ${POISONING_DUST_FLOOR} RETURN t.from_address AS duster, t.to_address AS victim, t.amount AS amount LIMIT ${MAX_ROWS}`,
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
        `USE facts MATCH ()-[t:TRANSFER]->() WHERE t.to_address = "${safe}" AND t.amount >= ${POISONING_DUST_FLOOR} RETURN DISTINCT t.from_address AS counterparty LIMIT ${MAX_ROWS}`,
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
