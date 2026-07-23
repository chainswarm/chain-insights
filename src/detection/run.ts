// Detection run driver (rbmk#462): ties registry → runtime → emit → checkpoint
// for the CLI. One invocation = one incremental (or full) scan: read window,
// scan, write findings, then (and only then) advance the checkpoint. `--watch`
// loops this. Findings never carry a reviewer — the import gate stays the only
// path to labels.
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { writeFindings } from './emit.js'
import { resolveDetector } from './registry.js'
import { commitCheckpoint, runDetection } from './runtime.js'

export interface DetectRunOptions {
  detector: string
  network: string
  full: boolean
  workspaceRoot: string
  nowMs: number
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
  const { document, checkpointAdvancedTo } = await runDetection(scanner, client, opts.workspaceRoot, {
    network: opts.network,
    full: opts.full,
    nowMs: opts.nowMs,
    params: opts.params,
  })
  const findingsPath = await writeFindings(opts.workspaceRoot, opts.detector, document)
  // Advance the checkpoint ONLY after the findings are durably on disk.
  await commitCheckpoint(opts.workspaceRoot, scanner, opts.network, checkpointAdvancedTo)
  return { findingsPath, findingsCount: document.findings.length, status: document.status }
}
