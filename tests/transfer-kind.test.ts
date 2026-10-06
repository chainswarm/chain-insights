import { describe, expect, it } from 'vitest'

import { propertiesOf } from './support/facts-columns.js'
import { flat, markdownFiles, read, runtimeSkill, servedGraphHints } from './support/schema-text.js'

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

const CYPHER = 'skills/chain-insights-cypher/SKILL.md'
const TOOLS = 'docs/graph-tools.md'
const COMPAT = 'docs/graph-query-compatibility.md'

// The two guides are the homes of the kind of a row. The cypher skill is short: it
// lists the TRANSFER columns with the three kinds in one line, and the list is held
// to the server's columns below.
const GUIDE_HOMES = [TOOLS, COMPAT] as const

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

describe('the pinned TRANSFER row', () => {
  it('serves no call tree', () => {
    for (const callTree of ['call_type', 'call_depth', 'parent_call_index']) {
      expect(propertiesOf('TRANSFER')).not.toContain(callTree)
    }
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
    [
      'the cypher skill',
      async () => read(CYPHER),
      /TRANSFER columns: ([^.]*)\. kind is token, native or internal/,
    ],
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
