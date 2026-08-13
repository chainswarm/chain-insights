// Tunable search bounds for investigation and detection tools.
//
// Every hardcoded search cap in this repo used to be a bare `const` compiled
// into one call site. That is wrong for two reasons at once: a value that is
// right for a small chain is far too high for a busy one, and a value that is
// right for a routine sweep is far too low for an analyst working a single
// live case. A real high-fan-in deposit made the cost of that concrete — at
// the old 500-row reverse-deposit cap the victim origin was NOT reachable at
// four hops, and at 5000 rows the same four-hop trace closed the full
// deposit -> victim chain in six seconds. The cap, not the depth, was the
// binding constraint.
//
// This module generalizes the per-network default-table pattern (a
// `resolve*Config(network, params)` function) into ONE registry the whole
// codebase shares, so a knob is declared once with its default, its floor, and
// its hard ceiling.
//
// ── Precedence (highest wins) ──────────────────────────────────────────────
//   1. per-call      — an argument on the MCP tool / CLI flag / detector param
//   2. config file   — `networkLimits[network][key]` in ~/.chain-insights/config.json
//   3. config file   — `limits[key]` (all networks)
//   4. per-network   — NETWORK_LIMIT_DEFAULTS[network].defaults[key]
//   5. built-in      — LIMIT_SPECS[key].builtin
//
// ── Ceilings ───────────────────────────────────────────────────────────────
// An unbounded limit is a denial-of-service against the graph and against the
// caller's metered spend, so every knob carries a hard ceiling. The ceiling is
// NOT itself reachable from the per-call layer: a per-network entry may LOWER
// a ceiling for a chain that cannot afford the work, but nothing outside this
// file can RAISE the absolute maximum. Raising it is a code change, on
// purpose.
//
// ── Rejection, not silent clamping ─────────────────────────────────────────
// An over-ceiling request throws LimitRangeError naming the knob and its
// ceiling. Silently clamping would hand an analyst a result that reads as
// exhaustive when it is not — the same class of failure as the arbitrary row
// truncation this registry exists to fix.

export interface LimitSpec {
  /** Value used when no layer overrides it. Chosen to preserve historical behaviour exactly. */
  builtin: number
  /** Lowest accepted value. */
  min: number
  /** Absolute maximum. Only a code change to this file may raise it. */
  ceiling: number
  /** What the knob bounds, for docs and error messages. */
  description: string
}

// Row/frontier ceilings are generous because their cost is close to linear
// in the value; hop caps that grow exponentially with depth were removed
// with the aml_trace_* tools.
export const LIMIT_SPECS = {
  // ── viz/graph-model.ts ──
  viz_max_nodes: {
    builtin: 100,
    min: 1,
    ceiling: 2_000,
    description: 'Nodes rendered in a generated graph view before truncation.',
  },
} as const satisfies Record<string, LimitSpec>

export type LimitKey = keyof typeof LIMIT_SPECS
export const LIMIT_KEYS = Object.keys(LIMIT_SPECS) as LimitKey[]

export function isLimitKey(key: string): key is LimitKey {
  return Object.prototype.hasOwnProperty.call(LIMIT_SPECS, key)
}

export interface NetworkLimitOverride {
  /** Per-network default values. Must sit inside the built-in [min, ceiling]. */
  defaults?: Partial<Record<LimitKey, number>>
  /**
   * Per-network ceilings. May only LOWER the built-in ceiling; a higher value
   * is ignored so no chain can widen the absolute maximum from data.
   */
  ceilings?: Partial<Record<LimitKey, number>>
}

// Per-network defaults. Empty today: every chain currently starts on the
// built-in values, which is exactly what keeps this change behaviour-neutral.
// A chain that needs different economics adds an entry here (or an operator
// sets `networkLimits` in the config file) without touching a call site.
export const NETWORK_LIMIT_DEFAULTS: Record<string, NetworkLimitOverride> = {}

/** Config-file layer, as parsed from ~/.chain-insights/config.json. */
export interface LimitConfig {
  limits?: Partial<Record<LimitKey, number>>
  networkLimits?: Record<string, Partial<Record<LimitKey, number>>>
}

export class LimitRangeError extends Error {
  readonly code = 'LIMIT_OUT_OF_RANGE'
  constructor(
    readonly key: LimitKey,
    readonly requested: number,
    readonly min: number,
    readonly ceiling: number,
    readonly source: string,
  ) {
    super(
      `${key} must be an integer between ${min} and ${ceiling} (got ${requested} from ${source}). ` +
      `${LIMIT_SPECS[key].description} The ceiling is a hard bound and cannot be raised per call.`,
    )
    this.name = 'LimitRangeError'
  }
}

/**
 * The maximum this network will accept. A per-network entry may lower it;
 * nothing may raise it above the built-in ceiling.
 */
export function limitCeiling(key: LimitKey, network?: string): number {
  const builtinCeiling = LIMIT_SPECS[key].ceiling
  const networkCeiling = network ? NETWORK_LIMIT_DEFAULTS[network]?.ceilings?.[key] : undefined
  if (networkCeiling === undefined || !Number.isFinite(networkCeiling)) return builtinCeiling
  return Math.min(builtinCeiling, Math.trunc(networkCeiling))
}

export interface ResolveLimitContext {
  network?: string
  config?: LimitConfig
}

/**
 * The value used when the caller passes nothing: config file, then per-network
 * default, then built-in. Always inside [min, ceiling] for the network.
 */
export function limitDefault(key: LimitKey, ctx: ResolveLimitContext = {}): number {
  const spec = LIMIT_SPECS[key]
  const ceiling = limitCeiling(key, ctx.network)
  const candidates = [
    ctx.network ? ctx.config?.networkLimits?.[ctx.network]?.[key] : undefined,
    ctx.config?.limits?.[key],
    ctx.network ? NETWORK_LIMIT_DEFAULTS[ctx.network]?.defaults?.[key] : undefined,
  ]
  for (const candidate of candidates) {
    if (candidate === undefined || !Number.isFinite(candidate)) continue
    const value = Math.trunc(candidate)
    if (value < spec.min || value > ceiling) {
      throw new LimitRangeError(key, value, spec.min, ceiling, 'configuration')
    }
    return value
  }
  // The built-in is clamped rather than rejected: a per-network entry that
  // lowers a ceiling below the built-in default is a deliberate tightening of
  // that chain, not an operator error to fail on.
  return Math.min(spec.builtin, ceiling)
}

/** What a knob resolved to, and what the caller asked for. Emitted so a bounded search is visible without reading warnings. */
export interface LimitResolution {
  key: LimitKey
  /** What the caller passed, if anything. */
  requested?: number
  /** What the run actually used. */
  used: number
  /** The value that would have been used with no per-call override. */
  fallback: number
  /** The hard maximum for this network. */
  ceiling: number
}

/**
 * Resolve one knob. `requested` is the per-call layer; undefined/null/NaN
 * means "no override" and falls through to limitDefault.
 *
 * Throws LimitRangeError for a non-integer, below-min, or above-ceiling
 * request. Rejecting is deliberate: see the header note on silent clamping.
 */
export function resolveLimitDetail(
  key: LimitKey,
  requested: number | undefined | null,
  ctx: ResolveLimitContext = {},
): LimitResolution {
  const spec = LIMIT_SPECS[key]
  const ceiling = limitCeiling(key, ctx.network)
  const fallback = limitDefault(key, ctx)
  if (requested === undefined || requested === null) {
    return { key, used: fallback, fallback, ceiling }
  }
  if (!Number.isFinite(requested) || !Number.isInteger(requested)) {
    throw new LimitRangeError(key, Number(requested), spec.min, ceiling, 'the call')
  }
  if (requested < spec.min || requested > ceiling) {
    throw new LimitRangeError(key, requested, spec.min, ceiling, 'the call')
  }
  return { key, requested, used: requested, fallback, ceiling }
}

/** resolveLimitDetail, when only the number is wanted. */
export function resolveLimit(
  key: LimitKey,
  requested: number | undefined | null,
  ctx: ResolveLimitContext = {},
): number {
  return resolveLimitDetail(key, requested, ctx).used
}

/**
 * Renders resolved knobs for a tool response, so the effective depth/breadth
 * of a search is visible in the structured output without reading warnings.
 * `requested` is present only when the caller actually passed a value, which
 * makes "I asked for 4 and got 4" and "I asked for nothing and got 3"
 * distinguishable at a glance.
 */
export function limitsReport(resolutions: LimitResolution[]): Record<string, {
  requested?: number
  used: number
  default: number
  ceiling: number
}> {
  return Object.fromEntries(resolutions.map((resolution) => [resolution.key, {
    ...(resolution.requested !== undefined ? { requested: resolution.requested } : {}),
    used: resolution.used,
    default: resolution.fallback,
    ceiling: resolution.ceiling,
  }]))
}

/**
 * Integer-safe rendering for a value that is interpolated into a query.
 *
 * Cypher cannot parameterize a LIMIT, so the number is inlined — but ONLY
 * after resolveLimit has proven it is an integer inside a bounded range, and
 * this function re-proves it at the interpolation site. A recent CodeQL high
 * came from hand-interpolating an unvalidated value into query text; this is
 * the one sanctioned path.
 */
export function limitLiteral(value: number): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`limit literal must be a non-negative integer (got ${String(value)})`)
  }
  return String(value)
}

/**
 * Detector params arrive as a string bag (`--param key=value`, or a monitor
 * config cell's `params`). Parses one knob out of it with full validation, so
 * a typo is rejected rather than silently zeroing a bound.
 */
export function limitFromParams(
  key: LimitKey,
  params: Record<string, string | undefined>,
  paramName: string,
  ctx: ResolveLimitContext = {},
): number {
  const raw = params[paramName]
  if (raw === undefined || raw.trim() === '') return resolveLimit(key, undefined, ctx)
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    throw new LimitRangeError(key, Number.NaN, LIMIT_SPECS[key].min, limitCeiling(key, ctx.network), `param ${paramName}`)
  }
  return resolveLimit(key, Math.trunc(parsed), ctx)
}
