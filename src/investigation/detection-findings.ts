// Versioned findings schema shared by the two internal-only detection tools
// (aml_scam_corridor_trace, aml_exchange_likeness). Findings are artifacts —
// investigation output, never a direct label write. A separate RBMK-root
// quality-gated import path (Task A4) turns a reviewed findings document into
// curated core_address_labels rows.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod'
import { workspaceOutputPaths } from '../workspace/output-root.js'

export const DETECTION_FINDINGS_SCHEMA_VERSION = 'chain-insights.detection-findings.v1' as const

export const DETECTION_TOOL_NAMES = ['aml_scam_corridor_trace', 'aml_exchange_likeness', 'aml_address_poisoning', 'aml_fake_token', 'aml_attack_attribution', 'aml_mixer_likeness'] as const
export type DetectionToolName = typeof DETECTION_TOOL_NAMES[number]

export const DETECTION_RUN_STATUSES = ['complete', 'partial', 'inconclusive'] as const
export type DetectionRunStatus = typeof DETECTION_RUN_STATUSES[number]

// Matches gates.go's decideGate outcomes reachable from the client-side
// corridor trace. There is deliberately no "already scam labeled" or "shared
// deposit" classification value: the former has no distinct client-visible
// outcome (a mule path either way), and the latter is represented by the
// ABSENCE of a classification (see scam-corridor-trace.ts's shared-deposit
// gate arm) rather than a positive label.
export const DETECTION_CLASSIFICATIONS = [
  'propagated_scam',
  'corridor_hub',
  'exchange_terminal',
  'protected_infra',
  // Detection-to-CIA (rbmk#462): the four relocated detectors' classifications.
  'poisoning_duster',
  'fake_token_contract',
  'attributed_bad_actor',
  'mixer_hourglass',
] as const
export type DetectionClassification = typeof DETECTION_CLASSIFICATIONS[number]

const DetectionFindingSchema = z.object({
  address: z.string().min(1),
  // Present for aml_scam_corridor_trace findings; absent for
  // aml_exchange_likeness findings (which use exchange_like instead).
  classification: z.enum(DETECTION_CLASSIFICATIONS).optional(),
  // Present for aml_exchange_likeness findings; null means inconclusive
  // (never estimated from a truncated/partial sample).
  exchange_like: z.boolean().nullable().optional(),
  // Free-text gate/threshold identifier, e.g. 'exchange_terminal',
  // 'hub_degree_in', 'boundary_role:Validator', 'mixer_labeled',
  // 'shared_deposit_exchange_infra', 'propagated_scam',
  // 'failing_threshold:reciprocity'.
  gate: z.string().optional(),
  evidence: z.record(z.string(), z.unknown()).default({}),
  truncated: z.boolean().default(false),
  inconclusive: z.boolean().default(false),
  inconclusive_reason: z.string().optional(),
})
export type DetectionFinding = z.infer<typeof DetectionFindingSchema>

export const DETECTION_FINDINGS_SCHEMA = z.object({
  schema: z.literal(DETECTION_FINDINGS_SCHEMA_VERSION),
  tool: z.enum(DETECTION_TOOL_NAMES),
  network: z.string().min(1),
  status: z.enum(DETECTION_RUN_STATUSES),
  generated_at_timestamp: z.number().int().nonnegative(),
  findings: z.array(DetectionFindingSchema),
  // aml_scam_corridor_trace only: hop indices where the frontier cap
  // overflowed (present/non-empty only when status === 'partial').
  frontier_truncated: z.array(z.number().int().nonnegative()).optional(),
  query_count: z.number().int().nonnegative().optional(),
  wall_clock_ms: z.number().int().nonnegative().optional(),
  // Calibration/threshold provenance (A2-pre); free-form so either tool can
  // record what it needs without a schema bump.
  threshold_provenance: z.record(z.string(), z.unknown()).optional(),
  warnings: z.array(z.string()).optional(),
})
export type DetectionFindingsDocument = z.infer<typeof DETECTION_FINDINGS_SCHEMA>

function formatFindingsValidationError(error: z.ZodError): string {
  const issues = error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
  return `Invalid detection findings document: ${issues.join('; ')}`
}

// Throws with a readable message (never a raw ZodError) on schema mismatch —
// including a wrong/missing `schema` version literal (AC5).
export function parseFindingsDocument(raw: unknown): DetectionFindingsDocument {
  const result = DETECTION_FINDINGS_SCHEMA.safeParse(raw)
  if (!result.success) throw new Error(formatFindingsValidationError(result.error))
  return result.data
}

function sanitizeSlugSegment(value: string): string {
  const sanitized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80)
  return sanitized || 'findings'
}

function defaultFindingsSlug(document: DetectionFindingsDocument): string {
  const timestamp = new Date(document.generated_at_timestamp).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const toolSegment = document.tool.replace(/^aml_/, '')
  return `${timestamp}_${sanitizeSlugSegment(toolSegment)}`
}

export interface SerializeFindingsOptions {
  // Explicit workspace root (mainly for tests). Defaults to the active
  // workspace via workspaceOutputPaths()/requireWorkspaceRoot().
  workspaceRoot?: string
  // Explicit output filename slug (before the .detection-findings.json
  // suffix). Defaults to a timestamp+tool slug.
  slug?: string
}

export interface SerializeFindingsResult {
  filePath: string
  document: DetectionFindingsDocument
}

// Validates, then writes the findings document under the workspace's
// reports/tables directory (the same directory trace-funds uses for compact
// evidence JSON) via the shared output-root.ts helper.
export async function serializeFindings(
  document: DetectionFindingsDocument,
  options: SerializeFindingsOptions = {},
): Promise<SerializeFindingsResult> {
  const parsed = parseFindingsDocument(document)
  const paths = workspaceOutputPaths(options.workspaceRoot)
  await mkdir(paths.reportTablesRoot, { recursive: true, mode: 0o700 })
  const slug = options.slug ? sanitizeSlugSegment(options.slug) : defaultFindingsSlug(parsed)
  const filePath = path.join(paths.reportTablesRoot, `${slug}.detection-findings.json`)
  await writeFile(filePath, JSON.stringify(parsed, null, 2) + '\n', { mode: 0o600 })
  return { filePath, document: parsed }
}

// Reads a findings document back from disk and validates it (round-trip
// counterpart to serializeFindings).
export async function parseFindings(filePath: string): Promise<DetectionFindingsDocument> {
  const raw = await readFile(filePath, 'utf8')
  return parseFindingsDocument(JSON.parse(raw))
}
