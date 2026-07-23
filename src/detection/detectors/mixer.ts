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
import type { DetectorScan, DetectionWindow } from '../runtime.js'

export const MIXER_MIN_INPUT_COUNT = 5
export const MIXER_MIN_OUTPUT_COUNT = 5

// graphrag-sync's curated non-mixer role keywords + the EVM protocol sinks the
// mixer SQL excludes (rbmk#461 L3 fix). On the graph, roles live as free-text
// label strings (e.g. "Binance exchange", "validator"), so exclusion is a
// case-insensitive substring match — the same shape as the graph's own
// is_exchange derivation (a label CONTAINING 'exchange'). A mixer label is
// never minted for these.
const NON_MIXER_ROLE_KEYWORDS = ['exchange', 'bridge', 'dex', 'contract', 'token', 'validator']
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

// Pure classifier: given one candidate's metrics, return a finding or null.
// Exposed for offline unit testing.
export function classifyMixer(m: MixerMetrics): DetectionFinding | null {
  if (PROTOCOL_SINKS.has(m.address.toLowerCase())) return null
  if (m.is_exchange) return null
  const lowered = m.labels.map((l) => l.toLowerCase())
  if (lowered.some((l) => NON_MIXER_ROLE_KEYWORDS.some((k) => l.includes(k)))) return null
  if (m.degree_in < MIXER_MIN_INPUT_COUNT || m.degree_out < MIXER_MIN_OUTPUT_COUNT) return null
  return {
    address: m.address,
    classification: 'mixer_hourglass',
    gate: 'hourglass_in_out',
    evidence: { degree_in: m.degree_in, degree_out: m.degree_out },
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
): Promise<DetectionFinding[]> {
  const findings: DetectionFinding[] = []
  for (const address of candidates) {
    const safe = address.replace(/"/g, '')
    const rows = await graphQueryRows(
      client,
      network,
      `USE topology MATCH (a:Address {address: "${safe}"}) RETURN a.address AS address, a.degree_in AS degree_in, a.degree_out AS degree_out, a.labels AS labels, a.is_exchange AS is_exchange LIMIT 1`,
    )
    const row = rows[0]
    if (!row) continue
    const finding = classifyMixer({
      address: str(row, 'address') || address,
      degree_in: num(row, 'degree_in'),
      degree_out: num(row, 'degree_out'),
      labels: toLabels(row['labels']),
      is_exchange: row['is_exchange'] === true || row['is_exchange'] === 1,
    })
    if (finding) findings.push(finding)
  }
  return findings
}

export const mixerDetector: DetectorScan = {
  tool: 'aml_mixer_likeness',
  id: 'mixer',
  thresholds: () => ({
    ported_from: 'internal/recipes/sql.go BuildMixerLayerLabelSQL',
    min_input_count: MIXER_MIN_INPUT_COUNT,
    min_output_count: MIXER_MIN_OUTPUT_COUNT,
  }),
  async scan(_window: DetectionWindow, _client: Client, _network: string): Promise<DetectionFinding[]> {
    // Batch scan requires a candidate source (recent-active enumeration),
    // deferred with time_scope/windowing (DEC-15). The interactive
    // aml_mixer_likeness tool calls mixerScanCandidates directly.
    return []
  },
}
