#!/usr/bin/env node
// Generates tests/fixtures/graph-query-corpus.json: every graph query the
// cia AML builders can emit, in PRODUCTION SHAPE — i.e. wrapped with the
// exact `USE <scope>` prefix the runtime batch wrapper applies. The
// data-pipeline validator test (internal/graphmcp corpus test) runs
// ValidateReadOnlyGraphQuery over every entry; the USE prefix matters
// because the validator's StarRocks cost-shape gates key on `USE facts`.
//
// Deterministic by construction: fixed parameter grid, sorted output.
// Runs under tsx (imports the TypeScript sources directly — dist/ is a
// hashed bundle without stable per-module paths). Regenerate with
// `npm run corpus:generate`; tests/query-corpus.test.ts fails CI when
// builders drift from the committed corpus.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const { queryBuilderContract } = await import(join(repoRoot, 'src/investigation/public-tools.ts'))
const { traceQueryBuilderContract } = await import(join(repoRoot, 'src/investigation/trace-funds.ts'))

const SCOPES = ['topology']
// Escaping-sensitive values are part of the grid on purpose.
const ADDR = 'corpus-address-a'
const ADDR_QUOTED = 'corpus"quote'
const COMPARE = 'corpus-address-b'
const DEPOSITS = ['corpus-dep-1', 'corpus-dep-2', 'corpus-dep-3']
// TraceActivityWindow shape ({ fromMs, toMs }) — a wrong key here produces
// `>= undefined` predicates; tests/query-corpus.test.ts pins their absence.
const WINDOW = { fromMs: 1704067200000, toMs: 1735689600000 }

const entries = []
const add = (builder, params, scope, item) => {
  if (!item) return
  for (const q of Array.isArray(item) ? item : [item]) {
    entries.push({
      builder,
      params,
      scope,
      query: queryBuilderContract.topologyGraphQuery(q.query),
    })
  }
}
// facts queries hardcode USE facts inline; store them verbatim.
const addFacts = (builder, params, item) => {
  entries.push({ builder, params, scope: 'facts', query: item.query })
}

for (const scope of SCOPES) {
  for (const address of [ADDR, ADDR_QUOTED]) {
    add('addressProfileQuery', { address }, scope, queryBuilderContract.addressProfileQuery(address))
    add('exchangeOutflowQueries', { address }, scope, queryBuilderContract.exchangeOutflowQueries(address))
    add('exchangeInflowQueries', { address }, scope, queryBuilderContract.exchangeInflowQueries(address))
  }
  add('compareAddressExistsQuery', { address: ADDR }, scope, queryBuilderContract.compareAddressExistsQuery(ADDR))
  add('connectionProbeQuery', { address: ADDR, compare: COMPARE }, scope, queryBuilderContract.connectionProbeQuery(ADDR, COMPARE))

  for (const minAmountSum of [0, 10]) {
    for (const window of [undefined, WINDOW]) {
      add(
        'forwardExchangeQueries',
        { address: ADDR, limit: 25, minAmountSum, maxHops: 5, window: Boolean(window) },
        scope,
        traceQueryBuilderContract.forwardExchangeQueries(ADDR, 25, minAmountSum, 5, window),
      )
      for (let depth = 1; depth <= 5; depth += 1) {
        add(
          'reverseDepositSourceQueryAtDepth',
          { deposits: DEPOSITS.length, depth, minAmountSum, window: Boolean(window) },
          scope,
          queryBuilderContract.reverseDepositSourceQueryAtDepth(DEPOSITS, depth, minAmountSum, window),
        )
      }
    }
  }
  add('backwardSourceQueries', { deposit: ADDR, maxHops: 5 }, scope, traceQueryBuilderContract.backwardSourceQueries('backward_from_deposit_0', ADDR, 5))
  add('reverseLeadsQuery', { deposits: DEPOSITS.length }, scope, traceQueryBuilderContract.reverseLeadsQuery(DEPOSITS))
  add(
    'directEdgePropsQuery',
    { pairs: 2 },
    scope,
    traceQueryBuilderContract.directEdgePropsQuery([
      { src: ADDR, dst: COMPARE },
      { src: COMPARE, dst: ADDR_QUOTED },
    ]),
  )
}

// Route evidence: native *BFS traversal on the unified topology graph.
add('connectionRouteQueries', { address: ADDR, compare: COMPARE }, 'topology', queryBuilderContract.connectionRouteQueries(ADDR, COMPARE))
add('connectionRouteQueries', { address: ADDR_QUOTED, compare: COMPARE }, 'topology', queryBuilderContract.connectionRouteQueries(ADDR_QUOTED, COMPARE))

// LINKED ownership overlay: served on the topology graph (also on facts).
add('linkedExposureQueries', { address: ADDR }, 'topology', queryBuilderContract.linkedExposureQueries(ADDR))
add('crossSpaceLinkedQuery', { address: ADDR }, 'topology', queryBuilderContract.crossSpaceLinkedQuery(ADDR))

// facts layer (USE facts hardcoded inside the builders)
addFacts('addressFeatureQuery', { address: ADDR }, queryBuilderContract.addressFeatureQuery(ADDR))
addFacts('addressLabelRiskQuery', { address: ADDR_QUOTED }, queryBuilderContract.addressLabelRiskQuery(ADDR_QUOTED))

// Documented-recipe demand curve (corpus v2, MemGQL retirement wave): the
// full set of query shapes the docs + skills advertise, harvested and
// runtime-verified. These extend the translator's required grammar beyond
// what the builders emit today (native topology traversal, neuron/asset
// facts lookups). Real fixture values so facts recipes also drive the
// T0b baselines and translator conformance. See tests/fixtures/documented-recipes.json.
const documentedRecipes = JSON.parse(
  readFileSync(join(repoRoot, 'tests/fixtures/documented-recipes.json'), 'utf8'),
)
for (const recipe of documentedRecipes.recipes) {
  // This corpus is the production ADMISSION contract: the data-pipeline
  // graphmcp test asserts ValidateReadOnlyGraphQuery admits every entry, so a
  // query production deliberately refuses must not appear here. Recipes tagged
  // `admits: false` (StarRocks-backed global aggregates without an indexed
  // predicate — refused by the cost-shape gate) document a surface boundary,
  // just outside this admission corpus.
  if (recipe.admits === false) {
    continue
  }
  entries.push({
    builder: 'documented-recipe',
    params: { id: recipe.id, features: recipe.features },
    scope: recipe.layer,
    query: recipe.query,
  })
}

entries.sort((a, b) =>
  a.builder.localeCompare(b.builder) ||
  a.scope.localeCompare(b.scope) ||
  JSON.stringify(a.params).localeCompare(JSON.stringify(b.params)) ||
  a.query.localeCompare(b.query),
)

const corpus = {
  generated_by: 'scripts/generate-query-corpus.mjs',
  entry_count: entries.length,
  entries,
}
const outPath = process.env['CORPUS_OUT'] ?? join(repoRoot, 'tests/fixtures/graph-query-corpus.json')
writeFileSync(outPath, JSON.stringify(corpus, null, 1) + '\n')
console.log(`wrote ${outPath} (${entries.length} entries)`)
