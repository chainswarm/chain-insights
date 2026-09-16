import { describe, expect, it } from 'vitest'
import { riskAssessment, runAmlAddressRisk } from '../src/investigation/public-tools.js'

// The 2026-09-03 defect this suite guards: the address_profile query asked for
// `a.label_risk`, which graphsync had replaced with three parallel arrays,
// while the reader expected those arrays. Tests that hand-built the profile row
// never saw it. Here every profile row is built FROM the query the tool sends,
// so a query that stops returning a field the verdict reads fails these tests.

const ATTACKER = '0x5f10deebe95d80d4925a9d02a997215883bd5970'
const SMART_ACCOUNT = '0x00070b4683d6b3b498c340062a747e0970227fe5'

/** Aliases a query returns, in order: `RETURN a.risk_score AS live_risk_score` -> `live_risk_score`. */
function returnedAliases(query: string): string[] {
  return [...query.matchAll(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1] as string)
}

/** The row the graph would return for `query`: only fields the query asks for. */
function rowFromQuery(query: string, values: Record<string, unknown>): Record<string, unknown> {
  const aliases = returnedAliases(query)
  for (const key of Object.keys(values)) {
    if (!aliases.includes(key)) {
      throw new Error(`the query does not return "${key}"; it returns ${aliases.join(', ')}`)
    }
  }
  return Object.fromEntries(aliases.map((alias) => [alias, values[alias] ?? null]))
}

type GraphOptions = {
  feature?: Record<string, unknown>
  exchangeRows?: Array<Record<string, unknown>>
  failures?: Record<string, string>
}

/** A graph that answers the batch the tool sends, and records every query. */
function fakeGraph(profile: Record<string, unknown>, options: GraphOptions = {}) {
  const sent: Array<{ id: string; query: string }> = []
  const client = {
    async callTool(request: {
      name: string
      arguments: { queries: Array<{ id: string; query: string }> }
    }) {
      const queries = request.arguments.queries
      sent.push(...queries)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              schema: 'chain-insights.result.v1',
              tool: 'graph_query_batch',
              facts: {
                queries: queries.map((query) => {
                  const failure = options.failures?.[query.id]
                  if (failure) return { id: query.id, ok: false, error: failure }
                  if (query.id === 'address_profile') {
                    return { id: query.id, ok: true, results: [rowFromQuery(query.query, profile)] }
                  }
                  if (query.id === 'address_feature') {
                    return {
                      id: query.id,
                      ok: true,
                      results: [options.feature ?? { degree_in: 13, degree_out: 1 }],
                    }
                  }
                  if (query.id === 'exchange_outflows_1') {
                    return { id: query.id, ok: true, results: options.exchangeRows ?? [] }
                  }
                  return { id: query.id, ok: true, results: [] }
                }),
              },
            }),
          },
        ],
        isError: false,
      }
    },
  }
  return { client, sent }
}

async function screen(
  address: string,
  profile: Record<string, unknown>,
  options: GraphOptions = {}
): Promise<{
  risk: Record<string, unknown>
  summary: string
  sent: Array<{ id: string; query: string }>
}> {
  const { client, sent } = fakeGraph(profile, options)
  const result = await runAmlAddressRisk(client as never, { address, network: 'robinhood' })
  const facts = result.structuredContent['facts'] as Record<string, unknown>
  return { risk: facts['risk'] as Record<string, unknown>, summary: result.summaryText, sent }
}

describe('address profile read', () => {
  it('returns every field the verdict reads, and no retired label property', async () => {
    const { sent } = await screen(ATTACKER, {})
    const profileQuery = sent.find((query) => query.id === 'address_profile')?.query ?? ''
    const aliases = returnedAliases(profileQuery)
    for (const field of [
      'address',
      'network',
      'display_labels',
      'system_labels',
      'is_exchange',
      'live_risk_score',
      'live_risk_level',
      'label_risk_labels',
      'label_risk_levels',
      'label_risk_updated_timestamps',
    ]) {
      expect(aliases).toContain(field)
    }
    expect(profileQuery).not.toContain('a.label_risk AS')
  })

  it('carries a stored context label into the verdict', async () => {
    const { risk } = await screen(SMART_ACCOUNT, {
      label_risk_labels: ['smart_account'],
      label_risk_levels: ['low'],
      label_risk_updated_timestamps: [1789265561000],
    })
    expect((risk['signals'] as Record<string, unknown>)['labels']).toBe('context_only')
    expect(String(risk['drivers'])).toContain('smart_account')
  })

  it('carries a stored critical label into the verdict', async () => {
    const { risk } = await screen(SMART_ACCOUNT, {
      label_risk_labels: ['poisoning_attacker'],
      label_risk_levels: ['critical'],
      label_risk_updated_timestamps: [1789265561000],
    })
    expect(risk['level']).toBe('critical')
    expect(risk['score']).toBeNull()
    expect((risk['signals'] as Record<string, unknown>)['labels']).toBe('risk')
  })
})

describe('a usable model band sets the level as published', () => {
  it('keeps a HIGH band with a low calibrated score', async () => {
    const { risk, summary } = await screen(ATTACKER, {
      live_risk_score: 0.3,
      live_risk_level: 'HIGH',
    })
    expect(risk['level']).toBe('high')
    expect(risk['score']).toBe(0.3)
    expect(risk['confidence']).toBe('high')
    expect(risk['recommendation']).toBe('Escalate for manual review.')
    expect(summary).toContain('Risk: high (0.30)')
  })

  it('does not promote a HIGH band to critical on a high score', async () => {
    const { risk } = await screen(ATTACKER, { live_risk_score: 0.92, live_risk_level: 'HIGH' })
    expect(risk['level']).toBe('high')
  })

  it('lets a more severe label win', async () => {
    const { risk } = await screen(ATTACKER, {
      live_risk_score: 0.45,
      live_risk_level: 'MEDIUM',
      label_risk_labels: ['scam'],
      label_risk_levels: ['high'],
      label_risk_updated_timestamps: [1789265561000],
    })
    expect(risk['level']).toBe('high')
  })

  it('lets a more severe band win and says so', async () => {
    const { risk } = await screen(ATTACKER, {
      live_risk_score: 0.31,
      live_risk_level: 'HIGH',
      label_risk_labels: ['watchlist'],
      label_risk_levels: ['medium'],
      label_risk_updated_timestamps: [1789265561000],
    })
    expect(risk['level']).toBe('high')
    expect(String(risk['drivers'])).toContain('ml_label_divergence')
  })
})

describe('labels at risk level low are context only', () => {
  it('does not let a role label clear an address', async () => {
    const { risk } = await screen(SMART_ACCOUNT, {
      label_risk_labels: ['smart_account'],
      label_risk_levels: ['low'],
      label_risk_updated_timestamps: [1789265561000],
    })
    expect(risk['level']).toBe('unscored')
    expect(risk['confidence']).toBe('low')
  })

  it('reports low with high confidence when the model scored the address low', async () => {
    const { risk } = await screen(SMART_ACCOUNT, {
      live_risk_score: 0.05,
      live_risk_level: 'LOW',
      label_risk_labels: ['bundler'],
      label_risk_levels: ['low'],
      label_risk_updated_timestamps: [1789265561000],
    })
    expect(risk['level']).toBe('low')
    expect(risk['confidence']).toBe('high')
  })

  it('takes the risk label next to a role label', async () => {
    const { risk } = await screen(SMART_ACCOUNT, {
      label_risk_labels: ['smart_account', 'scam'],
      label_risk_levels: ['low', 'high'],
      label_risk_updated_timestamps: [1789265561000, 1789265562000],
    })
    expect(risk['level']).toBe('high')
    expect(risk['score']).toBeNull()
    expect((risk['signals'] as Record<string, unknown>)['labels']).toBe('risk')
  })
})

describe('no risk signal reports unscored', () => {
  it('answers unscored for the detected poisoning attacker', async () => {
    const { risk, summary } = await screen(
      ATTACKER,
      {},
      { feature: { degree_in: 2, degree_out: 1 } }
    )
    expect(risk['level']).toBe('unscored')
    expect(risk['score']).toBeNull()
    expect(risk['confidence']).toBe('low')
    expect(String(risk['recommendation'])).toContain('not a clean result')
    expect(summary).toContain('Risk: unscored (no score)')
    expect(summary).not.toContain('continue with normal monitoring')
  })

  it('answers unscored when the model abstained', async () => {
    const { risk } = await screen(ATTACKER, { live_risk_score: 0.83, live_risk_level: 'UNSCORED' })
    expect(risk['level']).toBe('unscored')
    expect(risk['score']).toBeNull()
    expect(risk['ml_risk_score']).toBe(0.83)
    expect((risk['signals'] as Record<string, unknown>)['ml_verdict']).toBe('abstained')
    expect(String(risk['drivers'])).toContain('ml_abstained')
  })

  it('answers unscored when an exchange search timed out', async () => {
    const { risk } = await screen(
      ATTACKER,
      {},
      { failures: { exchange_inflows_3: 'query_timeout: the topology query did not finish' } }
    )
    expect(risk['level']).toBe('unscored')
    expect((risk['signals'] as Record<string, unknown>)['exchange_exposure']).toBe('incomplete')
  })

  it('answers unscored for a caller that pins contract version v1', async () => {
    const { client } = fakeGraph({})
    const result = await runAmlAddressRisk(
      client as never,
      { address: ATTACKER, network: 'robinhood' },
      'v1'
    )
    const facts = result.structuredContent['facts'] as Record<string, unknown>
    expect((facts['risk'] as Record<string, unknown>)['level']).toBe('unscored')
  })
})

describe('found exchange exposure keeps its fallback level', () => {
  it('reports medium for moderate exposure', async () => {
    const { risk } = await screen(
      ATTACKER,
      {},
      {
        exchangeRows: [
          {
            direction: 'outflow',
            exchange_address: '0xexchange',
            amount_usd_sum: 50_000,
            tx_count: 2,
            hops: 1,
          },
        ],
      }
    )
    expect(risk['level']).toBe('medium')
    expect(risk['score']).toBeCloseTo(0.49, 2)
    expect(risk['confidence']).toBe('medium')
    expect((risk['signals'] as Record<string, unknown>)['exchange_exposure']).toBe('found')
  })

  it('reports low for small exposure', async () => {
    const { risk } = await screen(
      ATTACKER,
      {},
      {
        exchangeRows: [
          {
            direction: 'outflow',
            exchange_address: '0xexchange',
            amount_usd_sum: 100,
            tx_count: 2,
            hops: 1,
          },
        ],
      }
    )
    expect(risk['level']).toBe('low')
    expect(risk['score']).toBeCloseTo(0.27, 2)
    expect(risk['confidence']).toBe('medium')
  })
})

describe('the result states which signals were present', () => {
  it('reports an unavailable exchange search', () => {
    const assessment = riskAssessment({}, [], [], 'unavailable')
    expect(assessment['level']).toBe('unscored')
    expect((assessment['signals'] as Record<string, unknown>)['exchange_exposure']).toBe(
      'unavailable'
    )
  })

  it('treats an unrecognized band as absent and keeps its score visible', () => {
    const assessment = riskAssessment({ live_risk_score: 0.7, live_risk_level: 'SEVERE' }, [], [])
    expect(assessment['level']).toBe('unscored')
    expect(assessment['score']).toBeNull()
    expect(assessment['ml_risk_score']).toBe(0.7)
    expect((assessment['signals'] as Record<string, unknown>)['ml_verdict']).toBe('absent')
  })

  it('reports none_found when every search ran and found nothing', () => {
    const assessment = riskAssessment({}, [], [], 'complete')
    expect((assessment['signals'] as Record<string, unknown>)['exchange_exposure']).toBe(
      'none_found'
    )
  })
})
