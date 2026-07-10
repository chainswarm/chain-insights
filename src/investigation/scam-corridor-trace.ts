// aml_scam_corridor_trace — read-only, client-side, hop-by-hop corridor trace
// from a scam seed address, mirroring the gate precedence of data-pipeline's
// internal/scamtopology/gates.go (decideGate) without any server-side label
// write: this tool only PROPOSES classifications as findings artifacts.
//
// Design note (deviation from the data-pipeline original, documented for
// review): gates.go's hub/mixer arm ("hubDrill") switches the ORIGINAL
// propagator from a forward beam into a separate bounded BFS corridor drill
// (corridor.go, up to 8 hops) that continues past the hub to find off-ramp
// exchanges. This client-side tool does not replicate that second drill
// pass — hub and mixer-labeled nodes are gate-classified (`corridor_hub`)
// and treated as traversal terminals for the main frontier, matching AC1's
// required classification output without importing the heavier drill
// mechanism. Boundary-role ("protected") nodes ARE still traversed through
// (per gates.go's own doc comment: "a small validator/miner/subnet is
// traversed through"), just never classified as scam.
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js'
import {
  DETECTION_FINDINGS_SCHEMA_VERSION,
  serializeFindings,
  type DetectionFinding,
  type DetectionFindingsDocument,
  type DetectionRunStatus,
} from './detection-findings.js'

type RemoteToolResult = {
  content?: ContentBlock[]
  isError?: boolean
}

interface ParsedGraphBatch {
  facts?: {
    queries?: Array<{
      id?: string
      ok?: boolean
      results?: Array<Record<string, unknown>>
      error?: string
    }>
  }
}

// ── Hard caps (unit-pinned; see spec AC2) ──
export const MAX_HOPS_CAP = 4
export const FRONTIER_CAP = 50
export const MAX_QUERIES_PER_BATCH = 20
export const QUERY_ROW_LIMIT = 200
export const WALL_CLOCK_BUDGET_MS = 120_000
export const DEFAULT_MAX_HOPS = 3
const RETRY_BACKOFF_MS = 50

// ── Gate thresholds, faithful to internal/scamtopology/gates.go ──
export const HUB_DEGREE_IN = 1000
export const SHARED_TX_COUNT = 1000
export const SHARED_USD_SUM = 5_000_000
export const BOUNDARY_ROLE_LABELS = ['Exchange', 'Bridge', 'Validator', 'Miner', 'Subnet'] as const

const LABEL_MIXER = 'Mixer'
const LABEL_SCAM = 'Scam'
const LABEL_VICTIM = 'Victim'
const LABEL_EXCHANGE = 'Exchange'
const LABEL_BRIDGE = 'Bridge'

const GRAPH_QUERY_BATCH_TIMEOUT_SECONDS = 10
const GRAPH_QUERY_BATCH_REQUEST_TIMEOUT_MS = 5 * 60 * 1000

export interface ScamCorridorTraceOptions {
  seedAddress: string
  network: string
  maxHops?: number
  // Internal caps, overridable (mainly for tests). Each is clamped to at
  // most its matching *_CAP/*_LIMIT/*_MS constant above — callers can tighten
  // a run, never loosen it past the hard cap.
  frontierCap?: number
  maxQueriesPerBatch?: number
  queryRowLimit?: number
  wallClockBudgetMs?: number
  writeArtifacts?: boolean
  workspaceRoot?: string
}

export interface ScamCorridorTraceResult {
  document: DetectionFindingsDocument
  summaryText: string
  filePath?: string
}

interface GateNode {
  degreeIn: number
  isExchange: boolean
  // The `labels(t)` node-label taxonomy graphsync reconciles onto :Address
  // (PascalCase :Scam/:Exchange/:Validator/…), never the free-text t.labels
  // property array — matching gates.go's labels(g) gate signal.
  labels: string[]
}

interface GateEdge {
  txCount: number
  amountUsd: number
}

export type GateDecisionKind = 'exchange_terminal' | 'corridor_hub' | 'protected_infra' | 'shared_deposit' | 'propagated_scam'

export interface GateDecision {
  kind: GateDecisionKind
  gate: string
  expand: boolean
}

function hasLabel(node: GateNode, label: string): boolean {
  return node.labels.includes(label)
}

function isExchangeNode(node: GateNode): boolean {
  return node.isExchange || hasLabel(node, LABEL_EXCHANGE)
}

function isBridgeNode(node: GateNode): boolean {
  return hasLabel(node, LABEL_BRIDGE)
}

function isScamNode(node: GateNode): boolean {
  return hasLabel(node, LABEL_SCAM) || hasLabel(node, LABEL_VICTIM)
}

// Hub-ness is a PROPERTY READ on the node's own graphsync-materialized
// degree_in — never a neighbor count performed by this client.
function isHub(node: GateNode): boolean {
  if (isExchangeNode(node)) return false
  if (isBridgeNode(node)) return false
  return node.degreeIn >= HUB_DEGREE_IN
}

function isAlreadyMixerLabeled(node: GateNode): boolean {
  return hasLabel(node, LABEL_MIXER)
}

// A node already confirmed scam/victim is NOT protected, matching gates.go's
// neverLabel: `if isScamNode(n) { return false }` before the boundary-role
// check.
function boundaryRole(node: GateNode): string | undefined {
  if (isScamNode(node)) return undefined
  return BOUNDARY_ROLE_LABELS.find((label) => hasLabel(node, label))
}

function isOmnibusDeposit(edge: GateEdge): boolean {
  return edge.txCount >= SHARED_TX_COUNT || edge.amountUsd >= SHARED_USD_SUM
}

// decideGate precedence: exchange terminal -> hub -> boundary-role protected
// -> mixer-labeled drill -> shared-deposit edge -> mule (propagated_scam).
export function decideGate(node: GateNode, edge: GateEdge): GateDecision {
  if (isExchangeNode(node)) return { kind: 'exchange_terminal', gate: 'exchange_terminal', expand: false }
  if (isHub(node)) return { kind: 'corridor_hub', gate: 'hub_degree_in', expand: false }
  const role = boundaryRole(node)
  if (role) return { kind: 'protected_infra', gate: `boundary_role:${role}`, expand: true }
  if (isAlreadyMixerLabeled(node)) return { kind: 'corridor_hub', gate: 'mixer_labeled', expand: false }
  if (isOmnibusDeposit(edge)) return { kind: 'shared_deposit', gate: 'shared_deposit_exchange_infra', expand: false }
  return { kind: 'propagated_scam', gate: 'propagated_scam', expand: true }
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(value as number)))
}

function escapeCypherString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function boolValue(value: unknown): boolean {
  if (value === true) return true
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === 'true' || normalized === '1'
  }
  if (typeof value === 'number') return value === 1
  return false
}

function stringArrayValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  return []
}

// frontierQuery is the ONLY Cypher this tool ever emits: a bounded one-hop
// outgoing FLOWS_TO expansion from a single source address, reading node
// props (degree_in, is_exchange), the `labels(t)` node-label taxonomy, and
// edge props (tx_count, amount_usd_sum). USE live_topology is applied by
// callGraphBatch, matching trace-funds.ts's convention.
//
// The gates key on `labels(t) AS node_labels` — the PascalCase node-label set
// (:Scam/:Victim/:Exchange/:Mixer/:Bridge/:Validator/:Miner/:Subnet) that
// graphsync reconciles onto each :Address every sync pass — NOT the free-text
// `t.labels` property array (entity names + lowercase tags like 'Binance',
// 'exchange', 'scam corridor hub'). This is faithful to the server-side
// original internal/scamtopology/gates.go, whose own comment states the gates
// read `labels(g)` "instead of scanning the labels property array." The
// free-text `t.labels` array is still selected as `entity_labels`, but only as
// human-readable evidence — never on the gate path.
function frontierQuery(id: string, address: string, limit: number): { id: string; query: string } {
  return {
    id,
    query: [
      `MATCH (s:Address {address: "${escapeCypherString(address)}"})-[r:FLOWS_TO]->(t:Address)`,
      'WHERE s.address <> t.address',
      'RETURN t.address AS address, t.degree_in AS degree_in, t.is_exchange AS is_exchange, labels(t) AS node_labels, t.labels AS entity_labels, r.tx_count AS tx_count, r.amount_usd_sum AS amount_usd_sum',
      'ORDER BY r.amount_usd_sum DESC',
      `LIMIT ${limit}`,
    ].join(' '),
  }
}

// Exported so tests/corpus tooling can inspect exact emitted query text
// (denylist grep, shape assertions) without driving the full traversal.
export const scamCorridorQueryBuilderContract = { frontierQuery }

function textFromToolResult(result: RemoteToolResult): string {
  return (result.content ?? [])
    .filter((item): item is Extract<ContentBlock, { type: 'text' }> => item.type === 'text')
    .map((item) => item.text)
    .join('\n')
}

function parseGraphBatchResult(result: RemoteToolResult): ParsedGraphBatch {
  const text = textFromToolResult(result).trim()
  if (!text) throw new Error('graph_query_batch returned no text content')
  const parsed = JSON.parse(text) as ParsedGraphBatch
  if (!parsed.facts?.queries) throw new Error('graph_query_batch response did not include facts.queries')
  return parsed
}

function topologyGraphQuery(query: string): string {
  const trimmed = query.trim()
  if (/^USE\s+/i.test(trimmed)) return trimmed
  return `USE live_topology ${trimmed}`
}

async function callGraphBatch(
  remoteClient: Client,
  network: string,
  queries: Array<{ id: string; query: string }>,
): Promise<ParsedGraphBatch> {
  const result = await remoteClient.callTool(
    {
      name: 'graph_query_batch',
      arguments: {
        network,
        queries: queries.map((query) => ({ ...query, query: topologyGraphQuery(query.query) })),
        per_query_timeout_seconds: GRAPH_QUERY_BATCH_TIMEOUT_SECONDS,
      },
    },
    undefined,
    { timeout: GRAPH_QUERY_BATCH_REQUEST_TIMEOUT_MS, maxTotalTimeout: GRAPH_QUERY_BATCH_REQUEST_TIMEOUT_MS },
  ) as RemoteToolResult
  if (result.isError) throw new Error(textFromToolResult(result) || 'graph_query_batch failed')
  return parseGraphBatchResult(result)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type FailureReason = 'admission_rejected' | 'query_timeout' | 'query_failed'

function classifyFailure(message: string | undefined): FailureReason {
  const normalized = (message ?? '').toLowerCase()
  if (normalized.includes('admission')) return 'admission_rejected'
  if (normalized.includes('timeout') || normalized.includes('timed out')) return 'query_timeout'
  return 'query_failed'
}

// Admission rejections and per-query transport failures are caught and
// retried ONCE with backoff; a second failure propagates to the caller,
// which marks the whole run inconclusive (never a silent truncation).
async function callGraphBatchWithRetry(
  remoteClient: Client,
  network: string,
  queries: Array<{ id: string; query: string }>,
): Promise<ParsedGraphBatch> {
  try {
    return await callGraphBatch(remoteClient, network, queries)
  } catch {
    await sleep(RETRY_BACKOFF_MS)
    return callGraphBatch(remoteClient, network, queries)
  }
}

interface DiscoveredNode {
  address: string
  decision: GateDecision
  evidence: Record<string, unknown>
}

function buildResultRowFinding(node: DiscoveredNode): DetectionFinding {
  return {
    address: node.address,
    classification: node.decision.kind === 'shared_deposit' ? undefined : node.decision.kind,
    gate: node.decision.gate,
    evidence: node.evidence,
    truncated: false,
    inconclusive: false,
  }
}

function summarize(seedAddress: string, network: string, status: DetectionRunStatus, findings: DetectionFinding[], queryCount: number, wallClockMs: number, hopsRun: number): string {
  const byClassification = new Map<string, number>()
  for (const finding of findings) {
    const key = finding.classification ?? finding.gate ?? 'unclassified'
    byClassification.set(key, (byClassification.get(key) ?? 0) + 1)
  }
  return [
    `Scam corridor trace for ${network}:${seedAddress} — status=${status}`,
    `Hops run: ${hopsRun}. Queries issued: ${queryCount}. Wall clock: ${wallClockMs}ms.`,
    `Findings: ${findings.length} address(es).`,
    ...[...byClassification.entries()].map(([key, count]) => `  - ${key}: ${count}`),
  ].join('\n')
}

export async function scamCorridorTrace(remoteClient: Client, options: ScamCorridorTraceOptions): Promise<ScamCorridorTraceResult> {
  const seedAddress = options.seedAddress.trim()
  const network = options.network.trim()
  if (!seedAddress) throw new Error('seed_address is required')
  if (!network) throw new Error('network is required')

  const maxHops = clampInt(options.maxHops, DEFAULT_MAX_HOPS, 1, MAX_HOPS_CAP)
  const frontierCap = clampInt(options.frontierCap, FRONTIER_CAP, 1, FRONTIER_CAP)
  const maxQueriesPerBatch = clampInt(options.maxQueriesPerBatch, MAX_QUERIES_PER_BATCH, 1, MAX_QUERIES_PER_BATCH)
  const queryRowLimit = clampInt(options.queryRowLimit, QUERY_ROW_LIMIT, 1, QUERY_ROW_LIMIT)
  const wallClockBudgetMs = clampInt(options.wallClockBudgetMs, WALL_CLOCK_BUDGET_MS, 0, WALL_CLOCK_BUDGET_MS)

  const startedAt = Date.now()
  const visited = new Set<string>([seedAddress])
  const findings: DetectionFinding[] = []
  const frontierTruncated: number[] = []
  const warnings: string[] = []
  let queryCount = 0
  let hopsRun = 0
  let inconclusiveReason: string | undefined

  let frontier = [seedAddress]

  hopLoop: for (let hop = 1; hop <= maxHops; hop += 1) {
    if (frontier.length === 0) break
    if (Date.now() - startedAt >= wallClockBudgetMs) {
      inconclusiveReason = 'budget_exceeded'
      warnings.push(`wall-clock budget (${wallClockBudgetMs}ms) exhausted before hop ${hop}`)
      break
    }

    hopsRun = hop
    const discovered: DiscoveredNode[] = []

    for (let batchStart = 0; batchStart < frontier.length; batchStart += maxQueriesPerBatch) {
      if (Date.now() - startedAt >= wallClockBudgetMs) {
        inconclusiveReason = 'budget_exceeded'
        warnings.push(`wall-clock budget (${wallClockBudgetMs}ms) exhausted mid-hop ${hop}`)
        break hopLoop
      }

      const batchAddresses = frontier.slice(batchStart, batchStart + maxQueriesPerBatch)
      const queries = batchAddresses.map((address, index) => frontierQuery(`hop${hop}_${batchStart + index}`, address, queryRowLimit))

      let batch: ParsedGraphBatch
      try {
        batch = await callGraphBatchWithRetry(remoteClient, network, queries)
      } catch (err) {
        inconclusiveReason = classifyFailure((err as Error).message)
        warnings.push(`hop ${hop} query batch failed after one retry: ${(err as Error).message}`)
        break hopLoop
      }
      queryCount += queries.length

      for (const query of queries) {
        const entry = batch.facts?.queries?.find((candidate) => candidate.id === query.id)
        if (!entry || entry.ok === false) {
          inconclusiveReason = classifyFailure(entry?.error)
          warnings.push(`hop ${hop} query ${query.id} failed: ${entry?.error ?? 'no result'}`)
          continue
        }
        for (const row of entry.results ?? []) {
          const address = typeof row['address'] === 'string' ? row['address'] : ''
          if (!address || visited.has(address)) continue
          visited.add(address)

          const node: GateNode = {
            degreeIn: numberValue(row['degree_in']),
            isExchange: boolValue(row['is_exchange']),
            // Gate signal: the labels(t) node-label taxonomy, NOT the free-text
            // t.labels property array (selected as entity_labels for evidence).
            labels: stringArrayValue(row['node_labels']),
          }
          const entityLabels = stringArrayValue(row['entity_labels'])
          const edge: GateEdge = {
            txCount: numberValue(row['tx_count']),
            amountUsd: numberValue(row['amount_usd_sum']),
          }
          const decision = decideGate(node, edge)
          discovered.push({
            address,
            decision,
            evidence: {
              hop,
              degree_in: node.degreeIn,
              is_exchange: node.isExchange,
              node_labels: node.labels,
              entity_labels: entityLabels,
              tx_count: edge.txCount,
              amount_usd_sum: edge.amountUsd,
            },
          })
        }
      }
    }
    if (inconclusiveReason) break

    discovered.sort((a, b) => a.address.localeCompare(b.address))
    let hopNodes = discovered
    if (discovered.length > frontierCap) {
      frontierTruncated.push(hop)
      hopNodes = discovered.slice(0, frontierCap)
    }

    for (const node of hopNodes) findings.push(buildResultRowFinding(node))
    frontier = hopNodes.filter((node) => node.decision.expand).map((node) => node.address)
  }

  const status: DetectionRunStatus = inconclusiveReason ? 'inconclusive' : frontierTruncated.length > 0 ? 'partial' : 'complete'
  const wallClockMs = Date.now() - startedAt
  if (inconclusiveReason) warnings.push(`run marked inconclusive: ${inconclusiveReason}`)

  const document: DetectionFindingsDocument = {
    schema: DETECTION_FINDINGS_SCHEMA_VERSION,
    tool: 'aml_scam_corridor_trace',
    network,
    status,
    generated_at_ms: Date.now(),
    findings,
    ...(frontierTruncated.length > 0 ? { frontier_truncated: frontierTruncated } : {}),
    query_count: queryCount,
    wall_clock_ms: wallClockMs,
    ...(warnings.length > 0 ? { warnings } : {}),
  }

  const writeArtifacts = options.writeArtifacts !== false
  let filePath: string | undefined
  if (writeArtifacts) {
    const serialized = await serializeFindings(document, { workspaceRoot: options.workspaceRoot })
    filePath = serialized.filePath
  }

  return {
    document,
    summaryText: summarize(seedAddress, network, status, findings, queryCount, wallClockMs, hopsRun),
    filePath,
  }
}
