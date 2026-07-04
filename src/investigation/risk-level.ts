/**
 * Risk-level normalization shared by the AML tools and graph payload builders.
 *
 * The Chain Insights Graph serves the ML verdict verbatim, which historically
 * mixed cases (HIGH vs high) and — since the calibrated-scoring release —
 * includes an explicit abstention band: risk_level = UNSCORED means the model
 * had too little labeled graph context to stand behind a band. UNSCORED is a
 * "no stance" state and must never be rendered or reasoned about as low risk.
 */

export const RISK_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
export const UNSCORED_RISK_LEVEL = 'unscored'

/** Lowercased, trimmed risk level; undefined for empty/unrecognized values. */
export function normalizeRiskLevel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized === UNSCORED_RISK_LEVEL) return UNSCORED_RISK_LEVEL
  if ((RISK_SEVERITIES as readonly string[]).includes(normalized)) return normalized
  return undefined
}

/** True when the ML verdict explicitly abstained (no stance, not low). */
export function isUnscoredRiskLevel(value: unknown): boolean {
  return normalizeRiskLevel(value) === UNSCORED_RISK_LEVEL
}

/**
 * Severity ordering for comparisons: low(0) < medium(1) < high(2) <
 * critical(3). Unknown/unscored values rank -1 — they never win a
 * severity comparison, they abstain from it.
 */
export function riskSeverityRank(value: unknown): number {
  const normalized = normalizeRiskLevel(value)
  if (!normalized || normalized === UNSCORED_RISK_LEVEL) return -1
  return (RISK_SEVERITIES as readonly string[]).indexOf(normalized)
}
