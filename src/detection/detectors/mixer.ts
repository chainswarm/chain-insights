// mixer-likeness detector (rbmk#462), relocated from data-pipeline
// internal/recipes/sql.go BuildMixerLayerLabelSQL. The hourglass heuristic: an
// address with ≥N distinct in-counterparties AND ≥N distinct out-counterparties
// is mixer-shaped. Candidate-driven (like exchange-likeness): given candidate
// addresses, it reads each one's federated-exact lifetime degree metrics via
// USE topology and classifies. Excludes curated non-mixer roles (exchanges,
// bridges, routers, contracts, validators) and protocol sinks (0x0, 0x…dead).
// Emits reviewable findings, never a direct label. Thresholds ported (DEC-7).
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { DetectionFinding } from '../../investigation/detection-findings.js'
import { graphQueryRows, type GraphRow } from '../graph-client.js'
import type { DetectorParams, DetectorScan, DetectionWindow } from '../runtime.js'

// Backward-compatible export: the generic default hourglass floor. Networks and
// operators override it (see resolveMixerConfig).
export const MIXER_MIN_INPUT_COUNT = 5
export const MIXER_MIN_OUTPUT_COUNT = 5

// Mixer is a flexible tool: it ships per-network default thresholds (a dense
// chain needs a higher hourglass floor than a sparse one — bittensor's live
// shard has 7,270 addresses clearing 5/5 but only 814 clearing 50/50), and the
// operator can override ANY knob via `--param`. Hourglass-degree alone is a
// weak signal (DEC-19); the defaults are noise-reduction, not a correctness
// gate — findings are always reviewer-gated.
export interface MixerConfig {
  minIn: number
  minOut: number
  maxCandidates: number
  timeScope: string
  roleKeywords: string[]
}

// Per-network default hourglass floors. Unlisted networks use the generic
// default (5/5). Tuned from live degree distributions, adjustable over time.
const MIXER_NETWORK_DEFAULTS: Record<string, { minIn: number; minOut: number }> = {
  bittensor: { minIn: 50, minOut: 50 },
  bittensor_evm: { minIn: 20, minOut: 20 },
}

function numParam(params: DetectorParams, key: string, fallback: number): number {
  const raw = params[key]
  if (raw === undefined) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

// resolveMixerConfig layers operator `--param` overrides on top of the
// per-network defaults. Recognized params: min_in, min_out, max_candidates,
// time_scope, role_keywords (comma-separated). Anything unset falls back to the
// network default, then the generic default.
export function resolveMixerConfig(network: string, params: DetectorParams): MixerConfig {
  const base = MIXER_NETWORK_DEFAULTS[network] ?? { minIn: MIXER_MIN_INPUT_COUNT, minOut: MIXER_MIN_OUTPUT_COUNT }
  const roleRaw = params.role_keywords
  return {
    minIn: numParam(params, 'min_in', base.minIn),
    minOut: numParam(params, 'min_out', base.minOut),
    maxCandidates: numParam(params, 'max_candidates', 1000),
    timeScope: params.time_scope?.trim() || 'recent',
    roleKeywords: roleRaw
      ? roleRaw
          .split(',')
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean)
      : DEFAULT_NON_MIXER_ROLE_KEYWORDS,
  }
}

// graphrag-sync's curated non-mixer role keywords + the EVM protocol sinks the
// mixer SQL excludes (rbmk#461 L3 fix). On the graph, roles live as free-text
// label strings (e.g. "Binance exchange", "validator"), so exclusion is a
// case-insensitive substring match — the same shape as the graph's own
// is_exchange derivation (a label CONTAINING 'exchange'). A mixer label is
// never minted for these. The operator can override the list via
// `--param role_keywords=...`.
export const DEFAULT_NON_MIXER_ROLE_KEYWORDS = ['exchange', 'bridge', 'dex', 'contract', 'token', 'validator']
const PROTOCOL_SINKS = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
])

function num(row: GraphRow, key: string): number {
  const v = row[key]
  return typeof v === 'number' ? v : Number(v) || 0
}

function str(row: GraphRow, key: string): string {
  const v = row[key]
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

export interface MixerMetrics {
  address: string
  degree_in: number
  degree_out: number
  labels: string[]
  is_exchange: boolean
}

// Pure classifier: given one candidate's metrics and the resolved thresholds,
// return a finding or null. `cfg` defaults to the generic floor + default role
// keywords so offline unit tests and simple callers need not build a config.
// Exposed for offline unit testing.
export function classifyMixer(
  m: MixerMetrics,
  cfg: Pick<MixerConfig, 'minIn' | 'minOut' | 'roleKeywords'> = {
    minIn: MIXER_MIN_INPUT_COUNT,
    minOut: MIXER_MIN_OUTPUT_COUNT,
    roleKeywords: DEFAULT_NON_MIXER_ROLE_KEYWORDS,
  },
): DetectionFinding | null {
  if (PROTOCOL_SINKS.has(m.address.toLowerCase())) return null
  if (m.is_exchange) return null
  const lowered = m.labels.map((l) => l.toLowerCase())
  if (lowered.some((l) => cfg.roleKeywords.some((k) => l.includes(k)))) return null
  if (m.degree_in < cfg.minIn || m.degree_out < cfg.minOut) return null
  return {
    address: m.address,
    classification: 'mixer_hourglass',
    gate: 'hourglass_in_out',
    evidence: { degree_in: m.degree_in, degree_out: m.degree_out, min_in: cfg.minIn, min_out: cfg.minOut },
    truncated: false,
    inconclusive: false,
  }
}

function toLabels(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x))
  return []
}

// mixerScan checks the given candidate addresses. When no candidates are passed
// (batch mode without a candidate source), it returns [] and records a warning
// via the empty result — the candidate-source wiring (recent-active enumeration)
// is a follow-up (rbmk#462, DEC-15). aml_mixer_likeness (the interactive tool)
// always passes candidates.
export async function mixerScanCandidates(
  client: Client,
  network: string,
  candidates: string[],
  cfg: MixerConfig = resolveMixerConfig(network, {}),
): Promise<DetectionFinding[]> {
  const findings: DetectionFinding[] = []
  for (const address of candidates) {
    const safe = address.replace(/"/g, '')
    const rows = await graphQueryRows(
      client,
      network,
      `USE topology MATCH (a:Address {address: "${safe}"}) RETURN a.address AS address, a.degree_in AS degree_in, a.degree_out AS degree_out, a.labels AS labels, a.is_exchange AS is_exchange LIMIT 1`,
      cfg.timeScope,
    )
    const row = rows[0]
    if (!row) continue
    const finding = classifyMixer(
      {
        address: str(row, 'address') || address,
        degree_in: num(row, 'degree_in'),
        degree_out: num(row, 'degree_out'),
        labels: toLabels(row['labels']),
        is_exchange: row['is_exchange'] === true || row['is_exchange'] === 1,
      },
      cfg,
    )
    if (finding) findings.push(finding)
  }
  return findings
}

// mixerScanBatch is the candidate source (DEC-15 resolved): enumerate addresses
// whose degrees clear BOTH hourglass thresholds, pulling the classifier metrics
// inline in one topology query (degree-filtered node scan, no per-address round
// trips), ordered so the highest-degree candidates fill the cap first. Each row
// is run through classifyMixer so the boundary/protocol-sink exclusions apply.
export async function mixerScanBatch(
  client: Client,
  network: string,
  cfg: MixerConfig = resolveMixerConfig(network, {}),
): Promise<DetectionFinding[]> {
  // degree_in/degree_out are node-metric projections that cannot merge exactly
  // across temporal shards, so the scan runs with the configured time_scope
  // (default "recent" = live shard only). Degrees are therefore window-exact,
  // not lifetime — a deliberate tradeoff (DEC-11/DEC-19); a lifetime sweep would
  // need per-shard scans + client-side degree recombination, which node metrics
  // don't permit.
  const rows = await graphQueryRows(
    client,
    network,
    `USE topology MATCH (a:Address) WHERE a.degree_in >= ${cfg.minIn} AND a.degree_out >= ${cfg.minOut} RETURN a.address AS address, a.degree_in AS degree_in, a.degree_out AS degree_out, a.labels AS labels, a.is_exchange AS is_exchange ORDER BY a.degree_in + a.degree_out DESC LIMIT ${cfg.maxCandidates}`,
    cfg.timeScope,
  )
  const findings: DetectionFinding[] = []
  for (const row of rows) {
    const finding = classifyMixer(
      {
        address: str(row, 'address'),
        degree_in: num(row, 'degree_in'),
        degree_out: num(row, 'degree_out'),
        labels: toLabels(row['labels']),
        is_exchange: row['is_exchange'] === true || row['is_exchange'] === 1,
      },
      cfg,
    )
    if (finding) findings.push(finding)
  }
  return findings
}

export const mixerDetector: DetectorScan = {
  tool: 'aml_mixer_likeness',
  id: 'mixer',
  thresholds: (network, params) => {
    const cfg = resolveMixerConfig(network, params)
    return {
      ported_from: 'internal/recipes/sql.go BuildMixerLayerLabelSQL',
      min_input_count: cfg.minIn,
      min_output_count: cfg.minOut,
      max_candidates: cfg.maxCandidates,
      time_scope: cfg.timeScope,
      role_keywords: cfg.roleKeywords,
    }
  },
  async scan(_window: DetectionWindow, client: Client, network: string, params: DetectorParams): Promise<DetectionFinding[]> {
    // Resolve per-network defaults + operator `--param` overrides, then run the
    // degree-qualified candidate scan. The interactive aml_mixer_likeness tool
    // can still call mixerScanCandidates directly with its own candidate list.
    const cfg = resolveMixerConfig(network, params)
    return mixerScanBatch(client, network, cfg)
  },
}
