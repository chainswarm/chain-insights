// Emitted-findings state for full-state detectors.
//
// Some detectors cannot be time-bounded without becoming WRONG: they classify
// an address from its CURRENT cumulative graph state (degree metrics, taxonomy
// labels, the verified-asset registry) rather than from events that fall inside
// a time window. Those detectors declare `windowMode: 'full-state'`, keep their
// full scan, and do NOT advance a scan checkpoint — a checkpoint they never read
// would be a lie (see runtime.ts).
//
// A full scan re-derives its ENTIRE result set every run, so emitting it
// verbatim republishes thousands of already-reviewed findings on every scheduled
// run and drowns the review backlog. This store is the fix: it remembers which
// findings a detector has already emitted for a network, so a run emits only the
// NEW ones. Unchanged data therefore yields an empty findings document and the
// backlog does not grow.
//
// State advances ONLY after the findings document is durably written (same
// crash-safety discipline as the checkpoint), so a run that dies mid-write
// re-emits its findings next time rather than losing them.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DetectionFinding } from '../investigation/detection-findings.js'

export const EMITTED_STATE_SCHEMA_VERSION = 'chain-insights.detection-emitted.v1' as const

export interface EmittedState {
  schema: typeof EMITTED_STATE_SCHEMA_VERSION
  detector: string
  network: string
  updated_at_ms: number
  // Stable identity keys of every finding emitted so far (see findingKey).
  finding_keys: string[]
}

function stateDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.chain-insights', 'detectors')
}

function statePath(workspaceRoot: string, detector: string, network: string): string {
  return path.join(stateDir(workspaceRoot), `${detector}.${network}.emitted.json`)
}

// The reviewable identity of a finding: which address was flagged, as what, by
// which gate. Evidence is deliberately EXCLUDED — a mixer candidate whose
// degree_in drifts 50 -> 70, or an attributed address reached at a different
// hop, is the same review decision, not a new one. Including evidence would
// re-flood the backlog on every metric tick, which is the defect being fixed.
export function findingKey(finding: DetectionFinding): string {
  return [finding.address, finding.classification ?? '', finding.gate ?? ''].join('|')
}

// Returns an empty state when the file is absent or unreadable — a first run (or
// a corrupted state file) emits everything rather than silently suppressing.
export async function readEmittedState(
  workspaceRoot: string,
  detector: string,
  network: string,
): Promise<EmittedState> {
  const empty: EmittedState = {
    schema: EMITTED_STATE_SCHEMA_VERSION,
    detector,
    network,
    updated_at_ms: 0,
    finding_keys: [],
  }
  try {
    const parsed = JSON.parse(
      await readFile(statePath(workspaceRoot, detector, network), 'utf8'),
    ) as Partial<EmittedState>
    if (parsed.schema !== EMITTED_STATE_SCHEMA_VERSION) return empty
    const keys = Array.isArray(parsed.finding_keys)
      ? parsed.finding_keys.filter((k): k is string => typeof k === 'string')
      : []
    return { ...empty, updated_at_ms: Number(parsed.updated_at_ms) || 0, finding_keys: keys }
  } catch {
    return empty
  }
}

// Durably writes the merged key set. Call ONLY after the findings document for
// this run has been written.
export async function writeEmittedState(workspaceRoot: string, state: EmittedState): Promise<void> {
  await mkdir(stateDir(workspaceRoot), { recursive: true })
  await writeFile(
    statePath(workspaceRoot, state.detector, state.network),
    JSON.stringify(state, null, 2) + '\n',
    'utf8',
  )
}

export interface NoveltyFilter {
  // Findings the operator has not seen yet — the only ones worth emitting.
  fresh: DetectionFinding[]
  // How many findings were dropped because they were already emitted.
  suppressed: number
  // The key set to persist once the document is durably written.
  nextKeys: string[]
}

// Splits a full-scan result into new-since-last-run and already-emitted.
// `reset` (a `--full` run) re-emits everything and rebuilds the state from
// scratch, which is the operator's escape hatch for rebuilding a lost backlog.
export function filterNewFindings(
  findings: DetectionFinding[],
  previousKeys: readonly string[],
  reset = false,
): NoveltyFilter {
  const seen = reset ? new Set<string>() : new Set(previousKeys)
  const fresh: DetectionFinding[] = []
  let suppressed = 0
  for (const finding of findings) {
    const key = findingKey(finding)
    if (seen.has(key)) {
      suppressed += 1
      continue
    }
    seen.add(key)
    fresh.push(finding)
  }
  return { fresh, suppressed, nextKeys: [...seen].sort() }
}
