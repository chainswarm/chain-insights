#!/usr/bin/env node
// Generates tests/fixtures/graph-query-corpus.json: every graph query the
// cia AML builders can emit, in PRODUCTION SHAPE — i.e. wrapped with the
// exact `USE <scope>` prefix the runtime batch wrapper applies. The
// the upstream pipeline's internal corpus test runs
// ValidateReadOnlyGraphQuery over every entry; the USE prefix matters
// because the validator's StarRocks cost-shape gates key on `USE facts`.
//
// It also generates tests/fixtures/topology-shape-cases.json, the topology
// rule table: the queries the graph server must admit (every USE topology
// query of this corpus, of the documented recipes and of the fenced examples
// of the two skills) and the queries it must refuse, each with the code and
// the rule word it must carry. tests/topology-shape-cases.test.ts keeps it
// equal to a fresh run and keeps the skills inside the admit list.
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

const SCOPES = ['topology']
// Recipe entries (openspec dozerdb-flows-to-slim-schema): the facts-lane pair
// anchor and the inline average replace the dropped edge fields.
// Escaping-sensitive values are part of the grid on purpose.
const ADDR = 'corpus-address-a'
const ADDR_QUOTED = 'corpus"quote'
const COMPARE = 'corpus-address-b'
const ANCHOR_DAY = '2026-07-11'
const DEPOSITS = ['corpus-dep-1', 'corpus-dep-2', 'corpus-dep-3']
// TraceActivityWindow shape ({ fromTimestamp, toTimestamp }) — a wrong key
// here produces `>= undefined` predicates; tests/query-corpus.test.ts pins
// their absence.
const WINDOW = { fromTimestamp: 1704067200000, toTimestamp: 1735689600000 }

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
// Some builders hardcode their USE prefix inline; store those verbatim. The
// scope is the graph the text names, so an entry never carries a scope that
// its own text contradicts.
const scopeOfQuery = (query) => /^USE\s+(\w+)/.exec(query)?.[1]
const addVerbatim = (builder, params, item) => {
  entries.push({ builder, params, scope: scopeOfQuery(item.query), query: item.query })
}

for (const scope of SCOPES) {
  for (const address of [ADDR, ADDR_QUOTED]) {
    add(
      'addressProfileQuery',
      { address },
      scope,
      queryBuilderContract.addressProfileQuery(address)
    )
    add(
      'exchangeOutflowQueries',
      { address },
      scope,
      queryBuilderContract.exchangeOutflowQueries(address)
    )
    add(
      'exchangeInflowQueries',
      { address },
      scope,
      queryBuilderContract.exchangeInflowQueries(address)
    )
  }
  add(
    'compareAddressExistsQuery',
    { address: ADDR },
    scope,
    queryBuilderContract.compareAddressExistsQuery(ADDR)
  )
  add(
    'connectionProbeQuery',
    { address: ADDR, compare: COMPARE },
    scope,
    queryBuilderContract.connectionProbeQuery(ADDR, COMPARE)
  )
}

// Route evidence: bounded ISO GQL shortest paths on the one topology graph.
add(
  'connectionRouteQueries',
  { address: ADDR, compare: COMPARE },
  'topology',
  queryBuilderContract.connectionRouteQueries(ADDR, COMPARE)
)
add(
  'connectionRouteQueries',
  { address: ADDR_QUOTED, compare: COMPARE },
  'topology',
  queryBuilderContract.connectionRouteQueries(ADDR_QUOTED, COMPARE)
)

// LINKED ownership overlay: served on the topology graph (also on facts).
add(
  'linkedExposureQueries',
  { address: ADDR },
  'topology',
  queryBuilderContract.linkedExposureQueries(ADDR)
)
add(
  'crossSpaceLinkedQuery',
  { address: ADDR },
  'topology',
  queryBuilderContract.crossSpaceLinkedQuery(ADDR)
)

// USE prefix hardcoded inside the builder (addressFeatureQuery reads the node
// properties on the topology graph)
addVerbatim(
  'addressFeatureQuery',
  { address: ADDR },
  queryBuilderContract.addressFeatureQuery(ADDR)
)

// Documented-recipe demand curve (corpus v2, MemGQL retirement wave): the
// full set of query shapes the docs + skills advertise, harvested and
// runtime-verified. These extend the translator's required grammar beyond
// what the builders emit today (native topology traversal, neuron/asset
// facts lookups). Real fixture values so facts recipes also drive the
// T0b baselines and translator conformance. See tests/fixtures/documented-recipes.json.
const documentedRecipes = JSON.parse(
  readFileSync(join(repoRoot, 'tests/fixtures/documented-recipes.json'), 'utf8')
)
for (const recipe of documentedRecipes.recipes) {
  // This corpus is the production ADMISSION contract: the the upstream pipeline
  // the internal corpus test asserts ValidateReadOnlyGraphQuery admits every entry, so a
  // query production deliberately refuses must not appear here. Recipes tagged
  // `admits: false` (a facts read with no address pair and no transaction hash,
  // or with one address, refused by the facts read contract) document a surface
  // boundary, just outside this admission corpus. Each names the code it must
  // get in `expects_code`.
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

// Facts-lane anchor recipe: a transfer of a pair on one day. A facts read
// names an address pair with one day, or one transaction hash, and takes no
// ORDER BY, so the pair anchor takes the day and reads it.
addVerbatim(
  'pairAnchorQuery',
  { from: ADDR, to: COMPARE, day: ANCHOR_DAY },
  {
    query: queryBuilderContract.pairAnchorQuery(ADDR, COMPARE, ANCHOR_DAY),
  }
)
add(
  'inlineAverageFlowQuery',
  { address: ADDR, limit: 25 },
  'topology',
  queryBuilderContract.inlineAverageFlowQuery(ADDR, 25)
)

entries.sort(
  (a, b) =>
    a.builder.localeCompare(b.builder) ||
    a.scope.localeCompare(b.scope) ||
    JSON.stringify(a.params).localeCompare(JSON.stringify(b.params)) ||
    a.query.localeCompare(b.query)
)

const corpus = {
  generated_by: 'scripts/generate-query-corpus.mjs',
  entry_count: entries.length,
  entries,
}
const outPath =
  process.env['CORPUS_OUT'] ?? join(repoRoot, 'tests/fixtures/graph-query-corpus.json')
writeFileSync(outPath, JSON.stringify(corpus, null, 1) + '\n')
console.log(`wrote ${outPath} (${entries.length} entries)`)

// ---------------------------------------------------------------------------
// The topology rule table: tests/fixtures/topology-shape-cases.json.
//
// Each case holds id, expect (admit or refuse), rule, code, query and source.
// An admit case is a query the graph server must admit. A refuse case is a
// query it must refuse with exactly its code and rule word. The graph server
// runs every case through its gate in both directions.
// ---------------------------------------------------------------------------
const RULES_VERSION = '1'

const SKILLS = [
  'skills/chain-insights-cypher/SKILL.md',
  'skills/chain-insights-schema-evm/SKILL.md',
]
// A $name placeholder of a skill example reads as one fixed literal.
const SKILL_PLACEHOLDER = '"corpus-address-a"'

const squash = (text) => text.replace(/\s+/g, ' ').trim()

// Every fenced block of a skill that starts with USE topology, as one line.
function fencedTopologyQueries(markdown) {
  return [...markdown.matchAll(/^```[\w-]*\n([\s\S]*?)^```/gm)]
    .map((block) => squash(block[1]))
    .filter((body) => body.startsWith('USE topology'))
    .map((body) => body.replace(/\$\w+/g, SKILL_PLACEHOLDER))
}

const admitCase = (id, query, source) => ({
  id,
  expect: 'admit',
  rule: null,
  code: null,
  query,
  source,
})
const refuseCase = (id, code, rule, query, source = 'refuse-table') => ({
  id,
  expect: 'refuse',
  rule,
  code,
  query,
  source,
})

// Admit: every USE topology entry of the corpus (the builders and the
// documented recipes), then every fenced example of the two skills.
const admitCases = []
const builderCount = new Map()
for (const entry of entries) {
  if (entry.scope !== 'topology') continue
  if (entry.builder === 'documented-recipe') {
    admitCases.push(
      admitCase(entry.params.id.replaceAll('_', '-'), entry.query, `recipe:${entry.params.id}`)
    )
    continue
  }
  const n = (builderCount.get(entry.builder) ?? 0) + 1
  builderCount.set(entry.builder, n)
  admitCases.push(
    admitCase(`builder-${entry.builder}-${n}`, entry.query, `builder:${entry.builder}`)
  )
}
for (const recipe of documentedRecipes.recipes) {
  if (recipe.layer === 'topology' && recipe.admits === false) {
    throw new Error(
      `${recipe.id}: a topology query that must be refused is a case of the refuse table`
    )
  }
}
for (const skill of SKILLS) {
  const name = skill.split('/')[1].replace(/^chain-insights-/, '')
  fencedTopologyQueries(readFileSync(join(repoRoot, skill), 'utf8')).forEach((query, i) => {
    admitCases.push(admitCase(`skill-${name}-${i + 1}`, query, skill))
  })
}

// Refuse: a fixed table, at least one query for each code the shape rules can
// give. The code and the rule word are the ones of the topology safety spec.
const A1 = '0x1111111111111111111111111111111111111111'
const A2 = '0x2222222222222222222222222222222222222222'
const USE = 'USE topology '
const pin = (name, address = A1) => `(${name}:Address {address: "${address}"})`
// The guarded walk of the documented route recipes: 0 to 4 guarded hops.
const WALK = '(()-[:FLOWS_TO|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,4}'
const route = (selector) =>
  `${USE}MATCH p = ${selector} (a:Address {address: "${A1}"} WHERE NOT a:Pool) ${WALK} ` +
  `()-[:FLOWS_TO|SWAPPED]-(b:Address {address: "${A2}"}) RETURN p LIMIT 5`
const literals = (n) =>
  Array.from({ length: n }, (_, i) => `"0x${(i + 1).toString(16).padStart(40, '0')}"`)

// A text of exactly 8,193 bytes: the padding sits inside the query, so no trim
// can shorten it.
const oversizeHead = `${USE}MATCH ${pin('a')} RETURN `
const oversizeTail = 'a.address AS address LIMIT 1'
const oversize =
  oversizeHead + ' '.repeat(8193 - oversizeHead.length - oversizeTail.length) + oversizeTail
if (Buffer.byteLength(oversize) !== 8193) throw new Error('the oversize case must be 8193 bytes')

// The four recipes that task 2.2 removed. Their old texts are refused, and
// this table is their only place.
const REMOVED_RECIPES = [
  {
    id: 'recipe_topology_06',
    code: 'aggregate_unanchored',
    rule: 'aggregate',
    query:
      'USE topology MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address) RETURN src.address AS from_address, dst.address AS to_address, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count, flow.last_seen_timestamp AS last_seen_timestamp ORDER BY flow.amount_usd_sum DESC LIMIT 25',
  },
  {
    id: 'recipe_topology_07',
    code: 'aggregate_unanchored',
    rule: 'aggregate',
    query:
      'USE topology MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address) WITH src, count(dst) AS out_degree, sum(flow.amount_usd_sum) AS total_usd RETURN src.address AS address, out_degree, total_usd ORDER BY out_degree DESC LIMIT 25',
  },
  {
    id: 'recipe_topology_09',
    code: 'anchor_missing',
    rule: 'anchor',
    query:
      'USE topology MATCH (m:Address) WHERE m.address STARTS WITH "5Ggf" RETURN m.address AS address, m.network AS member_network LIMIT 10',
  },
  {
    id: 'recipe_topology_18',
    code: 'route_search_refused',
    rule: 'route',
    query:
      'USE topology MATCH p = ALL SHORTEST (a:Address {address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"} WHERE NOT a:Pool) (()-[:FLOWS_TO|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,4} ()-[:FLOWS_TO|SWAPPED]-(b:Address {address: "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty"}) RETURN p LIMIT 3',
  },
]

const refuseCases = [
  ...REMOVED_RECIPES.map((r) =>
    refuseCase(
      `removed-${r.id.replaceAll('_', '-')}`,
      r.code,
      r.rule,
      r.query,
      `removed-recipe:${r.id}`
    )
  ),
  // anchor_missing: a connected pattern holds no anchor.
  refuseCase(
    'swapped-filter-no-anchor',
    'anchor_missing',
    'anchor',
    `${USE}MATCH (a:Address)-[x:SWAPPED]->(b:Address) WHERE x.strength = 'swap' RETURN a.address LIMIT 5`
  ),
  refuseCase(
    'link-sample-with-where',
    'anchor_missing',
    'anchor',
    `${USE}MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address) WHERE flow.amount_usd_sum > 1000 RETURN src.address AS from_address, dst.address AS to_address LIMIT 10`
  ),
  refuseCase(
    'probe-over-100-rows',
    'anchor_missing',
    'anchor',
    `${USE}MATCH (a:Address) RETURN a.address AS address LIMIT 101`
  ),
  refuseCase(
    'decoy-address-in-return',
    'anchor_missing',
    'anchor',
    `${USE}MATCH (a:Address)-[x:SWAPPED]->(b:Address) WHERE x.strength = 'swap' RETURN "${A1}" AS marker, a.address LIMIT 5`
  ),
  refuseCase(
    'equality-inside-or',
    'anchor_missing',
    'anchor',
    `${USE}MATCH (a:Address)-[x:SWAPPED]->(b:Address) WHERE a.address = "${A1}" OR x.strength = 'swap' RETURN a.address LIMIT 5`
  ),
  refuseCase(
    'list-of-26-literals',
    'anchor_missing',
    'anchor',
    `${USE}MATCH (a:Address)-[:FLOWS_TO]->(b:Address) WHERE a.address IN [${literals(26).join(', ')}] RETURN b.address LIMIT 10`
  ),
  refuseCase(
    'parameter-is-no-anchor',
    'anchor_missing',
    'anchor',
    `${USE}MATCH (a:Address {address: $addr})-[:FLOWS_TO]->(b:Address) RETURN b.address LIMIT 10`
  ),
  refuseCase(
    'label-search',
    'anchor_missing',
    'anchor',
    `${USE}MATCH (a:Address) WHERE "exchange" IN a.labels RETURN a.address LIMIT 10`
  ),
  // aggregate_unanchored: no anchor, and a sort, an aggregate, DISTINCT or collect.
  refuseCase(
    'distinct-over-every-link',
    'aggregate_unanchored',
    'aggregate',
    `${USE}MATCH (a:Address)-[:FLOWS_TO]->(b:Address) RETURN DISTINCT b.address AS address LIMIT 25`
  ),
  // cartesian_product: patterns that share no variable, one without an anchor.
  refuseCase(
    'anchored-pattern-beside-an-open-one',
    'cartesian_product',
    'connected',
    `${USE}MATCH ${pin('a')}, (b:Address) RETURN a.address, b.address LIMIT 5`
  ),
  // hop_budget: unbounded or over-long paths.
  refuseCase(
    'quantifier-over-the-cap',
    'hop_budget',
    'hops',
    `${USE}MATCH ${pin('a')}-[:FLOWS_TO]-{1,9}(b:Address) RETURN b.address LIMIT 10`
  ),
  refuseCase(
    'unbounded-postfix-quantifier',
    'hop_budget',
    'hops',
    `${USE}MATCH ${pin('a')}-[:FLOWS_TO]-+(b:Address) RETURN b.address LIMIT 10`
  ),
  refuseCase(
    'bare-undirected-quantifier',
    'hop_budget',
    'hops',
    `${USE}MATCH ${pin('a')}--+(b:Address) RETURN b.address LIMIT 10`
  ),
  refuseCase(
    'three-chained-quantifiers',
    'hop_budget',
    'hops',
    `${USE}MATCH ${pin('a')}-[:FLOWS_TO]-{1,5}(b:Address)-[:FLOWS_TO]-{1,5}(c:Address)-[:FLOWS_TO]-{1,5}(d:Address) RETURN d.address LIMIT 10`
  ),
  refuseCase(
    'seven-fixed-hops',
    'hop_budget',
    'hops',
    `${USE}MATCH ${pin('a')}` +
      Array.from({ length: 7 }, (_, i) => `-[:FLOWS_TO]->(n${i + 1}:Address)`).join('') +
      ' RETURN n7.address LIMIT 10'
  ),
  // limit_missing: no literal LIMIT, or one above 5,000.
  refuseCase(
    'no-limit',
    'limit_missing',
    'limit',
    `${USE}MATCH ${pin('a')}-[:FLOWS_TO]->(b:Address) RETURN b.address`
  ),
  refuseCase(
    'limit-over-5000',
    'limit_missing',
    'limit',
    `${USE}MATCH ${pin('a')}-[:FLOWS_TO]->(b:Address) RETURN b.address LIMIT 5001`
  ),
  // query_too_large: the text, or the nesting of its brackets.
  refuseCase('text-over-8-kib', 'query_too_large', 'size', oversize),
  refuseCase(
    'nesting-over-64',
    'query_too_large',
    'nesting',
    `${USE}MATCH ${pin('a')} RETURN ${'['.repeat(65)}1${']'.repeat(65)} AS deep LIMIT 1`
  ),
  // route_search_refused: more than one path, or a repeated part over 4.
  refuseCase('shortest-2', 'route_search_refused', 'route', route('SHORTEST 2')),
  refuseCase('shortest-3-groups', 'route_search_refused', 'route', route('SHORTEST 3 GROUPS')),
  refuseCase(
    'repeated-part-over-4',
    'route_search_refused',
    'route',
    `${USE}MATCH p = SHORTEST 1 ${pin('a')}-[:FLOWS_TO]-{0,5}${pin('b', A2)} RETURN p LIMIT 5`
  ),
  // unsupported_expression_shape: work that no anchor bounds.
  refuseCase(
    'reduce-outside-unwind',
    'unsupported_expression_shape',
    'expression',
    `${USE}MATCH ${pin('a')} RETURN reduce(s = 0, x IN range(1, 100000) | s + x) AS total LIMIT 1`
  ),
  refuseCase(
    'unwind-product-over-1000',
    'unsupported_expression_shape',
    'expression',
    `${USE}UNWIND range(1, 1000) AS i UNWIND range(1, 1000) AS j MATCH ${pin('a')} RETURN a.address AS address, i, j LIMIT 10`
  ),
  refuseCase(
    'three-optional-match',
    'unsupported_expression_shape',
    'expression',
    `${USE}MATCH ${pin('a')} OPTIONAL MATCH (a)-[:FLOWS_TO]->(b:Address) OPTIONAL MATCH (a)<-[:FLOWS_TO]-(c:Address) OPTIONAL MATCH (a)-[:SWAPPED]->(d:Address) RETURN a.address AS address, b.address AS paid, c.address AS payer, d.address AS swapped LIMIT 10`
  ),
  refuseCase(
    'five-union-branches',
    'unsupported_expression_shape',
    'expression',
    USE +
      literals(5)
        .map(
          (address) => `MATCH (a:Address {address: ${address}}) RETURN a.address AS address LIMIT 1`
        )
        .join(' UNION ')
  ),
  // unsupported_topology_dialect: PROFILE runs the query it measures, and the
  // legacy shortest-path functions are not GQL.
  refuseCase(
    'profile',
    'unsupported_topology_dialect',
    'dialect',
    `${USE}PROFILE MATCH ${pin('a')} RETURN a.address LIMIT 1`
  ),
  refuseCase(
    'legacy-shortest-path-function',
    'unsupported_topology_dialect',
    'dialect',
    `${USE}MATCH p = shortestPath(${pin('a')}-[:FLOWS_TO*1..5]-${pin('b', A2)}) RETURN p LIMIT 1`
  ),
]

const topologyCases = { rules_version: RULES_VERSION, cases: [...admitCases, ...refuseCases] }
// A run that redirects the corpus (the regeneration tests do) puts the cases
// file beside it, so it never rewrites the committed cases.
const casesOutPath =
  process.env['TOPOLOGY_CASES_OUT'] ??
  join(
    process.env['CORPUS_OUT'] ? dirname(outPath) : join(repoRoot, 'tests/fixtures'),
    'topology-shape-cases.json'
  )
writeFileSync(casesOutPath, JSON.stringify(topologyCases, null, 1) + '\n')
console.log(`wrote ${casesOutPath} (${topologyCases.cases.length} cases)`)
