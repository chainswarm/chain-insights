import { readdirSync } from 'node:fs'

import { markdownQueries, proseQueries } from './pool-walk-guard.js'
import { markdownFiles, read, runtimeSkill, servedGraphHints } from './schema-text.js'

// Test support for the limits of a `USE facts` read, as the graph server
// states them: an address pair (from and to, in the arrow's direction) with
// one day, or one transaction hash. One relationship, no ORDER BY.
//
// This is a reader's model of those limits, built to check the text and the
// queries this package ships. The graph server is the authority: it refuses a
// read with the codes below, and a refused recipe names the code it must get.
//
// factsReadViolations(query) returns the codes that apply to a query. An empty
// list means the read names a pair with one day, or a transaction hash. A
// code is listed once. A query with no anchor at all and no day is
// `facts_no_anchor` only: with no anchor, the day is moot.

export const FACTS_CODES = [
  'facts_no_anchor',
  'facts_pair_required',
  'facts_day_required',
  'facts_window_too_wide',
  'facts_hops_refused',
  'facts_order_not_served',
] as const

export type FactsCode = (typeof FACTS_CODES)[number]

// A relationship that only the facts layer serves. SWAPPED, ADDED_LIQUIDITY
// and REMOVED_LIQUIDITY are topology links and do not match.
const FACTS_RELATIONSHIP =
  /\[[^\]]*:\s*`?(?:TRANSFER|SWAP|LIQUIDITY_ADD|LIQUIDITY_REMOVE|BRIDGE_CROSSING)`?(?![\w])/

const VALUE = String.raw`(?:"[^"]*"|'[^']*'|\$\w+)`

export function isFactsRead(query: string): boolean {
  if (/^\s*USE\s+topology\b/i.test(query)) return false
  return FACTS_RELATIONSHIP.test(query) && /\bRETURN\b/i.test(query)
}

export function factsReadViolations(query: string): FactsCode[] {
  const text = query.replace(/^\s*USE\s+facts\b/i, '').trim()
  const matchAt = text.search(/\bMATCH\b/i)
  const body = matchAt < 0 ? text : text.slice(matchAt + 'MATCH'.length)
  const patternEnd = body.search(/\b(?:WHERE|RETURN|WITH)\b/i)
  const pattern = patternEnd < 0 ? body : body.slice(0, patternEnd)
  const rest = patternEnd < 0 ? '' : body.slice(patternEnd)
  const whereAt = rest.search(/\bWHERE\b/i)
  const afterWhere = whereAt < 0 ? '' : rest.slice(whereAt + 'WHERE'.length)
  const whereEnd = afterWhere.search(/\b(?:RETURN|ORDER\s+BY|WITH)\b/i)
  const where = whereEnd < 0 ? afterWhere : afterWhere.slice(0, whereEnd)

  const codes = new Set<FactsCode>()

  const relationships = pattern.match(/\[[^\]]*\]/g) ?? []
  if (relationships.length > 1) codes.add('facts_hops_refused')
  if (/\bORDER\s+BY\b/i.test(text)) codes.add('facts_order_not_served')
  const directed = /-\[[^\]]*\]->|<-\[[^\]]*\]-/.test(pattern)

  // The nodes of the pattern, in order. An endpoint is anchored by an inline
  // address map or by an address equality in the WHERE.
  const nodes = [...pattern.matchAll(/\(([^()]*)\)/g)].map((match) => {
    const inside = match[1] ?? ''
    return {
      name: /^\s*(\w+)/.exec(inside)?.[1] ?? '',
      anchored: new RegExp(String.raw`\baddress\s*:\s*${VALUE}`).test(inside),
    }
  })

  // The AND-conjuncts of the WHERE. A condition with an OR holds nothing on
  // its own, so an anchor or a day inside it does not count.
  const conjuncts = /\bOR\b/i.test(where) ? [] : where.split(/\s+AND\s+/i).map((c) => c.trim())
  let transaction = false
  let oneDay = false
  let dayRange = false
  for (const conjunct of conjuncts) {
    const address = new RegExp(String.raw`^(\w+)\.address\s*=\s*${VALUE}$`).exec(conjunct)
    if (address) {
      const node = nodes.find((candidate) => candidate.name === address[1])
      if (node) node.anchored = true
    }
    if (new RegExp(String.raw`^\w+\.tx_id\s*=\s*${VALUE}$`).test(conjunct)) transaction = true
    if (new RegExp(String.raw`^\w+\.block_date\s*=\s*${VALUE}$`).test(conjunct)) oneDay = true
    else if (/^\w+\.block_date\s*(?:>=|>|<=|<|<>)/.test(conjunct)) dayRange = true
  }

  if (transaction) return [...codes]

  const endpoints = [nodes[0], nodes[nodes.length - 1]].filter(
    (node, index, list) => node !== undefined && (index === 0 || node !== list[0])
  )
  const anchored = endpoints.filter((node) => node?.anchored).length
  const hasDay = oneDay || dayRange

  if (anchored === 0) {
    codes.add(hasDay ? 'facts_pair_required' : 'facts_no_anchor')
  } else if (anchored === 1 || !directed) {
    codes.add('facts_pair_required')
  } else if (!oneDay) {
    codes.add(dayRange ? 'facts_window_too_wide' : 'facts_day_required')
  }
  return [...codes]
}

type Recipe = { id: string; query: string; layer: string; admits?: boolean; expects_code?: string }

export type SurfaceRead = { surface: string; query: string }

// Every complete facts read that a reader or an agent is shown: the admitted
// recipes, the corpus, the served graph hints, the notes workspace init writes
// and the Markdown of the README, the skills and the docs. A recipe marked
// `admits: false` documents a refusal and is not a read to copy.
export async function shippedFactsReads(): Promise<SurfaceRead[]> {
  const surfaces: { surface: string; queries: string[] }[] = []
  const recipes = (
    JSON.parse(read('tests/fixtures/documented-recipes.json')) as {
      recipes: Recipe[]
    }
  ).recipes
  surfaces.push({
    surface: 'tests/fixtures/documented-recipes.json',
    queries: recipes.filter((recipe) => recipe.admits !== false).map((recipe) => recipe.query),
  })
  surfaces.push({
    surface: 'tests/fixtures/graph-query-corpus.json',
    queries: (
      JSON.parse(read('tests/fixtures/graph-query-corpus.json')) as {
        entries: { query: string }[]
      }
    ).entries.map((entry) => entry.query),
  })
  surfaces.push({
    surface: 'src/mcp/proxy.ts graph hints',
    queries: proseQueries(servedGraphHints()),
  })
  surfaces.push({
    surface: 'workspace runtime notes',
    queries: markdownQueries(await runtimeSkill()),
  })
  const markdown = [
    'README.md',
    ...readdirSync('skills').map((skill) => `skills/${skill}/SKILL.md`),
    ...markdownFiles('docs'),
  ]
  for (const path of markdown) {
    surfaces.push({ surface: path, queries: markdownQueries(read(path)) })
  }
  return surfaces.flatMap(({ surface, queries }) =>
    queries.filter(isFactsRead).map((query) => ({ surface, query }))
  )
}
