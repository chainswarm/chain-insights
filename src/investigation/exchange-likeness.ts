// aml_exchange_likeness — read-only, client-side exchange-likeness
// classification for 1-25 candidate addresses. Thresholds port the
// (pre-revert, never re-validated) internal/exchangedetector constants —
// fan-in >= 1000, reciprocity <= 6%, lifetime inbound >= $50M — per the A2-pre
// calibration task; any drift correction belongs in the constants below plus
// the threshold_provenance recorded on every findings document.
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

export const FANIN_MIN = 1000
export const RECIPROCITY_MAX = 0.06
export const LIFETIME_INBOUND_MIN_USD = 50_000_000
export const MAX_CANDIDATES = 25

const GRAPH_QUERY_BATCH_TIMEOUT_SECONDS = 10
const GRAPH_QUERY_BATCH_REQUEST_TIMEOUT_MS = 5 * 60 * 1000

export interface ExchangeLikenessOptions {
  addresses: string | string[]
  network: string
  writeArtifacts?: boolean
  workspaceRoot?: string
}

export interface ExchangeLikenessCandidateResult {
  address: string
  exchange_like: boolean | null
  degree_in: number
  reciprocity: number | null
  total_in_usd: number
  failing_threshold?: string
  inconclusive_reason?: string
}

export interface ExchangeLikenessResult {
  document: DetectionFindingsDocument
  candidates: ExchangeLikenessCandidateResult[]
  summaryText: string
  filePath?: string
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

function normalizeAddresses(input: string | string[]): string[] {
  const raw = Array.isArray(input) ? input : input.split(',')
  return [...new Set(raw.map((value) => value.trim()).filter((value) => value.length > 0))]
}

// Point-lookup of graphsync-materialized node props for one candidate. A
// property-keyed MATCH naturally returns at most one row; LIMIT 1 is
// defensive, not load-bearing.
//
// Reads the LIFETIME fan-in and inbound value from USE topology node-metric
// projections. Historically this read facts_address_features_view via the
// HAS_FEATURE edge, because a topology node's total_in_usd was a
// shard-window figure ~10x below lifetime on real exchanges (2026-07-09 UAT:
// live $421M vs facts $4.14B). Since the federation typed-AST planner
// (SPEC-2026-07-22-FED-PLANNER, rbmk#458), a multi-shard node-metric
// projection is re-derived EXACTLY: total_in_usd is summed across the
// disjoint shard windows and degree_in is the union of per-shard distinct
// counterparty sets, both proven byte-equal to a monolithic genesis-to-tip
// oracle graph (data-pipeline federation-difftest corpus case
// plan-node-metric-lifetime). This removes exchange-likeness's last
// dependency on facts_address_features_view (rbmk#447 P3/P5).
function profileQuery(id: string, address: string): { id: string; query: string } {
  return {
    id,
    query: `USE topology MATCH (a:Address {address: "${escapeCypherString(address)}"}) RETURN a.address AS address, a.degree_in AS degree_in, a.total_in_usd AS total_in_usd LIMIT 1`,
  }
}

// Single-row server-side reciprocity aggregate: collect distinct in-neighbor
// addresses, collect distinct out-neighbor addresses, and count how many
// in-neighbors are ALSO out-neighbors — all in one query, no client-side
// sampling. No LIMIT clause: this is an aggregate that can never return more
// than one row by construction, so the LIMIT <= 200 convention (which governs
// row-returning queries) does not apply.
function reciprocityQuery(id: string, address: string): { id: string; query: string } {
  return {
    id,
    query: [
      `MATCH (a:Address {address: "${escapeCypherString(address)}"})`,
      'OPTIONAL MATCH (inN:Address)-[:FLOWS_TO]->(a)',
      'WITH a, collect(DISTINCT inN.address) AS in_addresses',
      'OPTIONAL MATCH (a)-[:FLOWS_TO]->(outN:Address)',
      'WITH a, in_addresses, collect(DISTINCT outN.address) AS out_addresses',
      'RETURN a.address AS address, size(in_addresses) AS in_count, size([addr IN in_addresses WHERE addr IN out_addresses]) AS reciprocal_count',
    ].join(' '),
  }
}

// Exported so tests/corpus tooling can inspect exact emitted query text
// (denylist grep, single-row-aggregate shape assertions).
export const exchangeLikenessQueryBuilderContract = { profileQuery, reciprocityQuery }

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
  return `USE topology ${trimmed}`
}

async function callGraphBatch(remoteClient: Client, network: string, queries: Array<{ id: string; query: string }>): Promise<ParsedGraphBatch> {
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

type FailureReason = 'admission_rejected' | 'query_timeout' | 'query_failed'

function classifyFailure(message: string | undefined): FailureReason {
  const normalized = (message ?? '').toLowerCase()
  if (normalized.includes('admission')) return 'admission_rejected'
  if (normalized.includes('timeout') || normalized.includes('timed out')) return 'query_timeout'
  return 'query_failed'
}

function findEntry(batch: ParsedGraphBatch, id: string): { ok?: boolean; results?: Array<Record<string, unknown>>; error?: string } | undefined {
  return batch.facts?.queries?.find((entry) => entry.id === id)
}

interface ThresholdProvenance {
  fanin_min: number
  reciprocity_max: number
  lifetime_inbound_min_usd: number
  source: string
  calibration_status: string
  [key: string]: unknown
}

const THRESHOLD_PROVENANCE: ThresholdProvenance = {
  fanin_min: FANIN_MIN,
  reciprocity_max: RECIPROCITY_MAX,
  lifetime_inbound_min_usd: LIFETIME_INBOUND_MIN_USD,
  source: 'ported from data-pipeline internal/exchangedetector (pre-revert, dead code)',
  calibration_status: 'pending A2-pre re-validation against current address-grain data',
}

function classifyCandidate(address: string, degreeIn: number, totalInUsd: number, reciprocity: number | null, inconclusiveReason: string | undefined): ExchangeLikenessCandidateResult {
  if (reciprocity === null) {
    return {
      address,
      exchange_like: null,
      degree_in: degreeIn,
      reciprocity: null,
      total_in_usd: totalInUsd,
      inconclusive_reason: inconclusiveReason,
    }
  }

  const failingThreshold = degreeIn < FANIN_MIN
    ? 'fan_in'
    : reciprocity > RECIPROCITY_MAX
      ? 'reciprocity'
      : totalInUsd < LIFETIME_INBOUND_MIN_USD
        ? 'lifetime_inbound_usd'
        : undefined

  return {
    address,
    exchange_like: failingThreshold === undefined,
    degree_in: degreeIn,
    reciprocity,
    total_in_usd: totalInUsd,
    failing_threshold: failingThreshold,
  }
}

function summarize(network: string, candidates: ExchangeLikenessCandidateResult[]): string {
  const lines = [`Exchange-likeness classification for ${network}: ${candidates.length} candidate(s).`]
  for (const candidate of candidates) {
    const verdict = candidate.exchange_like === null ? 'inconclusive' : candidate.exchange_like ? 'exchange_like' : 'not_exchange_like'
    const detail = candidate.exchange_like === null
      ? ` (${candidate.inconclusive_reason ?? 'unknown reason'})`
      : candidate.failing_threshold
        ? ` (failing: ${candidate.failing_threshold})`
        : ''
    lines.push(`  - ${candidate.address}: ${verdict}${detail} [degree_in=${candidate.degree_in}, reciprocity=${candidate.reciprocity ?? 'n/a'}, total_in_usd=${candidate.total_in_usd}]`)
  }
  return lines.join('\n')
}

export async function exchangeLikeness(remoteClient: Client, options: ExchangeLikenessOptions): Promise<ExchangeLikenessResult> {
  const network = options.network.trim()
  if (!network) throw new Error('network is required')
  const addresses = normalizeAddresses(options.addresses)
  if (addresses.length === 0) throw new Error('at least one address is required')
  if (addresses.length > MAX_CANDIDATES) throw new Error(`aml_exchange_likeness supports at most ${MAX_CANDIDATES} candidates per call (got ${addresses.length})`)

  const profileQueries = addresses.map((address, index) => profileQuery(`profile_${index}`, address))
  const reciprocityQueries = addresses.map((address, index) => reciprocityQuery(`reciprocity_${index}`, address))

  const batch = await callGraphBatch(remoteClient, network, [...profileQueries, ...reciprocityQueries])

  const candidates: ExchangeLikenessCandidateResult[] = addresses.map((address, index) => {
    const profileEntry = findEntry(batch, `profile_${index}`)
    const profileRow = profileEntry?.ok !== false ? profileEntry?.results?.[0] : undefined
    const degreeIn = numberValue(profileRow?.['degree_in'])
    const totalInUsd = numberValue(profileRow?.['total_in_usd'])

    const reciprocityEntry = findEntry(batch, `reciprocity_${index}`)
    let reciprocity: number | null = null
    let inconclusiveReason: string | undefined
    if (!reciprocityEntry || reciprocityEntry.ok === false) {
      inconclusiveReason = classifyFailure(reciprocityEntry?.error)
    } else {
      const row = reciprocityEntry.results?.[0]
      const inCount = numberValue(row?.['in_count'])
      const reciprocalCount = numberValue(row?.['reciprocal_count'])
      reciprocity = inCount === 0 ? 0 : reciprocalCount / inCount
    }

    return classifyCandidate(address, degreeIn, totalInUsd, reciprocity, inconclusiveReason)
  })

  const status: DetectionRunStatus = candidates.some((candidate) => candidate.exchange_like === null) ? 'inconclusive' : 'complete'
  const findings: DetectionFinding[] = candidates.map((candidate) => ({
    address: candidate.address,
    exchange_like: candidate.exchange_like,
    gate: candidate.failing_threshold
      ? `failing_threshold:${candidate.failing_threshold}`
      : candidate.exchange_like
        ? 'exchange_like_thresholds_cleared'
        : undefined,
    evidence: {
      degree_in: candidate.degree_in,
      reciprocity: candidate.reciprocity,
      total_in_usd: candidate.total_in_usd,
    },
    truncated: false,
    inconclusive: candidate.exchange_like === null,
    inconclusive_reason: candidate.inconclusive_reason,
  }))

  const document: DetectionFindingsDocument = {
    schema: DETECTION_FINDINGS_SCHEMA_VERSION,
    tool: 'aml_exchange_likeness',
    network,
    status,
    generated_at_ms: Date.now(),
    findings,
    threshold_provenance: THRESHOLD_PROVENANCE,
  }

  const writeArtifacts = options.writeArtifacts !== false
  let filePath: string | undefined
  if (writeArtifacts) {
    const serialized = await serializeFindings(document, { workspaceRoot: options.workspaceRoot })
    filePath = serialized.filePath
  }

  return {
    document,
    candidates,
    summaryText: summarize(network, candidates),
    filePath,
  }
}
