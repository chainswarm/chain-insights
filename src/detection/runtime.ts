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

export interface DetectionWindow {
  fromMs: number
  toMs: number
  full: boolean
}

export interface DetectorScan {
  // The findings `tool` name this detector emits (must be a DetectionToolName).
  tool: DetectionToolName
  // The detector id used for CLI + checkpoint file naming (e.g. "fake-token").
  id: string
  // Pure scan: given a window and a graph client, return findings. No IO beyond
  // the client; deterministic given inputs so it is unit-testable with a fake.
  scan(window: DetectionWindow, client: Client, network: string): Promise<DetectionFinding[]>
  // Optional threshold provenance recorded on every document.
  thresholds?(): Record<string, unknown>
}

export interface RunDetectionOptions {
  network: string
  full: boolean
  nowMs: number
}

export interface RunDetectionResult {
  document: DetectionFindingsDocument
  checkpointAdvancedTo: number
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
  const checkpoint = await readCheckpoint(workspaceRoot, scanner.id, opts.network)
  const fromMs = opts.full ? 0 : checkpoint.last_block_timestamp_ms
  const window: DetectionWindow = { fromMs, toMs: opts.nowMs, full: opts.full }
  const findings = await scanner.scan(window, client, opts.network)
  const document: DetectionFindingsDocument = {
    schema: DETECTION_FINDINGS_SCHEMA_VERSION,
    tool: scanner.tool,
    network: opts.network,
    status: 'complete',
    generated_at_ms: opts.nowMs,
    findings,
    ...(scanner.thresholds ? { threshold_provenance: scanner.thresholds() } : {}),
    // reviewer is intentionally NOT set here — the curated-import gate refuses
    // any findings document without a human reviewer identity.
  }
  return { document, checkpointAdvancedTo: opts.nowMs }
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
