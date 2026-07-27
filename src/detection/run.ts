// Detection run driver (rbmk#462): ties registry → runtime → emit → checkpoint
// for the CLI. One invocation = one scan: read window, scan, write findings,
// then (and only then) advance the run state. Which run state depends on the
// detector's declared windowMode — an incremental detector advances its scan
// checkpoint; a full-state detector advances its emitted-findings set instead,
// so repeated runs over unchanged data report nothing new. `--watch` loops this.
// Findings never carry a reviewer — the import gate stays the only path to
// labels.
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { writeFindings } from './emit.js'
import { resolveDetector } from './registry.js'
import { commitCheckpoint, commitEmittedState, runDetection } from './runtime.js'

export interface DetectRunOptions {
  detector: string
  network: string
  full: boolean
  workspaceRoot: string
  nowTimestamp: number
  // Operator-supplied `--param key=value` bag; each detector reads its own keys.
  params?: Record<string, string>
}

export interface DetectRunOutcome {
  findingsPath: string
  findingsCount: number
  status: string
}

export async function runOneDetection(
  client: Client,
  opts: DetectRunOptions,
): Promise<DetectRunOutcome> {
  const scanner = resolveDetector(opts.detector)
  const { document, checkpointAdvancedTo, emittedKeys } = await runDetection(scanner, client, opts.workspaceRoot, {
    network: opts.network,
    full: opts.full,
    nowTimestamp: opts.nowTimestamp,
    params: opts.params,
  })
  const findingsPath = await writeFindings(opts.workspaceRoot, opts.detector, document)
  // Advance run state ONLY after the findings are durably on disk.
  if (checkpointAdvancedTo !== null) {
    await commitCheckpoint(opts.workspaceRoot, scanner, opts.network, checkpointAdvancedTo)
  }
  // A full-state detector has no checkpoint; instead it records what it has
  // already emitted so the next run only reports genuinely new findings.
  if (emittedKeys) {
    await commitEmittedState(opts.workspaceRoot, scanner, opts.network, emittedKeys, opts.nowTimestamp)
  }
  return { findingsPath, findingsCount: document.findings.length, status: document.status }
}
