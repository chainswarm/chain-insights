// src/monitor/tracker.ts
// UC-6/UC-7: case re-trace + run-over-run diff. Traversal is the LOCAL
// corridor machinery over graph_query (spec invariant 3 — endpoint-portable,
// no remote aml_trace_* dependency). Movements are DERIVED from the snapshot
// sequence, so rebuild reproduces them.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { scamCorridorTrace } from '../investigation/scam-corridor-trace.js'
import { writeFindings } from '../detection/emit.js'
import type { DetectionFindingsDocument } from '../investigation/detection-findings.js'
import type { AlertEvent } from './alerts.js'
import { monitorPaths } from './paths.js'
import { approvedAddressesForCase } from './review.js'

export interface SnapshotAddress { address: string; classification?: string; gate?: string }
export interface CaseSnapshot { case_id: string; run_ms: number; seed_set: string[]; addresses: SnapshotAddress[] }
export interface CaseMovement { type: 'new_hop' | 'new_deposit_endpoint' | 'cashout_endpoint' | 'frontier_candidate'; address: string; details: Record<string, unknown> }

export function diffSnapshots(prev: CaseSnapshot | null, next: CaseSnapshot): CaseMovement[] {
  if (!prev) return []
  const known = new Set(prev.addresses.map((a) => a.address))
  const seeds = new Set(next.seed_set)
  const movements: CaseMovement[] = []
  for (const a of next.addresses) {
    if (known.has(a.address) || seeds.has(a.address)) continue
    const details = { classification: a.classification ?? null, gate: a.gate ?? null }
    movements.push({ type: 'new_hop', address: a.address, details })
    if (a.classification === 'exchange_terminal') movements.push({ type: 'cashout_endpoint', address: a.address, details })
    if (a.gate?.startsWith('shared_deposit')) movements.push({ type: 'new_deposit_endpoint', address: a.address, details })
    if (a.classification === 'propagated_scam' || a.classification === 'corridor_hub') movements.push({ type: 'frontier_candidate', address: a.address, details })
  }
  return movements
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
  return snaps.sort((a, b) => a.run_ms - b.run_ms)
}

type CorridorFn = (client: Client, options: { seedAddress: string; network: string; maxHops?: number; writeArtifacts?: boolean; workspaceRoot?: string }) => Promise<{ document: DetectionFindingsDocument; summaryText: string }>

export async function traceCase(
  client: Client,
  workspaceRoot: string,
  caseId: string,
  maxHops: number,
  nowMs: number,
  hooks: { corridor?: CorridorFn } = {},
): Promise<{ movements_count: number; alerts: Omit<AlertEvent, 'alert_id' | 'emitted_at_ms'>[] }> {
  const corridor = hooks.corridor ?? scamCorridorTrace
  const caseFile = path.join(monitorPaths(workspaceRoot).casesDir, caseId, 'case.json')
  const monitorCase = JSON.parse(await readFile(caseFile, 'utf8')) as { case_id: string; network: string; seeds: string[] }
  const approved = await approvedAddressesForCase(workspaceRoot, caseId)
  const seedSet = [...new Set([...monitorCase.seeds, ...approved])].sort()

  const byAddress = new Map<string, SnapshotAddress>()
  for (const seed of seedSet) {
    const { document } = await corridor(client, { seedAddress: seed, network: monitorCase.network, maxHops, writeArtifacts: false, workspaceRoot })
    for (const f of document.findings) {
      if (!byAddress.has(f.address)) byAddress.set(f.address, { address: f.address, classification: f.classification, gate: f.gate })
    }
  }
  const snapshot: CaseSnapshot = {
    case_id: caseId, run_ms: nowMs, seed_set: seedSet,
    addresses: [...seedSet.map((address) => ({ address })), ...[...byAddress.values()].filter((a) => !seedSet.includes(a.address))],
  }
  const previous = (await readSnapshots(workspaceRoot, caseId)).at(-1) ?? null
  const dir = snapshotsDir(workspaceRoot, caseId)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, `${nowMs}.snapshot.json`), JSON.stringify(snapshot, null, 2) + '\n', 'utf8')

  const movements = diffSnapshots(previous, snapshot)
  const frontier = movements.filter((m) => m.type === 'frontier_candidate')
  if (frontier.length > 0) {
    const doc: DetectionFindingsDocument = {
      schema: 'chain-insights.detection-findings.v1', tool: 'aml_scam_corridor_trace', network: monitorCase.network,
      status: 'complete', generated_at_ms: nowMs,
      findings: frontier.map((m) => ({ address: m.address, classification: (m.details.classification ?? undefined) as never, evidence: { case_id: caseId }, truncated: false, inconclusive: false })),
      threshold_provenance: { source: 'cia-monitor-case-expansion', case_id: caseId },
    }
    await writeFindings(workspaceRoot, `case-${caseId}`, doc)
  }
  const alerts = movements.map((m) => ({
    type: m.type === 'cashout_endpoint' ? 'cashout_endpoint' as const : m.type === 'frontier_candidate' ? 'frontier_candidate' as const : 'case_movement' as const,
    network: monitorCase.network, case_id: caseId, address: m.address, run_ms: nowMs,
  }))
  return { movements_count: movements.length, alerts }
}
