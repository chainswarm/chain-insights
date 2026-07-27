// Contract tests for the tunable search bounds (src/config/limits.ts).
//
// Three things are being defended here, in priority order:
//   1. Making the caps tunable changed NO existing behaviour. Every knob's
//      unconfigured value equals the constant that used to be hardcoded, and
//      the query text generated with no override is byte-identical.
//   2. The ceilings are real. An over-ceiling request is REJECTED, not
//      quietly clamped into a result that reads as exhaustive.
//   3. Every new tool argument survives the MCP proxy's argument allowlist.
//      An argument missing from that list is silently stripped with no error,
//      which is how `time_scope` shipped broken.
import { describe, it, expect } from 'vitest'
import {
  LIMIT_KEYS,
  LIMIT_SPECS,
  LimitRangeError,
  NETWORK_LIMIT_DEFAULTS,
  limitCeiling,
  limitDefault,
  limitFromParams,
  limitLiteral,
  limitsReport,
  resolveLimit,
  resolveLimitDetail,
  type LimitKey,
} from '../src/config/limits.js'
import { parseInvestigatorConfig } from '../src/config/schema.js'
import { PUBLIC_MCP_TOOL_ALLOWED_ARGS } from '../src/mcp/tool-visibility.js'
import { reverseDepositSourceQueryAtDepth } from '../src/investigation/public-tools.js'
import {
  DEFAULT_MAX_HOPS,
  FRONTIER_CAP,
  MAX_HOPS_CAP,
  MAX_QUERIES_PER_BATCH,
  QUERY_ROW_LIMIT,
  WALL_CLOCK_BUDGET_MS,
} from '../src/investigation/scam-corridor-trace.js'
import { MAX_CANDIDATES } from '../src/investigation/exchange-likeness.js'
import {
  ATTRIBUTION_MAX_FRONTIER,
  ATTRIBUTION_MAX_HOPS,
  resolveAttributionConfig,
} from '../src/detection/detectors/attack-attribution.js'
import { resolveFakeTokenConfig } from '../src/detection/detectors/fake-token.js'
import { resolvePoisoningConfig } from '../src/detection/detectors/address-poisoning.js'
import { truncateGraph } from '../src/viz/graph-model.js'

// The exact values that were compiled into the code before any of this was
// tunable. Written out as literals ON PURPOSE: if someone edits a `builtin` in
// the registry, this table is what fails, and the failure says "you changed
// what every existing caller gets" rather than passing quietly.
const HISTORICAL_DEFAULTS: Record<LimitKey, number> = {
  trace_max_hops: 3,
  trace_per_address_limit: 5,
  deposit_sources_max_hops: 2,
  deposit_sources_row_limit: 500,
  corridor_max_hops: 3,
  corridor_frontier_cap: 50,
  corridor_query_row_limit: 200,
  exchange_likeness_max_candidates: 25,
  attribution_max_hops: 3,
  attribution_max_frontier: 500,
  attribution_max_rows: 1000,
  poisoning_max_rows: 1000,
  fake_token_max_rows: 1000,
  fake_token_max_asset_pages: 50,
  viz_max_nodes: 100,
}

describe('no behaviour change: unconfigured values match the previously hardcoded constants', () => {
  it('pins every built-in default to its historical value', () => {
    for (const key of LIMIT_KEYS) {
      expect(LIMIT_SPECS[key].builtin, `${key} built-in default moved`).toBe(HISTORICAL_DEFAULTS[key])
    }
  })

  it('covers every registered knob in the historical table', () => {
    expect(Object.keys(HISTORICAL_DEFAULTS).sort()).toEqual([...LIMIT_KEYS].sort())
  })

  it('resolves to the built-in when nothing overrides it', () => {
    for (const key of LIMIT_KEYS) {
      expect(resolveLimit(key, undefined, { network: 'bittensor' })).toBe(HISTORICAL_DEFAULTS[key])
      expect(resolveLimit(key, null, {})).toBe(HISTORICAL_DEFAULTS[key])
    }
  })

  it('ships an EMPTY per-network default table, so no chain silently diverges today', () => {
    expect(NETWORK_LIMIT_DEFAULTS).toEqual({})
  })

  it('keeps the re-exported module constants at their old values', () => {
    expect(MAX_HOPS_CAP).toBe(4)
    expect(FRONTIER_CAP).toBe(50)
    expect(MAX_QUERIES_PER_BATCH).toBe(20)
    expect(QUERY_ROW_LIMIT).toBe(200)
    expect(WALL_CLOCK_BUDGET_MS).toBe(120_000)
    expect(DEFAULT_MAX_HOPS).toBe(3)
    expect(MAX_CANDIDATES).toBe(25)
    expect(ATTRIBUTION_MAX_HOPS).toBe(3)
    expect(ATTRIBUTION_MAX_FRONTIER).toBe(500)
  })

  it('generates byte-identical reverse-deposit query text with no override', () => {
    const withoutOverride = reverseDepositSourceQueryAtDepth(['5Deposit'], 2, 0, undefined)
    const withExplicitDefault = reverseDepositSourceQueryAtDepth(['5Deposit'], 2, 0, undefined, 500)
    expect(withoutOverride.query).toBe(withExplicitDefault.query)
    expect(withoutOverride.query).toContain('ORDER BY path_value_usd DESC LIMIT 500')
    expect(withoutOverride.query).not.toContain('LIMIT 5000')
  })

  it('resolves every detector config to its historical values with empty params', () => {
    expect(resolveAttributionConfig('bittensor', {})).toMatchObject({ maxHops: 3, maxFrontier: 500, maxRows: 1000 })
    expect(resolveFakeTokenConfig('bittensor', {})).toEqual({ maxPages: 50, pageSize: 1000 })
    expect(resolvePoisoningConfig('bittensor', {})).toMatchObject({ maxRows: 1000 })
  })

  it('truncates the graph view at 100 nodes when no cap is passed', () => {
    const nodes = Array.from({ length: 150 }, (_, i) => ({
      id: `a${i}`, label: `a${i}`, entityType: 'eoa' as const, totalIn: i, totalOut: 0, txCount: 1,
    }))
    const data = { nodes, edges: [], metadata: { title: 'T', generatedAt: 'now', truncated: false } }
    const truncated = truncateGraph(data as Parameters<typeof truncateGraph>[0])
    expect(truncated.nodes).toHaveLength(100)
    expect(truncated.metadata.hiddenNodes).toBe(50)
  })
})

describe('precedence: per-call > config networkLimits > config limits > per-network default > built-in', () => {
  const config = {
    limits: { deposit_sources_row_limit: 700 },
    networkLimits: { bittensor: { deposit_sources_row_limit: 900 } },
  }

  it('uses the built-in with no config and no call value', () => {
    expect(resolveLimit('deposit_sources_row_limit', null, { network: 'bittensor' })).toBe(500)
  })

  it('lets the global config layer beat the built-in', () => {
    expect(resolveLimit('deposit_sources_row_limit', null, { network: 'other', config })).toBe(700)
  })

  it('lets the per-network config layer beat the global config layer', () => {
    expect(resolveLimit('deposit_sources_row_limit', null, { network: 'bittensor', config })).toBe(900)
  })

  it('lets the per-call value beat every config layer', () => {
    expect(resolveLimit('deposit_sources_row_limit', 1234, { network: 'bittensor', config })).toBe(1234)
  })

  it('reports the fallback separately from the used value', () => {
    const detail = resolveLimitDetail('deposit_sources_row_limit', 1234, { network: 'bittensor', config })
    expect(detail).toEqual({ key: 'deposit_sources_row_limit', requested: 1234, used: 1234, fallback: 900, ceiling: 20_000 })
  })
})

describe('ceilings are hard and rejection is loud', () => {
  it('throws a typed error naming the knob and its ceiling', () => {
    expect(() => resolveLimit('deposit_sources_max_hops', 9, { network: 'bittensor' }))
      .toThrow(LimitRangeError)
    expect(() => resolveLimit('deposit_sources_max_hops', 9, { network: 'bittensor' }))
      .toThrow(/deposit_sources_max_hops must be an integer between 1 and 5 \(got 9 from the call\)/)
  })

  it('accepts exactly the ceiling', () => {
    for (const key of LIMIT_KEYS) {
      expect(resolveLimit(key, LIMIT_SPECS[key].ceiling, {})).toBe(LIMIT_SPECS[key].ceiling)
    }
  })

  it('rejects below the floor and rejects non-integers', () => {
    expect(() => resolveLimit('deposit_sources_row_limit', 0, {})).toThrow(LimitRangeError)
    expect(() => resolveLimit('deposit_sources_row_limit', -1, {})).toThrow(LimitRangeError)
    expect(() => resolveLimit('deposit_sources_row_limit', 2.5, {})).toThrow(LimitRangeError)
    expect(() => resolveLimit('deposit_sources_row_limit', Number.NaN, {})).toThrow(LimitRangeError)
    expect(() => resolveLimit('deposit_sources_row_limit', Number.POSITIVE_INFINITY, {})).toThrow(LimitRangeError)
  })

  it('bounds hop knobs far more tightly than row/frontier knobs, because hop cost is exponential', () => {
    // Hops: an absolute ceiling of 5, and at most 3 hops of headroom over the
    // shipped default. Five hops is already ~2 orders of magnitude more paths
    // than three on a real deposit.
    for (const key of ['trace_max_hops', 'deposit_sources_max_hops', 'corridor_max_hops', 'attribution_max_hops'] as const) {
      expect(LIMIT_SPECS[key].ceiling, `${key} ceiling`).toBeLessThanOrEqual(5)
      expect(LIMIT_SPECS[key].ceiling - LIMIT_SPECS[key].builtin, `${key} headroom`).toBeLessThanOrEqual(3)
    }
    // Rows: cost is close to linear, so the headroom is generous. The
    // measured case needed 10x the old 500-row cap to reach the origin.
    expect(LIMIT_SPECS.deposit_sources_row_limit.ceiling).toBeGreaterThanOrEqual(5_000)
  })

  it('lets a per-network entry LOWER a ceiling but never RAISE it', () => {
    const key: LimitKey = 'deposit_sources_row_limit'
    const builtinCeiling = LIMIT_SPECS[key].ceiling
    try {
      NETWORK_LIMIT_DEFAULTS.tiny = { ceilings: { [key]: 100 } }
      NETWORK_LIMIT_DEFAULTS.greedy = { ceilings: { [key]: builtinCeiling * 10 } }
      expect(limitCeiling(key, 'tiny')).toBe(100)
      expect(limitCeiling(key, 'greedy')).toBe(builtinCeiling)
      // 500 is the built-in default but above the lowered ceiling, so the
      // default clamps down for that chain rather than throwing.
      expect(limitDefault(key, { network: 'tiny' })).toBe(100)
      expect(() => resolveLimit(key, 200, { network: 'tiny' }))
        .toThrow(/between 1 and 100/)
    } finally {
      delete NETWORK_LIMIT_DEFAULTS.tiny
      delete NETWORK_LIMIT_DEFAULTS.greedy
    }
  })

  it('rejects an out-of-range detector --param instead of accepting it', () => {
    // Before this change `numParam` accepted any non-negative number, so
    // `--param max_hops=40` was a live way to hang the graph from a config file.
    expect(() => resolveAttributionConfig('bittensor', { max_hops: '40' })).toThrow(LimitRangeError)
    expect(() => limitFromParams('attribution_max_rows', { max_rows: 'nonsense' }, 'max_rows')).toThrow(LimitRangeError)
    expect(limitFromParams('attribution_max_rows', { max_rows: '2000' }, 'max_rows')).toBe(2000)
    expect(limitFromParams('attribution_max_rows', {}, 'max_rows')).toBe(1000)
  })
})

describe('no hand-interpolated values reach Cypher', () => {
  it('refuses to render a non-integer or negative limit literal', () => {
    expect(() => limitLiteral(1.5)).toThrow(/non-negative integer/)
    expect(() => limitLiteral(-1)).toThrow(/non-negative integer/)
    expect(() => limitLiteral(Number.NaN)).toThrow(/non-negative integer/)
    expect(limitLiteral(500)).toBe('500')
  })

  it('cannot smuggle a Cypher fragment through a row limit', () => {
    // The value is typed `number`, and every path to a LIMIT goes through
    // resolveLimit (range-checked) then limitLiteral (re-proved). A string
    // payload dies at the literal boundary rather than reaching the backend.
    expect(() => limitLiteral('500 UNION MATCH (n) RETURN n' as unknown as number)).toThrow()
  })
})

describe('config file layer', () => {
  it('accepts a valid limits block', () => {
    const parsed = parseInvestigatorConfig({ limits: { deposit_sources_row_limit: 5000 } })
    expect(parsed.limits).toEqual({ deposit_sources_row_limit: 5000 })
  })

  it('rejects an unknown limit key rather than ignoring it', () => {
    // A silently ignored knob is indistinguishable from one that had no effect.
    expect(() => parseInvestigatorConfig({ limits: { not_a_real_knob: 10 } }))
      .toThrow(/limits.not_a_real_knob: unknown limit key/)
  })

  it('rejects an over-ceiling config value at load time, not mid-investigation', () => {
    expect(() => parseInvestigatorConfig({ limits: { deposit_sources_row_limit: 999_999 } }))
      .toThrow(/limits.deposit_sources_row_limit: must be an integer between 1 and 20000/)
    expect(() => parseInvestigatorConfig({ networkLimits: { bittensor: { corridor_max_hops: 9 } } }))
      .toThrow(/networkLimits.bittensor.corridor_max_hops: must be an integer between 1 and 4/)
  })

  it('leaves both blocks absent by default, so an untouched config is unchanged', () => {
    const parsed = parseInvestigatorConfig({})
    expect(parsed.limits).toBeUndefined()
    expect(parsed.networkLimits).toBeUndefined()
  })
})

describe('MCP argument allowlist: a declared argument must never be silently stripped', () => {
  it('every argument on every public tool schema is also in PUBLIC_MCP_TOOL_ALLOWED_ARGS', async () => {
    // This is the generic guard for the `time_scope` failure mode:
    // normalizeRemoteToolArguments filters pass-through arguments to the
    // allowlist, so a schema argument missing from it is dropped with no
    // error and the caller silently gets the default-bounded result.
    const { knownPublicToolInputSchema } = await import('../src/mcp/proxy.js')
    for (const [toolName, allowed] of Object.entries(PUBLIC_MCP_TOOL_ALLOWED_ARGS)) {
      const shape = knownPublicToolInputSchema(toolName)
      expect(shape, `${toolName} has no declared input schema`).toBeTruthy()
      for (const argName of Object.keys(shape as object)) {
        expect(allowed, `${toolName}.${argName} is declared on the schema but missing from PUBLIC_MCP_TOOL_ALLOWED_ARGS — it would be silently stripped`).toContain(argName)
      }
    }
  })

  it('explicitly allows the new tuning knobs', () => {
    expect(PUBLIC_MCP_TOOL_ALLOWED_ARGS.aml_trace_deposit_sources).toContain('row_limit')
    expect(PUBLIC_MCP_TOOL_ALLOWED_ARGS.aml_trace_victim_funds).toContain('per_address_limit')
    expect(PUBLIC_MCP_TOOL_ALLOWED_ARGS.aml_trace_suspect_funds).toContain('per_address_limit')
  })

  it('coerces the new knobs to numbers from `cia mcp call key=value`', async () => {
    // The tool schemas are z.number(); a string "5000" would be rejected as a
    // type error, so the CLI parser must know these keys are numeric.
    const { parseMcpCallArgs } = await import('../src/mcp/call-args.js')
    expect(parseMcpCallArgs(['row_limit=5000', 'per_address_limit=10', 'max_hops=4']))
      .toEqual({ row_limit: 5000, per_address_limit: 10, max_hops: 4 })
  })

  it('advertises each knob schema straight from the registry, so docs cannot drift', async () => {
    const { knownPublicToolInputSchema } = await import('../src/mcp/proxy.js')
    const shape = knownPublicToolInputSchema('aml_trace_deposit_sources') as Record<string, { description?: string }>
    expect(shape.row_limit?.description).toContain(`Default ${LIMIT_SPECS.deposit_sources_row_limit.builtin}`)
    expect(shape.row_limit?.description).toContain(`max ${LIMIT_SPECS.deposit_sources_row_limit.ceiling}`)
    expect(shape.max_hops?.description).toContain(`max ${LIMIT_SPECS.deposit_sources_max_hops.ceiling}`)
  })
})

describe('observability', () => {
  it('reports requested vs used vs ceiling, and omits requested when the caller passed nothing', () => {
    const explicit = resolveLimitDetail('deposit_sources_max_hops', 4, { network: 'bittensor' })
    const implicit = resolveLimitDetail('deposit_sources_row_limit', null, { network: 'bittensor' })
    expect(limitsReport([explicit, implicit])).toEqual({
      deposit_sources_max_hops: { requested: 4, used: 4, default: 2, ceiling: 5 },
      deposit_sources_row_limit: { used: 500, default: 500, ceiling: 20_000 },
    })
  })
})
