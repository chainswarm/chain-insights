import { describe, expect, it } from 'vitest'

import { propertiesOf } from './support/facts-columns.js'
import { factsReadViolations } from './support/facts-contract.js'
import { markdownQueries } from './support/pool-walk-guard.js'
import {
  flat,
  markdownFiles,
  read,
  runtimeSkill,
  sectionWith,
  servedGraphHints,
} from './support/schema-text.js'

// A facts `TRANSFER` row has a `kind`: `token`, `native` or `internal`. An
// internal transfer, ETH a contract sends while it runs a call, is a row now, so
// the rows of a pair are the transfers its `FLOWS_TO` link counts. The graph
// server maps `kind` on `TRANSFER` (tests/fixtures/facts-columns.json). The old
// sentences said that no read lists an internal transfer, and a pair could have a
// `tx_count` above 0 and no row. They are gone from every home, and these
// sentences stand in their place.

// The sentences every home carries, with the Markdown marks removed.
const KIND_SENTENCES = [
  'Every TRANSFER row has a kind: token, native or internal.',
  'An internal row is ETH a contract sends while it runs a call, such as the ETH leg of a wrap.',
  'Add t.kind = "internal" to the pair and the day to read only the internal rows.',
]

// The sentence of the link, in every home that speaks of `tx_count`.
const SUM_RULE =
  'so the rows of a pair are the transfers its link counts, up to the height the link was built to'

const plain = (text: string): string => flat(text).replace(/\\?`/g, '').replace(/\*\*/g, '')

const GUIDE = 'skills/chain-insights-schema-evm/SKILL.md'
const CYPHER = 'skills/chain-insights-cypher/SKILL.md'
const TOOLS = 'docs/graph-tools.md'
const COMPAT = 'docs/graph-query-compatibility.md'

// The schema skill is the one skill home of the kind of a row. The cypher skill
// is short and states the facts read, not the kinds.
const GUIDE_HOMES = [GUIDE, `plugin/${GUIDE}`, TOOLS, COMPAT] as const

// Every file a reader or an agent is shown.
const SHIPPED_TEXT = [
  'README.md',
  'src/mcp/proxy.ts',
  'src/workspace/init.ts',
  'src/investigation/public-tools.ts',
  ...GUIDE_HOMES,
  CYPHER,
  `plugin/${CYPHER}`,
  ...markdownFiles('docs'),
]

describe('the kind of a TRANSFER row is taught in every home', () => {
  it('the server maps kind on TRANSFER', () => {
    expect(propertiesOf('TRANSFER')).toContain('kind')
  })

  it.each(GUIDE_HOMES)('%s states what kind is and how to filter on it', (path) => {
    const text = plain(read(path))
    for (const sentence of KIND_SENTENCES) {
      expect(text, `${path} lacks: ${sentence}`).toContain(sentence)
    }
  })

  it('the served graph hints state the same', () => {
    const hints = plain(servedGraphHints())
    for (const sentence of KIND_SENTENCES) {
      expect(hints, `served hints lack: ${sentence}`).toContain(sentence)
    }
  })

  it('the workspace runtime notes state the same', async () => {
    const notes = plain(await runtimeSkill())
    for (const sentence of KIND_SENTENCES) {
      expect(notes, `runtime notes lack: ${sentence}`).toContain(sentence)
    }
  })
})

describe('the link counts every transfer and the rows add up to it', () => {
  it('the schema skill says TRANSFER lists all three and the rows are the link', () => {
    const flows = plain(sectionWith(read(GUIDE), 'FLOWS_TO properties'))
    expect(flows).toContain(
      'tx_count counts token and native transfers and also internal native transfers.'
    )
    expect(flows).toContain(`USE facts TRANSFER lists all three, ${SUM_RULE}`)
    expect(flows).toContain('A link covers all time, and a USE facts read covers one day')
    expect(flows).toContain("read a pair's transfers one day at a time")
  })

  it('the tools guide, the hints and the runtime notes say the same', async () => {
    const homes: [string, string][] = [
      [TOOLS, plain(read(TOOLS))],
      ['the served hints', plain(servedGraphHints())],
      ['the runtime notes', plain(await runtimeSkill())],
    ]
    for (const [name, text] of homes) {
      expect(text, `${name} lacks the sum rule`).toContain(SUM_RULE)
      expect(text, `${name} lacks the day rule`).toMatch(
        /A link covers all time,? and a (?:USE facts|facts) read covers one day/
      )
    }
  })

  it('the served hints and the runtime notes keep the anchor query for any pair', async () => {
    for (const [name, text] of [
      ['the served hints', servedGraphHints()],
      ['the runtime notes', await runtimeSkill()],
    ] as const) {
      const body = plain(text)
      expect(body, `${name} lacks the anchor sentence`).toContain(
        'A transaction anchor of a pair resolves through USE facts, on the UTC day of the first_seen_timestamp or last_seen_timestamp of the link'
      )
      expect(body, `${name} still limits the anchor to token or native pairs`).not.toContain(
        'For a pair with token or native transfers'
      )
      expect(body).toContain(
        'WHERE t.block_date = "YYYY-MM-DD" RETURN t.tx_id, t.block_timestamp LIMIT 1'
      )
    }
  })

  it('the served hints say every tx id, an internal one included, comes from TRANSFER', () => {
    expect(plain(servedGraphHints())).toContain(
      'Tx ids of every transfer, internal ones included, come from USE facts TRANSFER.'
    )
  })
})

describe('an internal row, as the schema skill describes it', () => {
  const facts = plain(sectionWith(read(GUIDE), 'Facts labels and relationships'))

  it('is one call frame, with an event_index and an edge_index of 0', () => {
    expect(facts).toContain('An internal row is one call frame.')
    expect(facts).toContain("Its event_index is the frame's position in the transaction's calls")
    expect(facts).toContain('its edge_index is 0')
  })

  it('has no raw amount, so a sum names amount or amount_usd', () => {
    expect(facts).toContain('raw_amount and decimals read null')
    expect(facts).toContain('a sum of raw_amount skips it: sum amount or amount_usd')
  })

  it('serves no call tree', () => {
    expect(facts).toContain('The call depth, the call type and the parent frame are not served.')
    for (const callTree of ['call_type', 'call_depth', 'parent_call_index']) {
      expect(propertiesOf('TRANSFER')).not.toContain(callTree)
    }
  })

  it('says a TRANSFER row is one of three kinds, in the relationship table', () => {
    const row =
      sectionWith(read(GUIDE), 'Facts labels and relationships')
        .split('\n')
        .find((line) => line.startsWith('| `TRANSFER`')) ?? ''
    expect(plain(row)).toContain(
      'One transfer row: a token, a native or an internal native transfer, told by kind.'
    )
    expect(plain(row)).not.toMatch(/lists no internal/i)
  })
})

describe('every list of TRANSFER properties holds kind and only mapped properties', () => {
  const mapped = new Set(propertiesOf('TRANSFER'))

  function listed(text: string, marker: RegExp): string[] {
    const found = marker.exec(plain(text))
    expect(found, `no list of TRANSFER properties after ${marker}`).not.toBeNull()
    return (found?.[1] ?? '').match(/[a-z_]+/g) ?? []
  }

  const lists: [string, () => Promise<string>, RegExp][] = [
    ['the schema skill', async () => read(GUIDE), /TRANSFER properties include ([^.]*)\./],
    [
      'the served hints',
      async () => servedGraphHints(),
      /returns individual transfer rows[^.]*? with properties ([^.]*)\./,
    ],
    ['the runtime notes', () => runtimeSkill(), /with edge properties ([^.]*)\./],
  ]

  it.each(lists)('%s', async (_name, text, marker) => {
    const names = listed(await text(), marker).filter((word) => word !== 'and')
    expect(names).toContain('kind')
    expect(
      names.filter((name) => !mapped.has(name)),
      'a listed property the server does not map on TRANSFER'
    ).toEqual([])
  })
})

describe('the stale sentences are gone', () => {
  const STALE = [
    /lists the first group only/i,
    /no MCP read lists/i,
    /internal (?:native )?transfers[^.]*\byet\b/i,
    /\byet\b[^.]*internal (?:native )?transfers/i,
    /internal (?:native )?transfers have none/i,
    /lists no internal/i,
    /have none to read/i,
    /a pair can have a tx_count above 0 and no TRANSFER row/i,
  ]

  it('no shipped text, served hint or runtime note says an internal transfer is not listed', async () => {
    const homes: [string, string][] = [...new Set(SHIPPED_TEXT)].map(
      (path) => [path, read(path)] as [string, string]
    )
    homes.push(
      ['the served hints', servedGraphHints()],
      ['the runtime notes', await runtimeSkill()]
    )
    for (const [name, text] of homes) {
      const body = plain(text)
      for (const stale of STALE) expect(body, `${name} matches ${stale}`).not.toMatch(stale)
    }
  })
})

describe('the read of the internal rows is a read the server admits', () => {
  it('the schema skill shows it, and it names a pair, one day and the kind', () => {
    const queries = markdownQueries(read(GUIDE)).filter((query) => query.includes('t.kind'))
    expect(queries.length, 'the schema skill shows no read of t.kind').toBeGreaterThan(0)
    for (const raw of queries) {
      const query = flat(raw)
      expect(factsReadViolations(query), query).toEqual([])
      expect(query).toMatch(
        /\{address: "0x[0-9a-f]{40}"\}\)-\[t:TRANSFER\]->\(b:Address \{address: "0x[0-9a-f]{40}"\}\)/
      )
      expect(query).toMatch(/t\.block_date = "\d{4}-\d{2}-\d{2}"/)
      expect(query).toContain('t.kind = "internal"')
      expect(query).toMatch(/t\.kind AS kind/)
    }
  })
})
