import { describe, expect, it } from 'vitest'
import { queryBuilderContract } from '../src/investigation/public-tools.js'
import { traceQueryBuilderContract } from '../src/investigation/trace-funds.js'

// Trace stability pin: trace tools are result-equivalent
// in this wave — NO trace builder changes ship. These snapshots pin the
// exact emitted query text of every fan-out builder at every depth and
// scope; accidental drift (including a well-meaning "optimization" that
// changes semantics) fails CI. Update these snapshots only under an
// approved spec that explicitly changes trace query shapes.

const SCOPES = ['topology'] as const

describe('trace fan-out builders emit pinned query text', () => {
  for (const scope of SCOPES) {
    it(`forwardExchangeQueries depths 1..5 (${scope})`, () => {
      const queries = traceQueryBuilderContract.forwardExchangeQueries(
        'seed-identity',
        25,
        10,
        5,
        undefined,
      )
      expect(queries.map((q) => `${q.id}: ${q.query}`)).toMatchSnapshot()
    })

    it(`backwardSourceQueries depths 1..5 (${scope})`, () => {
      const queries = traceQueryBuilderContract.backwardSourceQueries(
        'backward_from_deposit_0',
        'deposit-identity',
        5,
      )
      expect(queries.map((q) => `${q.id}: ${q.query}`)).toMatchSnapshot()
    })

    it(`exchangeOutflowQueries fixed 3 (${scope})`, () => {
      const queries = queryBuilderContract.exchangeOutflowQueries('target-identity')
      expect(queries.map((q) => `${q.id}: ${q.query}`)).toMatchSnapshot()
    })

    it(`exchangeInflowQueries fixed 3 (${scope})`, () => {
      const queries = queryBuilderContract.exchangeInflowQueries('target-identity')
      expect(queries.map((q) => `${q.id}: ${q.query}`)).toMatchSnapshot()
    })

    it(`reverseDepositSourceQueryAtDepth depths 1..5 (${scope})`, () => {
      const queries = Array.from({ length: 5 }, (_, index) =>
        queryBuilderContract.reverseDepositSourceQueryAtDepth(
          ['deposit-a', 'deposit-b'],
          index + 1,
          10,
          undefined,
        ),
      )
      expect(queries.map((q) => `${q.id}: ${q.query}`)).toMatchSnapshot()
    })
  }

  it('no fan-out builder ever emits quantifier-inner WHERE or SHORTEST k', () => {
    const all = [
      ...traceQueryBuilderContract.forwardExchangeQueries('s', 25, 10, 5, undefined),
      ...traceQueryBuilderContract.backwardSourceQueries('b_0', 'd', 5),
      ...queryBuilderContract.exchangeOutflowQueries('t'),
      ...queryBuilderContract.exchangeInflowQueries('t'),
    ]
    for (const { query } of all) {
      // Hazard pins: memgraph/memgraph#4343 (inner WHERE silently ignored),
      // #4344 (SHORTEST k broken). Fan-outs must stay explicit-hop.
      expect(query).not.toMatch(/\{\d+,\d*\}/)
      expect(query).not.toMatch(/SHORTEST\s+\d/)
    }
  })
})
