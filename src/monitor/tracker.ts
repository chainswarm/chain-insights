// src/monitor/tracker.ts
// UC-6/UC-7: case re-trace + run-over-run diff. Traversal is the LOCAL
// corridor machinery over graph_query (spec invariant 3 — endpoint-portable,
// no remote aml_trace_* dependency). Movements are DERIVED from the snapshot
// sequence, so rebuild reproduces them.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { scamCorridorTrace } from '../investigation/scam-corridor-trace.js'
import type { LimitConfig } from '../config/limits.js'
import { writeFindings } from '../detection/emit.js'
import type { DetectionFindingsDocument } from '../investigation/detection-findings.js'
import type { AlertEvent } from './alerts.js'
import { monitorPaths } from './paths.js'
import { approvedAddressesForCase } from './review.js'

export interface SnapshotAddress {
  address: string
  classification?: string
  gate?: string
  /** Which seed(s) of this run's seed set reached this address. Recorded so the
   *  run-over-run diff can attribute a newly-visible address to the aperture
   *  rather than to a movement — see `isScopeGrowth`. */
  via_seeds?: string[]
}
export interface CaseSnapshot {
  case_id: string
  run_timestamp: number
  seed_set: string[]
  addresses: SnapshotAddress[]
  /** Copied from case.json at trace time: address -> when it became a seed. */
  seeds_added_at_timestamp?: Record<string, number>
}
export interface CaseMovement { type: 'new_hop' | 'new_deposit_endpoint' | 'cashout_endpoint' | 'frontier_candidate' | 'scope_expansion'; address: string; details: Record<string, unknown> }

// ---------------------------------------------------------------------------
// SCOPE GROWTH IS NOT A MOVEMENT (chain-insights#250)
// ---------------------------------------------------------------------------
// `case add-seed` widens the corridor. The very next run therefore sees
// addresses that were not in the previous snapshot — and a naive "not in prev =
// new_hop" diff reports every one of them as though funds had MOVED there since
// the last run. On a real theft case that is a fabricated forensic claim: the
// analyst reads "12 new hops at 14:03" when nothing moved at all and they had
// simply pointed the trace at a second wallet.
//
// The separation is exact and needs no second traversal, because the traversal
// is already per-seed: attribute each discovered address to the seed(s) that
// reached it (`via_seeds`).
//
//   * reachable from a seed that ALREADY existed at the previous snapshot, and
//     absent from that snapshot  -> the corridor genuinely changed under a
//     fixed aperture. That is a MOVEMENT.
//   * reachable ONLY from seeds added since the previous snapshot -> it was
//     always there, we just could not see it. That is SCOPE EXPANSION.
//
// An address reached from both is a movement: the old aperture alone would have
// found it this run and did not find it last run.
//
// This lives in the pure diff, not in traceCase, because store.ts REDERIVES
// movements from the snapshot sequence on `monitor rebuild`. Suppressing in
// traceCase only would make a rebuilt store disagree with the live one.
function newSeedsOf(prev: CaseSnapshot, next: CaseSnapshot): Set<string> {
  const before = new Set(prev.seed_set)
  return new Set(next.seed_set.filter((s) => !before.has(s)))
}

function isScopeGrowth(a: SnapshotAddress, newSeeds: Set<string>): boolean {
  // No seed was added => nothing can be scope growth.
  if (newSeeds.size === 0) return false
  // Snapshots written before this attribution existed carry no via_seeds. With
  // no evidence, do not suppress: under-reporting a real movement is the worse
  // failure of the two.
  if (!a.via_seeds || a.via_seeds.length === 0) return false
  return a.via_seeds.every((s) => newSeeds.has(s))
}

function isNew(a: SnapshotAddress, known: Set<string>, seeds: Set<string>): boolean {
  return !known.has(a.address) && !seeds.has(a.address)
}

/** Genuine run-over-run movement under a FIXED aperture. Addresses that became
 *  visible only because seeds were added are excluded — see diffScopeExpansion. */
export function diffSnapshots(prev: CaseSnapshot | null, next: CaseSnapshot): CaseMovement[] {
  if (!prev) return []
  const known = new Set(prev.addresses.map((a) => a.address))
  const seeds = new Set(next.seed_set)
  const newSeeds = newSeedsOf(prev, next)
  const movements: CaseMovement[] = []
  for (const a of next.addresses) {
    if (!isNew(a, known, seeds)) continue
    if (isScopeGrowth(a, newSeeds)) continue
    const details = { classification: a.classification ?? null, gate: a.gate ?? null }
    movements.push({ type: 'new_hop', address: a.address, details })
    if (a.classification === 'exchange_terminal') movements.push({ type: 'cashout_endpoint', address: a.address, details })
    if (a.gate?.startsWith('shared_deposit')) movements.push({ type: 'new_deposit_endpoint', address: a.address, details })
    if (a.classification === 'propagated_scam' || a.classification === 'corridor_hub') movements.push({ type: 'frontier_candidate', address: a.address, details })
  }
  return movements
}

/** The other half of the diff: addresses that entered the case because the
 *  aperture widened. Reported as their own `scope_expansion` type — visible in
 *  the timeline (that is the point: it EXPLAINS the discontinuity) but never
 *  counted or alerted as movement. */
export function diffScopeExpansion(prev: CaseSnapshot | null, next: CaseSnapshot): CaseMovement[] {
  if (!prev) return []
  const known = new Set(prev.addresses.map((a) => a.address))
  const seeds = new Set(next.seed_set)
  const newSeeds = newSeedsOf(prev, next)
  const expansions: CaseMovement[] = []
  for (const a of next.addresses) {
    if (!isNew(a, known, seeds)) continue
    if (!isScopeGrowth(a, newSeeds)) continue
    expansions.push({
      type: 'scope_expansion',
      address: a.address,
      details: {
        classification: a.classification ?? null,
        gate: a.gate ?? null,
        via_seeds: a.via_seeds ?? [],
        seeds_added_at_timestamp: (a.via_seeds ?? []).map((s) => next.seeds_added_at_timestamp?.[s] ?? null),
      },
    })
  }
  return expansions
}

function snapshotsDir(workspaceRoot: string, caseId: string): string {
  return path.join(monitorPaths(workspaceRoot).casesDir, caseId, 'snapshots')
}

export async function readSnapshots(workspaceRoot: string, caseId: string): Promise<CaseSnapshot[]> {
  const dir = snapshotsDir(workspaceRoot, caseId)
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.snapshot.json'))
  } catch {
    return []
  }
  const snaps: CaseSnapshot[] = []
  for (const f of files) snaps.push(JSON.parse(await readFile(path.join(dir, f), 'utf8')) as CaseSnapshot)
  return snaps.sort((a, b) => a.run_timestamp - b.run_timestamp)
}

type CorridorFn = (client: Client, options: { seedAddress: string; network: string; maxHops?: number; limits?: LimitConfig; writeArtifacts?: boolean; workspaceRoot?: string }) => Promise<{ document: DetectionFindingsDocument; summaryText: string }>

export async function traceCase(
  client: Client,
  workspaceRoot: string,
  caseId: string,
  maxHops: number,
  nowTimestamp: number,
  hooks: { corridor?: CorridorFn } = {},
  // Config-file layer for the corridor's search bounds on unattended runs.
  limits?: LimitConfig,
): Promise<{ movements_count: number; scope_expansions_count: number; alerts: Omit<AlertEvent, 'alert_id' | 'emitted_at_timestamp'>[] }> {
  const corridor = hooks.corridor ?? scamCorridorTrace
  const caseFile = path.join(monitorPaths(workspaceRoot).casesDir, caseId, 'case.json')
  const monitorCase = JSON.parse(await readFile(caseFile, 'utf8')) as { case_id: string; network: string; seeds: string[]; seeds_added_at_timestamp?: Record<string, number> }
  const approved = await approvedAddressesForCase(workspaceRoot, caseId)
  const seedSet = [...new Set([...monitorCase.seeds, ...approved])].sort()

  const byAddress = new Map<string, SnapshotAddress>()
  const viaSeeds = new Map<string, Set<string>>()
  for (const seed of seedSet) {
    const { document } = await corridor(client, { seedAddress: seed, network: monitorCase.network, maxHops, limits, writeArtifacts: false, workspaceRoot })
    for (const f of document.findings) {
      if (!byAddress.has(f.address)) byAddress.set(f.address, { address: f.address, classification: f.classification, gate: f.gate })
      // Attribution is per-seed and cumulative: an address reached from several
      // seeds records all of them, which is what lets the diff tell a widened
      // aperture from a genuine hop.
      let seen = viaSeeds.get(f.address)
      if (!seen) viaSeeds.set(f.address, (seen = new Set<string>()))
      seen.add(seed)
    }
  }
  const snapshot: CaseSnapshot = {
    case_id: caseId, run_timestamp: nowTimestamp, seed_set: seedSet,
    ...(monitorCase.seeds_added_at_timestamp ? { seeds_added_at_timestamp: monitorCase.seeds_added_at_timestamp } : {}),
    addresses: [
      ...seedSet.map((address) => ({ address })),
      ...[...byAddress.values()]
        .filter((a) => !seedSet.includes(a.address))
        .map((a) => ({ ...a, via_seeds: [...(viaSeeds.get(a.address) ?? [])].sort() })),
    ],
  }
  const previous = (await readSnapshots(workspaceRoot, caseId)).at(-1) ?? null
  const dir = snapshotsDir(workspaceRoot, caseId)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, `${nowTimestamp}.snapshot.json`), JSON.stringify(snapshot, null, 2) + '\n', 'utf8')

  const movements = diffSnapshots(previous, snapshot)
  const expansions = diffScopeExpansion(previous, snapshot)
  // Classification signals apply to whatever is IN the corridor, however it got
  // there: a scam hub that entered via a new seed is still a frontier candidate
  // worth a human look, and suppressing it would hide the convergence the
  // add-seed was performed to find. Only MOVEMENT semantics are withheld.
  const frontier = [
    ...movements.filter((m) => m.type === 'frontier_candidate'),
    ...expansions.filter((m) => m.details.classification === 'propagated_scam' || m.details.classification === 'corridor_hub'),
  ]
  if (frontier.length > 0) {
    const doc: DetectionFindingsDocument = {
      schema: 'chain-insights.detection-findings.v1', tool: 'aml_scam_corridor_trace', network: monitorCase.network,
      status: 'complete', generated_at_timestamp: nowTimestamp,
      findings: frontier.map((m) => ({ address: m.address, classification: (m.details.classification ?? undefined) as never, evidence: { case_id: caseId }, truncated: false, inconclusive: false })),
      threshold_provenance: { source: 'cia-monitor-case-expansion', case_id: caseId },
    }
    await writeFindings(workspaceRoot, `case-${caseId}`, doc)
  }
  // `case_movement` is a claim that funds moved, so it is emitted ONLY for
  // genuine movements. Scope growth gets its own alert type, and the
  // classification-derived alerts (cashout / frontier) fire for both.
  const alerts = [
    ...movements.map((m) => ({
      type: m.type === 'cashout_endpoint' ? 'cashout_endpoint' as const : m.type === 'frontier_candidate' ? 'frontier_candidate' as const : 'case_movement' as const,
      network: monitorCase.network, case_id: caseId, address: m.address, run_timestamp: nowTimestamp,
    })),
    ...expansions.flatMap((m) => {
      const base = { network: monitorCase.network, case_id: caseId, address: m.address, run_timestamp: nowTimestamp }
      const out: Omit<AlertEvent, 'alert_id' | 'emitted_at_timestamp'>[] = [{ type: 'case_scope_expansion' as const, ...base }]
      if (m.details.classification === 'exchange_terminal') out.push({ type: 'cashout_endpoint' as const, ...base })
      if (m.details.classification === 'propagated_scam' || m.details.classification === 'corridor_hub') out.push({ type: 'frontier_candidate' as const, ...base })
      return out
    }),
  ]
  return { movements_count: movements.length, scope_expansions_count: expansions.length, alerts }
}
