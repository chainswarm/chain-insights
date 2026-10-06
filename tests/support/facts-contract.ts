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
// tests/fixtures/facts-contract.json pins the server's own list of refused
// reads, and tests/facts-limits-pin.test.ts holds this model to every one of
// them: a disagreement is fixed here, never in the fixture.
//
// factsReadViolations(query) answers the way the server does. It asks the
// questions of the server in the order of the server: is there a relationship,
// are there too many, are both ends addresses, is the pair two different
// addresses with a variable each, is the arrow directed, what anchors the read,
// which day does it cover, and does it ask for an order. The first question that
// fails gives the one code. An empty list means the read names a pair with one
// day, or a transaction hash.

export const FACTS_CODES = [
  'facts_no_anchor',
  'facts_pair_required',
  'facts_day_required',
  'facts_window_too_wide',
  'facts_hops_refused',
  'facts_order_not_served',
] as const

export type FactsCode = (typeof FACTS_CODES)[number]

// The most days one facts read covers. The graph server publishes it in the
// pinned contract, and tests/facts-limits-pin.test.ts reads the same number from
// tests/fixtures/facts-contract.json and fails when the two differ.
const WINDOW_DAYS = 1

// A relationship that only the facts layer serves. SWAPPED, ADDED_LIQUIDITY
// and REMOVED_LIQUIDITY are topology links and do not match.
const FACTS_RELATIONSHIP =
  /\[[^\]]*:\s*`?(?:TRANSFER|SWAP|LIQUIDITY_ADD|LIQUIDITY_REMOVE|BRIDGE_CROSSING)`?(?![\w])/

const VALUE = String.raw`(?:"[^"]*"|'[^']*'|\$\w+)`
const DAY_FORMAT = /^\d{4}-\d{2}-\d{2}$/

export function isFactsRead(query: string): boolean {
  if (/^\s*USE\s+topology\b/i.test(query)) return false
  return FACTS_RELATIONSHIP.test(query) && /\bRETURN\b/i.test(query)
}

// A boolean expression, split at its top-level OR and AND. BETWEEN is two bounds.
type Bool = { kind: 'and' | 'or'; parts: Bool[]; text: string } | { kind: 'leaf'; text: string }

function splitTop(text: string, word: 'AND' | 'OR'): string[] {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let start = 0
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at] ?? ''
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '(' || char === '[' || char === '{') depth += 1
    else if (char === ')' || char === ']' || char === '}') depth -= 1
    else if (depth === 0 && /\s/.test(char)) {
      const here = new RegExp(String.raw`^\s+${word}\s+`, 'i').exec(text.slice(at))
      if (here) {
        parts.push(text.slice(start, at))
        start = at + here[0].length
        at = start - 1
      }
    }
  }
  parts.push(text.slice(start))
  return parts
}

function stripOuterParentheses(text: string): string {
  let current = text.trim()
  while (current.startsWith('(') && current.endsWith(')')) {
    let depth = 0
    let closesAtEnd = true
    for (let at = 0; at < current.length; at += 1) {
      if (current[at] === '(') depth += 1
      if (current[at] === ')') depth -= 1
      if (depth === 0 && at < current.length - 1) {
        closesAtEnd = false
        break
      }
    }
    if (!closesAtEnd) break
    current = current.slice(1, -1).trim()
  }
  return current
}

function parseBool(text: string): Bool {
  const body = stripOuterParentheses(text)
  const orParts = splitTop(body, 'OR')
  if (orParts.length > 1) return { kind: 'or', parts: orParts.map(parseBool), text: body }
  const andParts = splitTop(body, 'AND')
  if (andParts.length > 1) return { kind: 'and', parts: andParts.map(parseBool), text: body }
  return { kind: 'leaf', text: body }
}

function flattenAnd(node: Bool): Bool[] {
  return node.kind === 'and' ? node.parts.flatMap(flattenAnd) : [node]
}

function dayOf(value: string): number | 'placeholder' | null {
  // A parameter, or the template day a skill or a hint writes for a date.
  if (/^\$\w+$/.test(value) || /^(?:"YYYY-MM-DD"|'YYYY-MM-DD')$/.test(value)) return 'placeholder'
  const literal = /^(?:"([^"]*)"|'([^']*)')$/.exec(value)
  const day = literal?.[1] ?? literal?.[2]
  if (day === undefined || !DAY_FORMAT.test(day)) return null
  const time = Date.parse(`${day}T00:00:00Z`)
  return Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== day
    ? null
    : time / 86_400_000
}

type DateTerm = { op: string; value: string }

// The day a read covers, from its plain AND bounds on block_date. An equality
// names a day. A bound from below and a bound from above name a range, from the
// latest lower bound to the earliest upper bound. <> and != name nothing. One
// side alone names no day, and a value that is no date names none. A range of
// more days than the contract allows is too wide, and so is a list of days.
function windowCode(terms: DateTerm[], listValues: string[] | null): FactsCode | null {
  let from: number | null = null
  let to: number | null = null
  let notADate = false
  let placeholder = false
  for (const term of terms) {
    if (term.op === '<>' || term.op === '!=') continue
    const day = dayOf(term.value)
    if (day === null) {
      notADate = true
      continue
    }
    if (day === 'placeholder') {
      if (term.op === '=') placeholder = true
      else notADate = true
      continue
    }
    const lower = term.op === '=' || term.op === '>=' ? day : term.op === '>' ? day + 1 : null
    const upper = term.op === '=' || term.op === '<=' ? day : term.op === '<' ? day - 1 : null
    if (lower !== null && (from === null || lower > from)) from = lower
    if (upper !== null && (to === null || upper < to)) to = upper
  }
  const named = placeholder || (from !== null && to !== null)
  let listed = 0
  if (listValues && !named) {
    const days = new Set<number | 'placeholder'>()
    for (const value of listValues) {
      const day = dayOf(value)
      if (day === null) notADate = true
      else days.add(day)
    }
    listed = days.size
  }
  if (notADate) return 'facts_day_required'
  if (!named && listed > WINDOW_DAYS) return 'facts_window_too_wide'
  if (!named) return 'facts_day_required'
  if (placeholder) return null
  const days = (to as number) - (from as number) + 1
  if (days <= 0) return 'facts_day_required'
  return days > WINDOW_DAYS ? 'facts_window_too_wide' : null
}

type PatternNode = { variable: string; labels: string[]; address: string | null; hasMap: boolean }

function readNode(inside: string): PatternNode {
  const found = /^\s*(\w+)?\s*((?::\s*`?\w+`?\s*)*)(?:\{([^}]*)\})?\s*$/.exec(inside)
  const map = found?.[3] ?? ''
  const address = new RegExp(String.raw`\baddress\s*:\s*(${VALUE})`).exec(map)?.[1] ?? null
  // A node may carry a second label, as in `a:Address:Account`.
  const labels = [...(found?.[2] ?? '').matchAll(/:\s*`?(\w+)`?/g)].map((label) => label[1] ?? '')
  return {
    variable: found?.[1] ?? '',
    labels,
    address,
    hasMap: map.trim() !== '',
  }
}

export function factsReadViolations(query: string): FactsCode[] {
  const text = query.replace(/^\s*USE\s+facts\b/i, '').trim()
  const matchAt = text.search(/\bMATCH\b/i)
  const body = matchAt < 0 ? text : text.slice(matchAt + 'MATCH'.length)
  const patternEnd = body.search(/\b(?:WHERE|RETURN|WITH)\b/i)
  const pattern = patternEnd < 0 ? body : body.slice(0, patternEnd)
  const rest = patternEnd < 0 ? '' : body.slice(patternEnd)
  const whereAt = /^\s*WHERE\b/i.exec(rest)
  const afterWhere = whereAt ? rest.slice(whereAt[0].length) : ''
  const whereEnd = afterWhere.search(/\b(?:RETURN|WITH)\b/i)
  const where = (whereEnd < 0 ? afterWhere : afterWhere.slice(0, whereEnd)).replace(
    /(\b\w+\.\w+)\s+BETWEEN\s+(\S+)\s+AND\s+(\S+)/gi,
    '$1 >= $2 AND $1 <= $3'
  )

  // Is there a relationship, and are there too many?
  const edges = [...pattern.matchAll(/(<)?-\s*\[([^\]]*)\]\s*-(>)?/g)]
  if (edges.length === 0) return ['facts_no_anchor']
  const edge = edges[0]
  if (edges.length > 1 || (edge?.[2] ?? '').includes('*')) return ['facts_hops_refused']
  const edgeVariable = /^\s*(\w+)?/.exec(edge?.[2] ?? '')?.[1] ?? ''
  const directed = (edge?.[1] === '<') !== (edge?.[3] === '>')

  // The two ends of the arrow.
  const nodes = [...pattern.matchAll(/\(([^()]*)\)/g)].map((match) => readNode(match[1] ?? ''))
  const ends = [nodes[0], nodes[nodes.length - 1]].map(
    (node) => node ?? { variable: '', labels: [], address: null, hasMap: false }
  )
  // Both ends are Address nodes. Any other label (a kind such as Account or Contract, beside
  // Address or alone), or a label in another case, anchors nothing.
  if (ends.some((end) => end.labels.some((label) => label !== 'Address'))) {
    return ['facts_no_anchor']
  }
  // One variable names one part of the pattern, and an end with an address map needs a variable.
  const [left, right] = ends as [PatternNode, PatternNode]
  if (left.variable !== '' && left.variable === right.variable) return ['facts_pair_required']
  if (edgeVariable !== '' && (edgeVariable === left.variable || edgeVariable === right.variable)) {
    return ['facts_pair_required']
  }
  if (ends.some((end) => end.variable === '' && end.hasMap)) return ['facts_pair_required']
  if (!directed) return ['facts_pair_required']

  // What the conditions say. A condition inside an OR is no anchor and no bound.
  const address: [string | null, string | null] = [left.address, right.address]
  let transaction = false
  let inOr = false
  let dateInOr = false
  let anyDate = false
  let listValues: string[] | null = null
  const terms: DateTerm[] = []
  const nodeVariables = ends.map((end) => end.variable).filter((name) => name !== '')
  for (const conjunct of where.trim() === '' ? [] : flattenAnd(parseBool(where))) {
    const textOf = conjunct.text
    if (conjunct.kind === 'or') {
      if (
        nodeVariables.some((name) => new RegExp(String.raw`\b${name}\.address\b`).test(textOf)) ||
        (edgeVariable !== '' && new RegExp(String.raw`\b${edgeVariable}\.tx_id\b`).test(textOf))
      ) {
        inOr = true
      }
      if (
        edgeVariable !== '' &&
        new RegExp(String.raw`\b${edgeVariable}\.block_date\b`).test(textOf)
      ) {
        dateInOr = true
      }
      continue
    }
    const equality = new RegExp(String.raw`^(\w+)\.address\s*=\s*(${VALUE})$`).exec(textOf)
    if (equality) {
      for (const [index, end] of ends.entries()) {
        if (end.variable !== '' && end.variable === equality[1] && address[index] === null) {
          address[index] = equality[2] ?? ''
        }
      }
      continue
    }
    if (edgeVariable === '') continue
    const hash = new RegExp(String.raw`^(\w+)\.tx_id\s*=\s*(${VALUE})$`).exec(textOf)
    if (hash?.[1] === edgeVariable) transaction = true
    const bound = new RegExp(
      String.raw`^(\w+)\.block_date\s*(=|>=|<=|<>|!=|>|<)\s*(${VALUE})$`
    ).exec(textOf)
    if (bound?.[1] === edgeVariable) {
      terms.push({ op: bound[2] ?? '', value: bound[3] ?? '' })
      anyDate = true
    }
    const list = /^(\w+)\.block_date\s+IN\s*\[([^\]]*)\]$/i.exec(textOf)
    if (list?.[1] === edgeVariable) {
      const values = (list[2] ?? '').split(',').map((value) => value.trim())
      if (values.length === 1) terms.push({ op: '=', value: values[0] ?? '' })
      else listValues = [...(listValues ?? []), ...values]
    }
    const nullCheck = /^(\w+)\.block_date\s+IS\s+(?:NOT\s+)?NULL$/i.exec(textOf)
    if (nullCheck?.[1] === edgeVariable) anyDate = true
  }
  const mentionsDate = anyDate || listValues !== null || dateInOr
  const hasPair = address[0] !== null && address[1] !== null

  let refusal: FactsCode | null
  if (transaction) {
    refusal = mentionsDate ? windowCode(terms, listValues) : null
  } else if (hasPair) {
    refusal = windowCode(terms, listValues)
  } else if (inOr) {
    refusal = 'facts_no_anchor'
  } else if ((address[0] === null) !== (address[1] === null)) {
    refusal = 'facts_pair_required'
  } else if (anyDate) {
    refusal = 'facts_pair_required'
  } else {
    refusal = 'facts_no_anchor'
  }
  if (refusal) return [refusal]
  return /\bORDER\s+BY\b/i.test(text) ? ['facts_order_not_served'] : []
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
