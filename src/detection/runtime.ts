// Detection runtime (rbmk#462): the shared incremental-scan core every CIA
// detector runs through. A detector is a pure `scan(window, client) →
// findings[]` function; the runtime owns the window (from checkpoint or full),
// wraps findings in the versioned findings document (reviewer deliberately
// UNSET so the curated-import gate still refuses until a human reviews), and
// exposes an optional `--watch` loop. Backend reads go only through the
// federated graph_query path (the GraphClient) — no direct warehouse access.
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  DETECTION_FINDINGS_SCHEMA_VERSION,
  type DetectionFinding,
  type DetectionFindingsDocument,
  type DetectionToolName,
} from '../investigation/detection-findings.js'
import { readCheckpoint, writeCheckpoint, type DetectionCheckpoint } from './checkpoint.js'
import { filterNewFindings, readEmittedState, writeEmittedState } from './emitted-state.js'

export interface DetectionWindow {
  fromMs: number
  toMs: number
  full: boolean
}

// How a detector relates to the scan window, declared per detector so the
// runtime can behave honestly instead of pretending every scan is incremental.
//
// - 'incremental': the detector BOUNDS its queries by `window` (events inside
//   (from, to]). The checkpoint is meaningful and advances after each run.
// - 'full-state':  the detector classifies from CURRENT cumulative graph state
//   (node degree metrics, taxonomy labels, the asset registry), which carries no
//   usable event timestamp. Bounding it by a window would not make it cheaper,
//   it would make it WRONG. Such a detector always receives a full window, its
//   checkpoint is NOT advanced (nothing reads it), and the runtime emits only
//   findings not already emitted for that network so a run over unchanged data
//   adds nothing to the review backlog.
export type DetectorWindowMode = 'incremental' | 'full-state'

// DetectorParams is the operator-supplied argument bag (from `--param k=v`).
// Each detector interprets its OWN keys; unknown keys are ignored. Values are
// raw strings — detectors coerce as needed. This is the flexible-tool surface:
// the operator decides which knobs to set; the detector supplies per-network
// defaults for everything left unset.
export type DetectorParams = Record<string, string>

export interface DetectorScan {
  // The findings `tool` name this detector emits (must be a DetectionToolName).
  tool: DetectionToolName
  // The detector id used for CLI + checkpoint file naming (e.g. "fake-token").
  id: string
  // Declares whether this detector honors the scan window. Defaults to
  // 'incremental' — a detector that ignores `window` MUST declare 'full-state'
  // so the runtime stops advancing a checkpoint nothing reads and starts
  // de-duplicating its output against previous runs.
  windowMode?: DetectorWindowMode
  // Pure scan: given a window, a graph client, the network, and the operator
  // param bag, return findings. No IO beyond the client; deterministic given
  // inputs so it is unit-testable with a fake.
  scan(
    window: DetectionWindow,
    client: Client,
    network: string,
    params: DetectorParams,
  ): Promise<DetectionFinding[]>
  // Optional threshold provenance recorded on every document. Receives the
  // network + resolved params so it can echo the EFFECTIVE configuration.
  thresholds?(network: string, params: DetectorParams): Record<string, unknown>
}

export interface RunDetectionOptions {
  network: string
  full: boolean
  nowMs: number
  // Operator-supplied per-run params (default empty).
  params?: DetectorParams
}

export interface RunDetectionResult {
  document: DetectionFindingsDocument
  // Timestamp the checkpoint should advance to, or null when this detector has
  // no meaningful checkpoint (windowMode 'full-state'). A null here means the
  // caller must NOT write a checkpoint.
  checkpointAdvancedTo: number | null
  // Present only for 'full-state' detectors: the emitted-findings key set to
  // persist once the document is durably written.
  emittedKeys?: string[]
}

// Runs one scan and builds the findings document. Does NOT write the checkpoint
// (the caller advances it only after durably writing the document). `nowMs` is
// injected for deterministic tests.
export async function runDetection(
  scanner: DetectorScan,
  client: Client,
  workspaceRoot: string,
  opts: RunDetectionOptions,
): Promise<RunDetectionResult> {
  const mode: DetectorWindowMode = scanner.windowMode ?? 'incremental'
  const fullState = mode === 'full-state'
  // A full-state detector always gets an honest full window: it never reads the
  // checkpoint, so handing it a narrowed one would misrepresent what it scanned.
  const checkpoint = fullState
    ? null
    : await readCheckpoint(workspaceRoot, scanner.id, opts.network)
  const fromMs = fullState || opts.full ? 0 : (checkpoint?.last_block_timestamp_ms ?? 0)
  const window: DetectionWindow = { fromMs, toMs: opts.nowMs, full: fullState || opts.full }
  const params = opts.params ?? {}
  const scanned = await scanner.scan(window, client, opts.network, params)

  // Incremental detectors bound their own queries, so what they return is
  // already new-since-last-run and is emitted as-is.
  if (!fullState) {
    return { document: buildDocument(scanner, opts, scanned, params), checkpointAdvancedTo: opts.nowMs }
  }

  // Full-state detectors re-derive their whole result set every run. Emit only
  // what the operator has not already been shown; a `--full` run deliberately
  // resets the state and re-emits everything.
  const previous = await readEmittedState(workspaceRoot, scanner.id, opts.network)
  const { fresh, suppressed, nextKeys } = filterNewFindings(scanned, previous.finding_keys, opts.full)
  const document = buildDocument(scanner, opts, fresh, params)
  if (suppressed > 0) {
    document.warnings = [
      ...(document.warnings ?? []),
      `full-state detector: suppressed ${suppressed} finding(s) already emitted for ${opts.network} in a previous run`,
    ]
  }
  // checkpointAdvancedTo is null on purpose: this detector reads no checkpoint,
  // so advancing one would fake an incremental scan that never happened.
  return { document, checkpointAdvancedTo: null, emittedKeys: nextKeys }
}

function buildDocument(
  scanner: DetectorScan,
  opts: RunDetectionOptions,
  findings: DetectionFinding[],
  params: DetectorParams,
): DetectionFindingsDocument {
  return {
    schema: DETECTION_FINDINGS_SCHEMA_VERSION,
    tool: scanner.tool,
    network: opts.network,
    status: 'complete',
    generated_at_ms: opts.nowMs,
    findings,
    ...(scanner.thresholds ? { threshold_provenance: scanner.thresholds(opts.network, params) } : {}),
    // reviewer is intentionally NOT set here — the curated-import gate refuses
    // any findings document without a human reviewer identity.
  }
}

// Persists the emitted-findings state for a full-state detector. Kept separate
// from runDetection (like commitCheckpoint) so a caller that fails to write the
// document never marks its findings as delivered.
export async function commitEmittedState(
  workspaceRoot: string,
  scanner: DetectorScan,
  network: string,
  keys: string[],
  nowMs: number,
): Promise<void> {
  await writeEmittedState(workspaceRoot, {
    schema: 'chain-insights.detection-emitted.v1',
    detector: scanner.id,
    network,
    updated_at_ms: nowMs,
    finding_keys: keys,
  })
}

// Advances the checkpoint after a document has been written. Kept separate from
// runDetection so a caller that fails to persist the document never advances.
export async function commitCheckpoint(
  workspaceRoot: string,
  scanner: DetectorScan,
  network: string,
  advancedToMs: number,
): Promise<void> {
  const checkpoint: DetectionCheckpoint = {
    detector: scanner.id,
    network,
    last_block_timestamp_ms: advancedToMs,
    last_scanned_at_ms: advancedToMs,
  }
  await writeCheckpoint(workspaceRoot, checkpoint)
}
