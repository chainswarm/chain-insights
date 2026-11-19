import { describe, expect, it } from 'vitest'

import {
  BEHAVIOUR_HINT,
  BEHAVIOUR_KINDS,
  BEHAVIOUR_RULE,
  BEHAVIOUR_SCHEMA_NOTE,
  GRAPH_QUERY_BEHAVIOUR_SENTENCE,
} from '../src/mcp/behaviour-kinds.js'
import { KNOWN_PUBLIC_TOOL_DESCRIPTIONS } from '../src/mcp/proxy.js'
import { flat, read, servedGraphHints } from './support/schema-text.js'

// A busy account carries behaviour_kind, how it behaves by a rule over one
// week of its own counts, and behaviour_group, its operator group. Every host
// must say the kind in plain words and never as an accusation: Claude Desktop
// chat reads only the graph_query description, the skill hosts read the
// cypher skill (and meta_rules serves it), the others the server
// instructions.

// The seven kinds the labeler writes (labeler data:behaviour-rule).
const KINDS = [
  'SWAP_BOT_FARM_WALLET',
  'DEX_TRADER_BOT',
  'VOLUME_RING_HUB',
  'WALLET_FARM_CONTROLLER',
  'FIXED_AMOUNT_DISTRIBUTOR',
  'MIXER_LOOP_HUB',
  'PAYOUT_DESK',
]
const CODE = /\b[A-Z]{2,}(?:_[A-Z]+)+\b|behaviour_kind|behaviour_group/

describe('the behaviour kinds and the operator group', () => {
  const skill = read('skills/chain-insights-cypher/SKILL.md')
  const section =
    skill
      .split('### Behaviour kinds: busy accounts and their operator groups\n')[1]
      ?.split(/\n##+ /)[0] ?? ''

  it('are the seven kinds the labeler writes, each with plain words and no code', () => {
    expect(BEHAVIOUR_KINDS.map((kind) => kind.value)).toEqual(KINDS)
    for (const kind of BEHAVIOUR_KINDS) {
      expect(kind.plain, kind.value).not.toMatch(CODE)
      expect(kind.plain.length, kind.value).toBeGreaterThan(30)
    }
  })

  it('reach Claude Desktop chat through the graph_query description, with the rule', () => {
    const description = KNOWN_PUBLIC_TOOL_DESCRIPTIONS['graph_query'] ?? ''
    expect(description).toContain(GRAPH_QUERY_BEHAVIOUR_SENTENCE)
    expect(description).toContain(BEHAVIOUR_RULE)
    for (const kind of BEHAVIOUR_KINDS) {
      expect(description, kind.value).toContain(`${kind.value} (${kind.plain})`)
    }
    for (const name of ['behaviour_kind', 'behaviour_group']) expect(description).toContain(name)
  })

  it('are taught by the served hints, meta_schema, the skill section and the guides', () => {
    expect(servedGraphHints().split('\n')).toContain(BEHAVIOUR_HINT)
    expect(BEHAVIOUR_SCHEMA_NOTE).toContain(BEHAVIOUR_RULE)
    expect(section, 'the skill has no Behaviour kinds section').not.toBe('')
    expect(flat(section)).toContain(BEHAVIOUR_RULE)
    const guide = read('docs/graph-tools.md')
    expect(flat(guide)).toContain(BEHAVIOUR_RULE)
    for (const kind of BEHAVIOUR_KINDS) {
      expect(BEHAVIOUR_SCHEMA_NOTE, kind.value).toContain(kind.value)
      // The skill's table row says the plain words beside the constant.
      expect(section, `skill misses ${kind.value}`).toContain(
        `| \`${kind.value}\` | ${kind.plain} |`
      )
      expect(guide, `graph-tools misses ${kind.value}`).toContain(`\`${kind.value}\``)
    }
  })

  it('say the kind is a counted fact, no guess and no accusation, and a mixer loop no laundering proof', () => {
    const said = flat(section)
    expect(said).toContain("not a model's guess: never call it inferred")
    expect(said).toContain('A trader bot is no scammer.')
    expect(said).toContain(
      '`MIXER_LOOP_HUB` is a pattern of payments around a mixer, not proof of laundering.'
    )
    expect(GRAPH_QUERY_BEHAVIOUR_SENTENCE).toContain('never call it inferred')
    expect(GRAPH_QUERY_BEHAVIOUR_SENTENCE).toContain(
      'MIXER_LOOP_HUB is a pattern of payments around a mixer, not proof of laundering.'
    )
    expect(GRAPH_QUERY_BEHAVIOUR_SENTENCE).toContain('never the constant alone')
  })

  it('read the group anchored on an address, never by a property scan', () => {
    const queries = [...section.matchAll(/```cypher\n([\s\S]*?)```/g)].map((m) =>
      (m[1] ?? '').replace(/\s+/g, ' ').trim()
    )
    expect(queries).toHaveLength(3)
    for (const query of queries) {
      expect(query, query).toMatch(
        /^USE topology MATCH \(\w+:Address \{address: "0x[0-9a-f]{40}"\}\)/
      )
      expect(query, query).toMatch(/ LIMIT \d+$/)
    }
    // The members read is anchored on the first payer that the group names.
    const members = queries.find((query) => query.includes('b.behaviour_group = '))
    const payer = /behaviour_group = "[A-Z_]+:(0x[0-9a-f]{40})"/.exec(members ?? '')?.[1]
    expect(members).toContain(`MATCH (p:Address {address: "${payer}"})`)
    // An exchange wallet, a pool or a protocol contract as first payer is no operator.
    expect(flat(section)).toContain('the group is the accounts it funded first, not one operator')
    expect(GRAPH_QUERY_BEHAVIOUR_SENTENCE).toContain(
      'the group is the accounts it funded first, not one operator'
    )
  })
})
