// Test support for the pool trace rule (skills/chain-insights-schema-evm,
// "Pool trace rule"): a served FLOWS_TO walk may end at a :Pool, but never
// starts at one or passes through one, and a trace follows SWAPPED beside
// FLOWS_TO.
//
// unguardedPoolWalks(query) returns one line per address a FLOWS_TO walk may
// leave without the pool guard: its start and every address in its middle.
// A FLOWS_TO walk is every walk with a relationship that may be FLOWS_TO, and
// it may leave an address on any relationship: a pool left on LINKED is a
// pool passed through. Only REMOVED_LIQUIDITY may leave a pool (step 2 of the
// rule), so an address the walk leaves on REMOVED_LIQUIDITY alone needs no
// guard. traceHopsWithoutSwapped(query) returns one line per address in the
// middle whose FLOWS_TO hop does not also follow SWAPPED. Both read the whole
// query, one UNION branch at a time:
//   - every MATCH and OPTIONAL MATCH clause, and every comma-separated
//     pattern in it, joined by their shared variables, so a walk split across
//     clauses, across WITH ... MATCH or across a comma is one walk;
//   - WITH projections: a variable WITH drops is a new address when it is
//     matched again, and `WITH m AS mid` keeps the address under a new name;
//   - named, labelled, unlabelled and anonymous node patterns;
//   - relationships in either direction, typed or untyped, with a type union;
//   - backquoted names: -[:`FLOWS_TO`]- is FLOWS_TO and `Pool` is Pool;
//   - quantified relationships (-[:FLOWS_TO]-{1,5}, +, *, legacy *1..5);
//   - quantified path patterns ((x)-[:FLOWS_TO]-(y) WHERE ...){0,4}, whose
//     nodes merge with the node patterns written next to them, and whose
//     variables are new addresses on every repetition;
//   - SHORTEST, ANY SHORTEST and ALL SHORTEST selectors;
//   - the legacy shortestPath() and allShortestPaths() functions;
//   - pattern predicates, such as WHERE (a)-[:FLOWS_TO]->()-[:FLOWS_TO]->(b)
//     or exists((a)-->(b)), and pattern comprehensions,
//     [(a)-[:FLOWS_TO]->(m) WHERE ... | m.address], wherever they are written:
//     each is a walk joined to the query's variables, and a comprehension's
//     own variables and WHERE are its own;
//   - EXISTS, COUNT, COLLECT and CALL subqueries, each read as its own query.
//
// The guard counts only as a whole AND-conjunct: `NOT mid:Pool` in a WHERE,
// `none(n IN nodes(p) WHERE n:Pool)` (over nodes(p)[1..-1] it covers only the
// addresses inside p, and `... WHERE n:Pool AND n <> b)` covers every address
// of p but b), or a `!Pool` label conjunct. A guard inside an OR is no guard.
// Labels and variables are case-sensitive and keywords are not: `not mid:Pool`
// guards, `NOT mid:pool` and `NOT mid:POOL` guard nothing.
// Inside the path pattern (an inner WHERE of a quantified path pattern, a
// node's own WHERE, or a label) it always counts. A clause-level WHERE, in the
// MATCH or in a WITH, counts only for an address that no SHORTEST pattern
// binds, because with a selector it runs after the shortest route is chosen.
// The legacy shortest-path functions evaluate the MATCH's WHERE during their
// search, so there it counts.
//
// Where a walk starts and ends. An anchored address is where a trace starts:
// an inline address map, or a WHERE conjunct, in the node's own WHERE or in a
// clause, that compares its address with a literal, a parameter or a list
// (`=` either way round, `IN`, `STARTS WITH`, `ENDS WITH`, `CONTAINS`, `=~`),
// with any function around either side, such as toLower(a.address). The
// walk leaves it and every address in the middle on the sides away from an
// anchor. When every side or no side of an address in the middle reaches an
// anchor, every side counts. The ends of an anchored walk that carry no
// anchor are its targets, and a target may be a pool. When every end of a
// walk is anchored, as in a route between two known addresses, the end written
// last is the target and the others are starts. A shortest-path walk (a
// SHORTEST selector or a legacy shortest-path function) is always a trace:
// when the check reads no anchor on it, every end counts as anchored. Any
// other walk with no anchor at all is a listing, not a trace: it has no
// start, and only its middle is checked, except that an end it labels :Pool
// may not be left (along the arrow, or either way when the relationship has
// no direction). An address labelled :Pool that a FLOWS_TO walk leaves on
// anything but REMOVED_LIQUIDITY is always a violation.

type Dir = 'out' | 'in' | 'both'
type NodeEl = {
  kind: 'node'
  vars: string[]
  labels: string
  anchored: boolean
  guards: string[]
}
type RelEl = { kind: 'rel'; types: string[] | null; dir: Dir; min: number; max: number }
type PathEl = { kind: 'path'; body: El[]; where: string; min: number; max: number }
type El = NodeEl | RelEl | PathEl

type Name = { name: string; local: boolean }
type WalkNode = { names: Name[]; labels: string[]; anchored: boolean; guards: string[] }
type WalkRel = { types: string[] | null; dir: Dir }
type Step = { node: WalkNode } | { rel: WalkRel }

// `selector` marks a SHORTEST selector, whose clause-level WHERE runs after the
// route is chosen; `route` marks any shortest-path walk, with a selector or a
// legacy shortest-path function.
type ParsedPattern = { pathVar: string | null; selector: boolean; route: boolean; els: El[] }
// A pattern predicate or pattern comprehension: a walk with its own WHERE,
// whose new variables do not leave it.
type Nested = { pattern: ParsedPattern; where: string }
type Clause =
  | { kind: 'match'; patterns: ParsedPattern[]; nested: Nested[] }
  | { kind: 'where'; text: string; nested: Nested[] }
  | { kind: 'with'; items: string; nested: Nested[] }
  | { kind: 'other'; nested: Nested[] }

const UNROLL_LIMIT = 3
const COMBINATION_LIMIT = 20000
const CLAUSE_KEYWORD =
  /\b(OPTIONAL\s+MATCH|MATCH|WITH|WHERE|RETURN|UNWIND|ORDER\s+BY|LIMIT|SKIP|CALL|YIELD|FINISH|USE)\b/gi
const SELECTOR =
  /^(ANY\s+SHORTEST\b|ALL\s+SHORTEST\b|SHORTEST\s+\d+(\s+(PATHS?|GROUPS?)\b)?|ANY\b(\s+\d+)?(\s+PATHS?\b)?(?=\s*[(A-Za-z_])|ALL\b(\s+PATHS?\b)?(?=\s*[(A-Za-z_]))/i
const LEGACY_SHORTEST = /^(shortestPath|allShortestPaths)\s*\(/i
const SUBQUERY_BRACE = /\b(EXISTS|COUNT|COLLECT|CALL)\s*$/i
// A `(` after a name opens a function call, unless the name is a keyword.
const CALL_PAREN = /[\w$]\s*$/
const KEYWORD_BEFORE_PAREN =
  /\b(AND|OR|XOR|NOT|WHERE|WHEN|THEN|ELSE|RETURN|WITH|DISTINCT|IN|IS|AS|BY|CASE|UNWIND|YIELD|MATCH)\s*$/i
const PATH_VAR = /^([A-Za-z_]\w*)\s*=(?!=)/
const IDENT = /^[A-Za-z_]\w*$/

// Blank string literals and comments so that nothing inside them reads as
// syntax. A literal keeps its quotes, so `{address: "0x…"}` stays an address
// map. A backquoted name becomes the plain name it escapes (`FLOWS_TO` reads
// as FLOWS_TO), with any character a plain name cannot hold written as `_`.
function blankLiteralsAndComments(query: string): string {
  let out = ''
  let i = 0
  while (i < query.length) {
    const c = query[i]
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < query.length && query[j] !== c) j += query[j] === '\\' ? 2 : 1
      out += `${c}${c}`
      i = j + 1
    } else if (c === '`') {
      let name = ''
      let j = i + 1
      while (j < query.length) {
        if (query[j] === '`' && query[j + 1] === '`') {
          name += '`'
          j += 2
        } else if (query[j] === '`') break
        else name += query[j++]
      }
      const plain = name.replace(/\W/g, '_')
      out += /^[A-Za-z_]/.test(plain) ? plain : `_${plain}`
      i = j + 1
    } else if (c === '/' && query[i + 1] === '/') {
      const end = query.indexOf('\n', i)
      i = end < 0 ? query.length : end
    } else if (c === '/' && query[i + 1] === '*') {
      const end = query.indexOf('*/', i + 2)
      i = end < 0 ? query.length : end + 2
    } else {
      out += c
      i++
    }
  }
  return out
}

function closing(text: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
  const stack: string[] = []
  for (let i = open; i < text.length; i++) {
    const c = text[i] ?? ''
    if (pairs[c]) stack.push(pairs[c])
    else if (c === stack[stack.length - 1]) {
      stack.pop()
      if (stack.length === 0) return i
    }
  }
  return -1
}

function skipSpace(text: string, pos: number): number {
  while (pos < text.length && /\s/.test(text[pos] ?? '')) pos++
  return pos
}

// Text of `s` at nesting depth 0, with every nested group replaced by spaces.
// The result has the same length as `s`, so a position in it is a position in `s`.
function topLevel(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i] ?? ''
    if (c === '(' || c === '[' || c === '{') {
      const end = closing(s, i)
      if (end < 0) return out + s.slice(i)
      out += ' '.repeat(end - i + 1)
      i = end
    } else out += c
  }
  return out
}

function stripOuterParens(s: string): string {
  let t = s.trim()
  while (t.startsWith('(') && closing(t, 0) === t.length - 1) t = t.slice(1, -1).trim()
  return t
}

// The AND-conjuncts of a predicate. A predicate with a top-level OR or XOR is
// one conjunct: AND binds tighter, so nothing inside it holds on its own.
function conjuncts(predicate: string): string[] {
  const s = stripOuterParens(predicate.replace(/^\s*WHERE\b/i, ''))
  if (!s) return []
  const flat = topLevel(s)
  if (/\b(OR|XOR)\b/i.test(flat)) return [s]
  const parts: string[] = []
  let last = 0
  for (const m of flat.matchAll(/\bAND\b/gi)) {
    parts.push(s.slice(last, m.index))
    last = (m.index ?? 0) + m[0].length
  }
  parts.push(s.slice(last))
  if (parts.length === 1) return [s]
  return parts.flatMap(conjuncts)
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// A keyword that matches in any letter case, with any run of spaces between
// its words. Names and labels around it stay case-sensitive.
const ci = (keyword: string) =>
  keyword
    .replace(/[A-Za-z]/g, (c) => `[${c.toUpperCase()}${c.toLowerCase()}]`)
    .replace(/ /g, '\\s+')

// `NOT name:Pool`, with `Pool` and the name in their exact case.
function isPoolGuard(conjunct: string, name: string): boolean {
  return new RegExp(
    `^${ci('NOT')}(?=[\\s(])\\s*\\(?\\s*${escape(name)}\\s*:\\s*Pool\\s*\\)?$`
  ).test(stripOuterParens(conjunct))
}

// `name.address` compared with a literal, a parameter or a list: `=` either
// way round, `IN`, `STARTS WITH`, `ENDS WITH`, `CONTAINS` or `=~`, with any
// function around either side, such as toLower(a.address) = toLower($addr).
function anchorsName(conjunct: string, name: string): boolean {
  const wrapped = (inner: string) => `(?:\\w+\\s*\\(\\s*)*${inner}(?:\\s*\\))*`
  const address = wrapped(`${escape(name)}\\.address`)
  const value = wrapped(`(?:\\$\\w+|""|''|\\[[^\\]]*\\])`)
  const operator = `(?:=~?|${ci('IN')}|${ci('STARTS WITH')}|${ci('ENDS WITH')}|${ci('CONTAINS')})`
  const c = stripOuterParens(conjunct)
  return (
    new RegExp(`^${address}\\s*${operator}\\s*${value}$`, 's').test(c) ||
    new RegExp(`^${value}\\s*=\\s*${address}$`, 's').test(c)
  )
}

// `none(n IN nodes(p) WHERE n:Pool)`, over nodes(p)[1..-1], or with
// `AND n <> b`: the path variable, whether only the addresses inside the path
// are covered, and the one variable left out.
function noneGuard(
  conjunct: string
): { pathVar: string; inner: boolean; except: string | null } | null {
  const m = new RegExp(
    `^${ci('none')}\\s*\\(\\s*(\\w+)\\s+${ci('IN')}\\s+${ci('nodes')}\\s*\\(\\s*(\\w+)\\s*\\)\\s*(\\[\\s*1\\s*\\.\\.\\s*-\\s*1\\s*\\])?\\s*${ci('WHERE')}\\s+(.+)\\)$`,
    's'
  ).exec(stripOuterParens(conjunct))
  if (!m?.[1] || !m[2] || !m[4]) return null
  const n = escape(m[1])
  const predicate = stripOuterParens(m[4])
  if (new RegExp(`^${n}\\s*:\\s*Pool$`).test(predicate)) {
    return { pathVar: m[2], inner: m[3] !== undefined, except: null }
  }
  const except = new RegExp(
    `^${n}\\s*:\\s*Pool\\s+${ci('AND')}\\s+(?:${n}\\s*<>\\s*(\\w+)|(\\w+)\\s*<>\\s*${n})$`
  ).exec(predicate)
  const other = except?.[1] ?? except?.[2]
  return other ? { pathVar: m[2], inner: m[3] !== undefined, except: other } : null
}

function hasRelationshipArrow(s: string): boolean {
  const flat = topLevel(s)
  if (/-\s*[-<>]|[<>]\s*-/.test(flat)) return true
  // a relationship detail `-[...]-` blanks to dashes around spaces
  return /-\s+-/.test(flat)
}

function parseQuantifier(text: string, pos: number): { min: number; max: number; end: number } {
  const p = skipSpace(text, pos)
  const brace = /^\{\s*(\d*)\s*(,\s*(\d*))?\s*\}/.exec(text.slice(p))
  if (brace) {
    const min = brace[1] ? Number(brace[1]) : 0
    const max = brace[2] === undefined ? min : brace[3] ? Number(brace[3]) : Infinity
    return { min, max, end: p + brace[0].length }
  }
  if (text[p] === '+') return { min: 1, max: Infinity, end: p + 1 }
  if (text[p] === '*') return { min: 0, max: Infinity, end: p + 1 }
  return { min: 1, max: 1, end: pos }
}

function parseNode(content: string): NodeEl {
  const flat = topLevel(content)
  const whereAt = flat.search(/\bWHERE\b/i)
  const head = whereAt < 0 ? content : content.slice(0, whereAt)
  const guard = whereAt < 0 ? '' : content.slice(whereAt)
  const varMatch = /^\s*([A-Za-z_]\w*)/.exec(head)
  const vars = varMatch?.[1] ? [varMatch[1]] : []
  const labelMatch = /:\s*([^{]*)/.exec(topLevel(head))
  const name = vars[0]
  return {
    kind: 'node',
    vars,
    labels: labelMatch?.[1]?.trim() ?? '',
    // An inline address map, or an address predicate in the node's own WHERE.
    anchored:
      /\{[^}]*\baddress\s*:/.test(head) ||
      (name !== undefined && conjuncts(guard).some((c) => anchorsName(c, name))),
    guards: guard ? [guard] : [],
  }
}

function parseRelDetail(detail: string): { types: string[] | null; legacy?: [number, number] } {
  const flat = topLevel(detail)
  const whereAt = flat.search(/\bWHERE\b/i)
  const head = whereAt < 0 ? flat : flat.slice(0, whereAt)
  let legacy: [number, number] | undefined
  const star = /\*\s*(\d*)\s*(\.\.\s*(\d*))?/.exec(head)
  if (star) {
    const min = star[1] ? Number(star[1]) : 1
    const max =
      star[2] === undefined ? (star[1] ? min : Infinity) : star[3] ? Number(star[3]) : Infinity
    legacy = [min, max]
  }
  const typeText = /:\s*([^*{]*)/.exec(star ? head.slice(0, star.index) : head)?.[1] ?? ''
  if (!typeText.trim() || /[!%]/.test(typeText)) return { types: null, legacy }
  const types = typeText
    .split(/[|&:]/)
    .map((t) => t.trim())
    .filter(Boolean)
  return { types, legacy }
}

function parseElements(text: string, start: number) {
  const els: El[] = []
  let pos = start
  for (;;) {
    pos = skipSpace(text, pos)
    const c = text[pos]
    if (c === '(') {
      const end = closing(text, pos)
      if (end < 0) break
      const content = text.slice(pos + 1, end)
      if (hasRelationshipArrow(content)) {
        const inner = parseElements(content, 0)
        const rest = content.slice(inner.end)
        const whereAt = rest.search(/\bWHERE\b/i)
        const q = parseQuantifier(text, end + 1)
        els.push({
          kind: 'path',
          body: inner.els,
          where: whereAt < 0 ? '' : rest.slice(whereAt),
          min: q.min,
          max: q.max,
        })
        pos = q.end
      } else {
        els.push(parseNode(content))
        pos = end + 1
      }
      continue
    }
    const arrow = /^(<?)\s*-/.exec(text.slice(pos))
    if (!arrow) break
    const leftArrow = arrow[1] === '<'
    let p = pos + arrow[0].length
    p = skipSpace(text, p)
    let detail = ''
    if (text[p] === '[') {
      const end = closing(text, p)
      if (end < 0) break
      detail = text.slice(p + 1, end)
      p = skipSpace(text, end + 1)
    }
    if (text[p] !== '-') break
    p++
    p = skipSpace(text, p)
    let rightArrow = false
    if (text[p] === '>') {
      rightArrow = true
      p++
    }
    const rel = parseRelDetail(detail)
    const q = parseQuantifier(text, p)
    const [min, max] = rel.legacy ?? [q.min, q.max]
    const dir: Dir = leftArrow === rightArrow ? 'both' : rightArrow ? 'out' : 'in'
    els.push({ kind: 'rel', types: rel.types, dir, min, max })
    pos = q.end
  }
  return { els, end: pos }
}

const hasRelationship = (els: El[]): boolean => els.some((el) => el.kind !== 'node')

// The comma-separated path patterns of one MATCH clause body.
function parsePatterns(body: string): ParsedPattern[] {
  let pos = 0
  const patterns: ParsedPattern[] = []
  for (;;) {
    pos = skipSpace(body, pos)
    if (pos >= body.length) break
    let pathVar: string | null = null
    let selector = false
    const pv = PATH_VAR.exec(body.slice(pos))
    if (pv?.[1]) {
      pathVar = pv[1]
      pos = skipSpace(body, pos + pv[0].length)
    }
    const sel = SELECTOR.exec(body.slice(pos))
    if (sel) {
      selector = true
      pos = skipSpace(body, pos + sel[0].length)
      const pv2 = PATH_VAR.exec(body.slice(pos))
      if (pv2?.[1]) {
        pathVar = pv2[1]
        pos = skipSpace(body, pos + pv2[0].length)
      }
    }
    const legacy = LEGACY_SHORTEST.exec(body.slice(pos))
    const route = selector || legacy !== null
    let els: El[]
    if (legacy) {
      // shortestPath((a)-[:R*1..5]-(b)): the pattern is the function's argument.
      const open = pos + legacy[0].length - 1
      const end = closing(body, open)
      if (end < 0) break
      els = parseElements(body.slice(open + 1, end), 0).els
      pos = skipSpace(body, end + 1)
    } else {
      const parsed = parseElements(body, pos)
      els = parsed.els
      pos = skipSpace(body, parsed.end)
    }
    if (els.length === 0) break
    patterns.push({ pathVar, selector, route, els })
    if (body[pos] === ',') {
      pos++
      continue
    }
    break
  }
  return patterns
}

// Every pattern predicate and pattern comprehension written in `text`, outside
// subqueries (which are read as queries of their own).
function nestedPatterns(text: string): Nested[] {
  const out: Nested[] = []
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '{' && SUBQUERY_BRACE.test(text.slice(0, i))) {
      const end = closing(text, i)
      i = end < 0 ? text.length : end + 1
      continue
    }
    if (c === '[') {
      const end = closing(text, i)
      const content = end < 0 ? '' : text.slice(i + 1, end)
      const head = /^\s*(?:([A-Za-z_]\w*)\s*=\s*)?(?=\()/.exec(content)
      if (head) {
        const parsed = parseElements(content, head[0].length)
        if (hasRelationship(parsed.els) && parsed.els[0]?.kind === 'node') {
          const rest = content.slice(parsed.end)
          const bar = topLevel(rest).indexOf('|')
          const tail = bar < 0 ? rest : rest.slice(0, bar)
          const whereAt = tail.search(/\bWHERE\b/i)
          out.push({
            pattern: { pathVar: head[1] ?? null, selector: false, route: false, els: parsed.els },
            where: whereAt < 0 ? '' : tail.slice(whereAt),
          })
          // Patterns inside the comprehension's WHERE or projection are read too.
          out.push(...nestedPatterns(rest))
          i = end + 1
          continue
        }
      }
      i++
      continue
    }
    const before = text.slice(0, i)
    if (c === '(' && (!CALL_PAREN.test(before) || KEYWORD_BEFORE_PAREN.test(before))) {
      const parsed = parseElements(text, i)
      if (hasRelationship(parsed.els) && parsed.els[0]?.kind === 'node') {
        out.push({
          pattern: { pathVar: null, selector: false, route: false, els: parsed.els },
          where: '',
        })
        for (const el of parsed.els) {
          if (el.kind === 'node') for (const g of el.guards) out.push(...nestedPatterns(g))
        }
        i = parsed.end
        continue
      }
    }
    i++
  }
  return out
}

// Pattern predicates written inside a MATCH pattern: in a node's own WHERE or
// in the inner WHERE of a quantified path pattern.
function nestedInPatterns(els: El[]): Nested[] {
  return els.flatMap((el) => {
    if (el.kind === 'node') return el.guards.flatMap(nestedPatterns)
    if (el.kind === 'path') return [...nestedPatterns(el.where), ...nestedInPatterns(el.body)]
    return []
  })
}

// The clauses of one UNION branch, in order. A branch that starts with a node
// pattern is read as a MATCH clause.
function parseClauses(text: string): Clause[] {
  const flat = topLevel(text)
  const marks: { kw: string; body: number; start: number }[] = []
  const lead = text.search(/\S/)
  if (lead >= 0 && text[lead] === '(') marks.push({ kw: 'MATCH', body: lead, start: lead })
  for (const m of flat.matchAll(CLAUSE_KEYWORD)) {
    const at = m.index ?? 0
    const kw = (m[1] ?? '').toUpperCase().replace(/\s+/g, ' ')
    if (kw === 'WITH' && /\b(STARTS|ENDS)\s*$/i.test(flat.slice(0, at))) continue
    marks.push({ kw, body: at + m[0].length, start: at })
  }
  return marks.map((mark, i): Clause => {
    const body = text.slice(mark.body, marks[i + 1]?.start ?? text.length)
    if (mark.kw === 'MATCH' || mark.kw === 'OPTIONAL MATCH') {
      const patterns = parsePatterns(body)
      return { kind: 'match', patterns, nested: patterns.flatMap((p) => nestedInPatterns(p.els)) }
    }
    if (mark.kw === 'WHERE') return { kind: 'where', text: body, nested: nestedPatterns(body) }
    if (mark.kw === 'WITH') return { kind: 'with', items: body, nested: nestedPatterns(body) }
    return { kind: 'other', nested: nestedPatterns(body) }
  })
}

// Every pattern the walk graph is built from, in the order buildWalks reads them.
function clausePatterns(clause: Clause): ParsedPattern[] {
  const nested = clause.nested.map((n) => n.pattern)
  return clause.kind === 'match' ? [...clause.patterns, ...nested] : nested
}

// Repetition counts to try: from the lower bound up to UNROLL_LIMIT (or the
// lower bound itself when it is higher), never past the upper bound.
function range(min: number, max: number): number[] {
  const out: number[] = []
  for (let n = min; n <= Math.min(max, Math.max(min, UNROLL_LIMIT)); n++) out.push(n)
  return out
}

function product<T>(lists: T[][][]): T[][] {
  return lists.reduce<T[][]>(
    (acc, options) => acc.flatMap((prefix) => options.map((option) => [...prefix, ...option])),
    [[]]
  )
}

function anonNode(): WalkNode {
  return { names: [], labels: [], anchored: false, guards: [] }
}

// Every way the elements can unroll, up to UNROLL_LIMIT repetitions.
function unroll(els: El[], guards: string[], local: boolean): Step[][] {
  return product(
    els.map((el): Step[][] => {
      if (el.kind === 'node') {
        return [
          [
            {
              node: {
                names: el.vars.map((name) => ({ name, local })),
                labels: el.labels ? [el.labels] : [],
                anchored: el.anchored,
                guards: [...guards, ...el.guards],
              },
            },
          ],
        ]
      }
      if (el.kind === 'rel') {
        return range(el.min, el.max).map((hops) => {
          const steps: Step[] = []
          for (let h = 0; h < hops; h++) {
            if (h > 0) steps.push({ node: anonNode() })
            steps.push({ rel: { types: el.types, dir: el.dir } })
          }
          return steps
        })
      }
      const bodies = unroll(el.body, el.where ? [...guards, el.where] : guards, true)
      return range(el.min, el.max).flatMap((times) =>
        bodies.map((body) => Array.from({ length: times }, () => body).flat())
      )
    })
  )
}

// Juxtaposed node patterns are one node. A walk starts and ends on a node.
function linearize(steps: Step[]): { nodes: WalkNode[]; rels: WalkRel[] } {
  const nodes: WalkNode[] = []
  const rels: WalkRel[] = []
  let lastWasNode = false
  for (const step of steps) {
    if ('node' in step) {
      if (lastWasNode) {
        const prev = nodes[nodes.length - 1] as WalkNode
        nodes[nodes.length - 1] = {
          names: [...prev.names, ...step.node.names],
          labels: [...prev.labels, ...step.node.labels],
          anchored: prev.anchored || step.node.anchored,
          guards: [...prev.guards, ...step.node.guards],
        }
      } else nodes.push(step.node)
      lastWasNode = true
    } else {
      if (!lastWasNode) nodes.push(anonNode())
      rels.push(step.rel)
      lastWasNode = false
    }
  }
  if (!lastWasNode) nodes.push(anonNode())
  return { nodes, rels }
}

// A label expression with a `!Pool` conjunct and no top-level alternative.
function labelGuard(labels: string): boolean {
  const flat = topLevel(stripOuterParens(labels)).replace(/\s+/g, '')
  if (flat.includes('|')) return false
  return flat.split(/[&:]/).some((part) => part === '!Pool')
}

// A label expression that names Pool as a label the node must carry.
function labelledPool(labels: string): boolean {
  const flat = topLevel(stripOuterParens(labels)).replace(/\s+/g, '')
  if (flat.includes('|')) return false
  return flat.split(/[&:]/).some((part) => part === 'Pool')
}

function mayBeFlowsTo(rel: WalkRel): boolean {
  return rel.types === null || rel.types.includes('FLOWS_TO')
}

function followsSwapped(rel: WalkRel): boolean {
  return rel.types === null || rel.types.includes('SWAPPED')
}

// The one relationship a walk may leave a pool on (step 2 of the rule).
function onlyRemovedLiquidity(rel: WalkRel): boolean {
  return rel.types !== null && rel.types.every((t) => t === 'REMOVED_LIQUIDITY')
}

function typesOf(rel: WalkRel): string {
  return rel.types === null ? 'any relationship' : rel.types.join('|')
}

// One address of the walk graph. `names` are its variables in the query scope;
// `localNames` are quantified-path variables, which name it for this repetition
// only. `order` is where it is first written.
type GraphNode = {
  names: Set<string>
  localNames: Set<string>
  labels: string[]
  anchored: boolean
  guards: string[]
  inSelector: boolean
  inRoute: boolean
  order: number
}
type PatternRecord = { selector: boolean; keys: string[] }
type Edge = { a: string; b: string; rel: WalkRel }

class Walks {
  private parent = new Map<string, string>()
  private counter = 0
  private written = 0
  readonly nodes = new Map<string, GraphNode>()
  readonly edges: Edge[] = []
  readonly patterns: PatternRecord[] = []
  readonly clauseGuarded = new Set<string>()
  readonly anchoredKeys = new Set<string>()
  readonly noneGuards: { pattern: number; inner: boolean; except: string | null }[] = []

  fresh(): string {
    const key = `k${this.counter++}`
    this.parent.set(key, key)
    return key
  }

  find(key: string): string {
    let root = key
    while (this.parent.get(root) !== root) root = this.parent.get(root) as string
    this.parent.set(key, root)
    return root
  }

  union(a: string, b: string): string {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(rb, ra)
    return ra
  }

  attach(key: string, node: WalkNode, pattern: ParsedPattern): void {
    const current = this.nodes.get(key) ?? {
      names: new Set<string>(),
      localNames: new Set<string>(),
      labels: [],
      anchored: false,
      guards: [],
      inSelector: false,
      inRoute: false,
      order: this.written++,
    }
    for (const n of node.names) (n.local ? current.localNames : current.names).add(n.name)
    current.labels.push(...node.labels)
    current.anchored ||= node.anchored
    current.guards.push(...node.guards)
    current.inSelector ||= pattern.selector
    current.inRoute ||= pattern.route
    this.nodes.set(key, current)
  }

  // Merge the records of every key into its root.
  resolve(): Map<string, GraphNode> {
    const out = new Map<string, GraphNode>()
    for (const [key, node] of this.nodes) {
      const root = this.find(key)
      const current = out.get(root)
      if (!current) {
        out.set(root, {
          names: new Set(node.names),
          localNames: new Set(node.localNames),
          labels: [...node.labels],
          anchored: node.anchored,
          guards: [...node.guards],
          inSelector: node.inSelector,
          inRoute: node.inRoute,
          order: node.order,
        })
        continue
      }
      for (const n of node.names) current.names.add(n)
      for (const n of node.localNames) current.localNames.add(n)
      current.labels.push(...node.labels)
      current.anchored ||= node.anchored
      current.guards.push(...node.guards)
      current.inSelector ||= node.inSelector
      current.inRoute ||= node.inRoute
      current.order = Math.min(current.order, node.order)
    }
    for (const key of this.anchoredKeys) {
      const node = out.get(this.find(key))
      if (node) node.anchored = true
    }
    return out
  }
}

// The projected names of a WITH: `*`, bare variables, and `x AS y` aliases.
function withProjection(items: string, scope: Map<string, string>): Map<string, string> {
  const next = new Map<string, string>()
  const body = items.replace(/^\s*DISTINCT\b/i, '')
  const flat = topLevel(body)
  let last = 0
  const parts: string[] = []
  for (let i = 0; i <= flat.length; i++) {
    if (i === flat.length || flat[i] === ',') {
      parts.push(body.slice(last, i).trim())
      last = i + 1
    }
  }
  for (const part of parts) {
    if (part === '*') {
      for (const [k, v] of scope) next.set(k, v)
      continue
    }
    const alias = /^(.*?)\s+AS\s+([A-Za-z_]\w*)$/is.exec(part)
    const expr = (alias ? alias[1] : part)?.trim() ?? ''
    const name = alias?.[2] ?? expr
    if (!IDENT.test(expr) || !IDENT.test(name)) continue
    const key = scope.get(expr)
    if (key) next.set(name, key)
    const path = scope.get(`path:${expr}`)
    if (path) next.set(`path:${name}`, path)
  }
  return next
}

// Add one pattern to the walk graph. Names already in scope are those
// addresses; new names join `scope`.
function addPattern(
  walks: Walks,
  scope: Map<string, string>,
  pattern: ParsedPattern,
  steps: Step[]
): void {
  const { nodes, rels } = linearize(steps)
  const keys = nodes.map((node) => {
    let key: string | null = null
    for (const n of node.names) {
      if (n.local) continue
      let named = scope.get(n.name)
      if (!named) {
        named = walks.fresh()
        scope.set(n.name, named)
      }
      key = key ? walks.union(key, named) : named
    }
    key ??= walks.fresh()
    walks.attach(key, node, pattern)
    return key
  })
  rels.forEach((rel, i) =>
    walks.edges.push({ a: keys[i] as string, b: keys[i + 1] as string, rel })
  )
  walks.patterns.push({ selector: pattern.selector, keys })
  if (pattern.pathVar) scope.set(`path:${pattern.pathVar}`, String(walks.patterns.length - 1))
}

// Apply a WHERE's conjuncts to the names in scope.
function applyWhere(walks: Walks, scope: Map<string, string>, text: string): void {
  for (const conjunct of conjuncts(text)) {
    for (const [name, key] of scope) {
      if (name.startsWith('path:')) continue
      if (isPoolGuard(conjunct, name)) walks.clauseGuarded.add(key)
      if (anchorsName(conjunct, name)) walks.anchoredKeys.add(key)
    }
    const none = noneGuard(conjunct)
    const pattern = none ? scope.get(`path:${none.pathVar}`) : undefined
    if (none && pattern !== undefined) {
      const except = none.except ? (scope.get(none.except) ?? null) : null
      walks.noneGuards.push({ pattern: Number(pattern), inner: none.inner, except })
    }
  }
}

function buildWalks(clauses: Clause[], choice: Step[][]): Walks {
  const walks = new Walks()
  let scope = new Map<string, string>()
  let index = 0
  const addNested = (nested: Nested[]) => {
    for (const n of nested) {
      // A nested pattern sees the query's names; its own names stay inside it.
      const inner = new Map(scope)
      addPattern(walks, inner, n.pattern, choice[index++] ?? [])
      if (n.where) applyWhere(walks, inner, n.where)
    }
  }
  for (const clause of clauses) {
    if (clause.kind === 'match') {
      for (const pattern of clause.patterns)
        addPattern(walks, scope, pattern, choice[index++] ?? [])
      addNested(clause.nested)
    } else if (clause.kind === 'where') {
      applyWhere(walks, scope, clause.text)
      addNested(clause.nested)
    } else if (clause.kind === 'with') {
      addNested(clause.nested)
      scope = withProjection(clause.items, scope)
    } else addNested(clause.nested)
  }
  return walks
}

// `trace` is whether the query holds a FLOWS_TO walk that is a trace: one
// with an anchored address, or a shortest-path walk.
type Findings = { unguarded: string[]; noSwapped: string[]; trace: boolean }

function describe(node: GraphNode): string {
  const names = [...node.names, ...node.localNames]
  return names.length ? `(${names.join('/')})` : '()'
}

// Does the walk leave `end`, an end of a walk with no anchor, along `e`?
function leavesAlong(end: string, e: Edge): boolean {
  if (e.rel.dir === 'both') return true
  return e.a === end ? e.rel.dir === 'out' : e.rel.dir === 'in'
}

function evaluate(walks: Walks, findings: Findings): void {
  const nodes = walks.resolve()
  const edges: Edge[] = walks.edges.map((e) => ({
    a: walks.find(e.a),
    b: walks.find(e.b),
    rel: e.rel,
  }))
  const noneGuarded = new Set<string>()
  for (const guard of walks.noneGuards) {
    const pattern = walks.patterns[guard.pattern]
    if (!pattern || pattern.selector) continue
    const keys = guard.inner ? pattern.keys.slice(1, -1) : pattern.keys
    const except = guard.except ? walks.find(guard.except) : null
    for (const key of keys) if (walks.find(key) !== except) noneGuarded.add(walks.find(key))
  }
  const clauseGuarded = new Set([...walks.clauseGuarded].map((k) => walks.find(k)))

  const incidentOf = (root: string) => edges.filter((e) => (e.a === root) !== (e.b === root))
  const neighbour = (key: string, e: Edge) => (e.a === key ? e.b : e.b === key ? e.a : null)

  // Every address reached from `start` without passing `root`.
  const reach = (root: string, start: string): Set<string> => {
    const seen = new Set([root, start])
    const queue = [start]
    while (queue.length) {
      const key = queue.shift() as string
      for (const e of edges) {
        const next = neighbour(key, e)
        if (next && !seen.has(next)) {
          seen.add(next)
          queue.push(next)
        }
      }
    }
    seen.delete(root)
    return seen
  }
  const reachesAnchor = (root: string, start: string): boolean =>
    [...reach(root, start)].some((key) => nodes.get(key)?.anchored)
  // The walk `root` is on, and whether it walks FLOWS_TO anywhere.
  const componentOf = (root: string): Set<string> => {
    const first = incidentOf(root)[0]
    return first ? new Set([root, ...reach(root, neighbour(root, first) as string)]) : new Set()
  }
  const walksFlowsTo = (component: Set<string>): boolean =>
    edges.some((e) => component.has(e.a) && mayBeFlowsTo(e.rel))
  for (const [root, node] of nodes) {
    if ((node.anchored || node.inRoute) && walksFlowsTo(componentOf(root))) findings.trace = true
  }

  const guarded = (root: string, node: GraphNode): boolean => {
    const names = [...node.names, ...node.localNames]
    return (
      node.labels.some(labelGuard) ||
      node.guards.some((g) => conjuncts(g).some((c) => names.some((n) => isPoolGuard(c, n)))) ||
      (!node.inSelector && (clauseGuarded.has(root) || noneGuarded.has(root)))
    )
  }

  // The addresses the walk leaves, with the edges it leaves them on.
  const leaves: { root: string; exits: Edge[]; role: 'start' | 'middle' }[] = []
  for (const [root, node] of nodes) {
    const incident = incidentOf(root)
    if (incident.length === 0) continue
    if (incident.length >= 2) {
      const sides = incident.map((e) => ({
        e,
        anchored: reachesAnchor(root, neighbour(root, e) as string),
      }))
      const mixed = sides.some((s) => s.anchored) && sides.some((s) => !s.anchored)
      const exits = mixed ? sides.filter((s) => !s.anchored).map((s) => s.e) : incident
      leaves.push({ root, exits, role: 'middle' })
      continue
    }
    // An end of the walk: a start or a target.
    const edge = incident[0] as Edge
    const component = componentOf(root)
    const ends = [...component].filter((key) => incidentOf(key).length === 1)
    const anchoredWalk = [...component].some((key) => nodes.get(key)?.anchored)
    const routeWalk = [...component].some((key) => nodes.get(key)?.inRoute)
    if (anchoredWalk || routeWalk) {
      // A shortest-path walk is a trace even when the check reads no anchor on
      // it: then every end counts as anchored.
      const isAnchored = (key: string) => !anchoredWalk || Boolean(nodes.get(key)?.anchored)
      if (!isAnchored(root)) continue // a target
      const openEnds = ends.filter((key) => !isAnchored(key))
      if (openEnds.length === 0) {
        // Every end is anchored: the end written last is the target.
        const last = ends.reduce((a, b) =>
          (nodes.get(a)?.order ?? 0) >= (nodes.get(b)?.order ?? 0) ? a : b
        )
        if (last === root) continue
      }
      leaves.push({ root, exits: [edge], role: 'start' })
    } else if (node.labels.some(labelledPool) && leavesAlong(root, edge)) {
      leaves.push({ root, exits: [edge], role: 'start' })
    }
  }

  for (const { root, exits, role } of leaves) {
    const node = nodes.get(root) as GraphNode
    // The rule governs walks that walk FLOWS_TO. On one, the walk may leave an
    // address on any relationship but REMOVED_LIQUIDITY only when it is no pool.
    if (!walksFlowsTo(componentOf(root))) continue
    const guardedExits = exits.filter((e) => !onlyRemovedLiquidity(e.rel))
    if (guardedExits.length === 0) continue
    if (node.labels.some(labelledPool)) {
      const other = guardedExits.find((e) => !mayBeFlowsTo(e.rel))
      findings.unguarded.push(
        guardedExits.some((e) => mayBeFlowsTo(e.rel))
          ? `${describe(node)} is a :Pool the walk leaves on FLOWS_TO`
          : `${describe(node)} is a :Pool the walk leaves on ${typesOf((other as Edge).rel)}, not on REMOVED_LIQUIDITY`
      )
      continue
    }
    if (!guarded(root, node)) {
      findings.unguarded.push(
        role === 'start'
          ? `${describe(node)} starts a FLOWS_TO walk without the pool guard`
          : `${describe(node)} is in the middle of a FLOWS_TO walk without the pool guard`
      )
    }
    if (
      role === 'middle' &&
      exits.some((e) => mayBeFlowsTo(e.rel)) &&
      incidentOf(root).some((e) => mayBeFlowsTo(e.rel) && !followsSwapped(e.rel))
    ) {
      findings.noSwapped.push(
        `${describe(node)} is in the middle of a FLOWS_TO trace whose hop does not also follow SWAPPED`
      )
    }
  }
}

function analyseBranch(text: string, findings: Findings): void {
  const clauses = parseClauses(text)
  const patterns = clauses.flatMap(clausePatterns)
  const options = patterns.map((p) => unroll(p.els, [], false))
  const total = options.reduce((n, o) => n * Math.max(o.length, 1), 1)
  if (total > COMBINATION_LIMIT)
    throw new Error(`query too large for the pool-guard check:\n${text}`)
  const choice: Step[][] = []
  const walk = (i: number): void => {
    if (i === options.length) {
      evaluate(buildWalks(clauses, choice), findings)
      return
    }
    for (const option of options[i] ?? []) {
      choice[i] = option
      walk(i + 1)
    }
  }
  walk(0)
  // Subqueries are queries of their own.
  for (const m of text.matchAll(/\b(EXISTS|COUNT|COLLECT|CALL)\s*\{/gi)) {
    const open = (m.index ?? 0) + m[0].length - 1
    const end = closing(text, open)
    if (end > open) analyse(text.slice(open + 1, end), findings)
  }
}

function analyse(text: string, findings: Findings): void {
  const flat = topLevel(text)
  let last = 0
  for (const m of flat.matchAll(/\bUNION(\s+ALL)?\b/gi)) {
    analyseBranch(text.slice(last, m.index), findings)
    last = (m.index ?? 0) + m[0].length
  }
  analyseBranch(text.slice(last), findings)
}

function findings(query: string): Findings {
  const out: Findings = { unguarded: [], noSwapped: [], trace: false }
  analyse(blankLiteralsAndComments(query), out)
  return {
    unguarded: [...new Set(out.unguarded)],
    noSwapped: [...new Set(out.noSwapped)],
    trace: out.trace,
  }
}

export function unguardedPoolWalks(query: string): string[] {
  return findings(query).unguarded
}

export function traceHopsWithoutSwapped(query: string): string[] {
  return findings(query).noSwapped
}

// Whether the query walks FLOWS_TO from an address it anchors, in any form
// the check reads, or walks it on a shortest-path search.
export function isFlowsToTrace(query: string): boolean {
  return findings(query).trace
}

// --- where the served queries live ------------------------------------------

// Every query a Markdown page serves: fenced Cypher blocks, `query=` and
// `queries=[...]` payloads in shell blocks, and inline code that starts with
// MATCH, USE or a node pattern.
export function markdownQueries(markdown: string): string[] {
  const queries: string[] = []
  const fence = /^```([\w-]*)\n([\s\S]*?)^```/gm
  for (const block of markdown.matchAll(fence)) {
    const lang = (block[1] ?? '').toLowerCase()
    const body = block[2] ?? ''
    if (!/\bMATCH\b/.test(body)) continue
    if (['bash', 'sh', 'shell', 'console'].includes(lang)) {
      const payloads = shellPayloads(body)
      const inBody = body.match(/\bMATCH\b/g)?.length ?? 0
      const inPayloads = payloads.join('\n').match(/\bMATCH\b/g)?.length ?? 0
      if (inBody !== inPayloads) {
        throw new Error(`a shell block holds a MATCH no payload pattern extracts:\n${body}`)
      }
      queries.push(...payloads)
    } else if (lang !== 'json') queries.push(body)
  }
  const prose = markdown.replace(fence, '')
  for (const span of prose.matchAll(/`([^`\n]+)`/g)) {
    // In a table cell a `|` inside code is written `\|` and renders as `|`.
    const code = (span[1] ?? '').trim().replace(/\\\|/g, '|')
    if (/^(USE\b|MATCH\b|OPTIONAL\s+MATCH\b|\()/i.test(code) && /-/.test(code)) queries.push(code)
  }
  return queries
}

function shellPayloads(body: string): string[] {
  const out: string[] = []
  for (const m of body.matchAll(/'query=([^']*)'|query='([^']*)'/g)) out.push(m[1] ?? m[2] ?? '')
  for (const m of body.matchAll(/"query=((?:[^"\\]|\\.)*)"/g)) {
    out.push((m[1] ?? '').replace(/\\(.)/g, '$1'))
  }
  for (const m of body.matchAll(/'queries=(\[[^']*\])'/g)) {
    for (const entry of JSON.parse(m[1] ?? '[]') as { query: string }[]) out.push(entry.query)
  }
  return out
}

// Every MATCH statement in served prose, such as the MCP server instructions:
// from MATCH to the end of its sentence.
export function proseQueries(text: string): string[] {
  const out: string[] = []
  const flat = text.replace(/"[^"\n]*"/g, '""')
  for (const m of flat.matchAll(/\b(?:OPTIONAL\s+)?MATCH\b/g)) {
    const rest = flat.slice(m.index ?? 0)
    const end = rest.search(/\.(?=\s|$)|\n/)
    out.push(end < 0 ? rest : rest.slice(0, end))
  }
  return out
}
