import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { AddressCardDocument, LoadedAddressCard } from '../src/mcp/address-card.js'
import {
  ADDRESS_RISK_READING_RULE,
  AML_ADDRESS_RISK_ARGS,
  AML_ADDRESS_RISK_DESCRIPTION,
  AML_ADDRESS_RISK_SCHEMA,
  addressRiskFromMembers,
  addressRiskQueries,
  handleAmlAddressRisk,
  type AddressRiskDependencies,
  type AmlAddressRiskResult,
} from '../src/mcp/address-risk.js'
import type {
  ExchangeRegistryDocument,
  LoadedExchangeRegistry,
} from '../src/mcp/exchange-registry.js'
import { KNOWN_PUBLIC_TOOL_DESCRIPTIONS, LOCAL_TOOL_NAMES } from '../src/mcp/proxy.js'
import {
  HIDDEN_REMOTE_TOOL_NAMES,
  PUBLIC_MCP_TOOL_ALLOWED_ARGS,
} from '../src/mcp/tool-visibility.js'
import { repoRoot } from './dex-registry.js'

// aml_address_risk sends one batch of three reads anchored on the address and
// builds the answer from the packaged card dictionary and exchange lookup. No
// graph is reached: the batch answers are written here in the shape the graph
// server returns.

const card: LoadedAddressCard = {
  document: JSON.parse(
    readFileSync(join(repoRoot, 'registry', 'address-card.json'), 'utf8')
  ) as AddressCardDocument,
  source: 'packaged',
}
const exchanges: LoadedExchangeRegistry = {
  document: JSON.parse(
    readFileSync(join(repoRoot, 'registry', 'exchanges', 'robinhood.json'), 'utf8')
  ) as ExchangeRegistryDocument,
  source: 'packaged',
}

const SUBJECT = '0x31a817802ee183eb8b13167ffe24bd28dcc6f30c'
const BITGET_HOT = '0xed9ab5bc05a0152b9dc2f7902e8369af7bc18771'
const SCAMMER = '0x18aa00000000000000000000000000000000cb24'
const PLAIN = '0x9f0000000000000000000000000000000000071a'
const TOKEN = '0x766bd6598182586beda76414dc5f8deb1530a213'
const POOL = '0x4a0000000000000000000000000000000000ee02'
const ZERO = '0x0000000000000000000000000000000000000000'
const DEAD = '0x000000000000000000000000000000000000dead'
const FIRST = 1791000000000
const LAST = 1791500000000

type Batch = { network: string; queries: Array<{ id: string; query: string }> }

const deps = (members: unknown[], sent: Batch[] = []): AddressRiskDependencies => ({
  loadAddressCard: async () => card,
  loadExchangeRegistry: async () => exchanges,
  graphQueryBatch: async (batch) => {
    sent.push(batch)
    return { structuredContent: { facts: { queries: members } } }
  },
  describeFailure: (err) => (err as Error).message,
})

const call = async (members: unknown[], extra: Record<string, unknown> = {}, sent: Batch[] = []) => {
  const result = await handleAmlAddressRisk(
    { network: 'robinhood', address: SUBJECT.toUpperCase().replace('0X', '0x'), ...extra },
    deps(members, sent)
  )
  return { result, structured: result.structuredContent as unknown as AmlAddressRiskResult }
}

const nodeMember = (row: Record<string, unknown> | null) => ({
  id: 'node',
  ok: true,
  results: row ? [row] : [],
})
const rowsMember = (id: 'in' | 'out', rows: Record<string, unknown>[]) => ({ id, ok: true, results: rows })

const partner = (address: string, fields: Record<string, unknown> = {}) => ({
  address,
  node_labels: ['Address', 'Account'],
  identity: null,
  identity_name: null,
  evidence: null,
  judgements: null,
  risk_level: null,
  exchange_role: null,
  tokens_worth_usd: 120.5,
  tx_count: 3,
  first_seen_timestamp: FIRST,
  last_seen_timestamp: LAST,
  ...fields,
})

const SUBJECT_ROW = {
  node_labels: ['Address', 'Account'],
  card_version: '2',
  identity: null,
  identity_name: null,
  identities: [],
  address_roles: ['router'],
  behaviour: 'DEX_TRADER_BOT',
  evidence: ['victim'],
  judgements: ['suspect:FAKE_TOKEN_LP'],
  sources: ['rule'],
  risk_level: 'LOW',
  risk_score: 0.03,
  exchange_role: null,
}

const fullMembers = () => [
  nodeMember(SUBJECT_ROW),
  rowsMember('in', [
    partner(SCAMMER, { evidence: ['scam'], risk_level: 'LOW' }),
    partner(PLAIN),
    partner(TOKEN, { node_labels: ['Address', 'Contract', 'Token'] }),
    partner(ZERO),
  ]),
  rowsMember('out', [
    partner(BITGET_HOT, {
      node_labels: ['Address', 'Exchange'],
      identity: 'exchange',
      identity_name: 'bitget',
      exchange_role: 'hot_wallet',
      tokens_worth_usd: 900,
    }),
    partner(POOL, { node_labels: ['Address', 'Contract', 'Token', 'Pool'], risk_level: 'MEDIUM' }),
    partner(DEAD),
  ]),
]

const ANSWER_KEYS = [
  'schema',
  'tool',
  'network',
  'address',
  'found',
  'kind',
  'identity',
  'roles',
  'behaviour',
  'risk',
  'model',
  'exposure',
  'exchange_ends',
  'not_read',
]

describe('aml_address_risk', () => {
  it('sends one batch of three reads, each anchored on the lowercase address and bounded', async () => {
    const sent: Batch[] = []
    await call([nodeMember(null)], {}, sent)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.network).toBe('robinhood')
    expect(sent[0]!.queries).toEqual(addressRiskQueries(SUBJECT))
    expect(sent[0]!.queries.map((query) => query.id)).toEqual(['node', 'in', 'out'])
    for (const { query } of sent[0]!.queries) {
      expect(query).toMatch(new RegExp(`^USE topology MATCH .*\\(a:Address \\{address: "${SUBJECT}"\\}\\)`))
      expect(query).toMatch(/ LIMIT \d+$/)
    }
    expect(addressRiskQueries(SUBJECT, 'founder_').map((query) => query.id)).toEqual([
      'founder_node',
      'founder_in',
      'founder_out',
    ])
    expect(() => addressRiskQueries('0xABC')).toThrow('is not a lowercase 0x address')
  })

  it('an address the graph does not hold is not found and unscored', async () => {
    const { result, structured } = await call([nodeMember(null)])
    expect(result.isError).toBe(false)
    expect(Object.keys(structured)).toEqual(ANSWER_KEYS)
    expect(structured).toMatchObject({
      schema: AML_ADDRESS_RISK_SCHEMA,
      found: false,
      kind: 'unknown',
      identity: null,
      exposure: null,
      exchange_ends: [],
      not_read: [],
      risk: { word: 'unscored', set_by: 'none', score: null, reasons: [] },
      model: { level: 'not_scored', score: null, scored: false },
    })
    expect(JSON.parse(result.content[0]!.text)).toEqual(structured)
  })

  it('a full answer: the card, the word, the model, the risky partners and the exchange end', async () => {
    const { result, structured } = await call(fullMembers())
    expect(result.isError).toBe(false)
    expect(Object.keys(structured)).toEqual(ANSWER_KEYS)
    expect(structured).toMatchObject({
      address: SUBJECT,
      found: true,
      kind: 'account',
      identity: null,
      roles: ['router'],
      behaviour: 'DEX_TRADER_BOT',
      model: { level: 'low', score: 0.03, scored: true },
    })
    expect(structured.risk).toEqual({
      word: 'low',
      score: 0.03,
      rules_word: 'none',
      model_word: 'low',
      set_by: 'model',
      reasons: [
        expect.objectContaining({ word: 'victim', question: 'evidence' }),
        expect.objectContaining({ word: 'pattern', value: 'FAKE_TOKEN_LP', question: 'judgement' }),
        expect.objectContaining({ word: 'model', standing: 'predicted', level: 'low' }),
      ],
      unknown_words: [],
      card_version: '2',
    })
    expect(structured.exposure).toEqual({
      floor_usd: 1,
      counterparties_read: 4,
      left_out: 3,
      truncated: false,
      pattern_partners: 0,
      with_risk: [
        {
          address: SCAMMER,
          direction: 'sent_to_subject',
          risk_word: 'critical',
          set_by: 'rules',
          reasons: [expect.objectContaining({ word: 'scam', level: 'critical' })],
          tokens_worth_usd: 120.5,
          tx_count: 3,
          first_seen_utc: '2026-10-03 04:00:00 UTC',
          last_seen_utc: '2026-10-08 22:53:20 UTC',
        },
        expect.objectContaining({ address: POOL, risk_word: 'medium', set_by: 'model' }),
      ],
    })
    expect(structured.exchange_ends).toEqual([
      {
        address: BITGET_HOT,
        direction: 'received_from_subject',
        exchange: 'bitget',
        exchange_role: 'hot_wallet',
        tokens_worth_usd: 900,
        first_seen_utc: '2026-10-03 04:00:00 UTC',
        last_seen_utc: '2026-10-08 22:53:20 UTC',
      },
    ])
    expect(structured.not_read).toEqual([])
  })

  it('a risky partner never changes the address word', async () => {
    const quiet = [nodeMember({ ...SUBJECT_ROW, evidence: [], judgements: [], risk_level: null, risk_score: null })]
    const alone = await call([...quiet, rowsMember('in', []), rowsMember('out', [])])
    const exposed = await call([
      ...quiet,
      rowsMember('in', [partner(SCAMMER, { evidence: ['scam', 'sanctioned'] })]),
      rowsMember('out', []),
    ])
    expect(alone.structured.risk).toEqual(exposed.structured.risk)
    expect(exposed.structured.risk.word).toBe('unscored')
    expect(exposed.structured.exposure?.with_risk.map((entry) => entry.risk_word)).toEqual(['critical'])
  })

  it('a partner with only a pattern fact is counted, never listed as risky; a scam act is listed', async () => {
    const { structured } = await call([
      nodeMember(SUBJECT_ROW),
      rowsMember('in', [
        partner(PLAIN, { evidence: ['scam:FAKE_TOKEN_LP'] }),
        partner(SCAMMER, { evidence: ['scam:APPROVAL_DRAINER'], judgements: ['suspect:FAKE_TOKEN'] }),
      ]),
      rowsMember('out', [partner(POOL, { identities: ['dex', 'mixer'] })]),
    ])
    expect(structured.exposure?.with_risk.map((entry) => [entry.address, entry.risk_word])).toEqual([
      [SCAMMER, 'critical'],
      [POOL, 'high'],
    ])
    expect(structured.exposure?.pattern_partners).toBe(1)
    expect(JSON.stringify(structured)).not.toContain('suspect')
  })

  it('a partner read that fails is named as not read, and the answer still stands', async () => {
    const { result, structured } = await call([
      nodeMember(SUBJECT_ROW),
      { id: 'in', ok: false, error: 'query_timeout: the read took longer than 10 s' },
      rowsMember('out', [partner(PLAIN)]),
    ])
    expect(result.isError).toBe(false)
    expect(structured.not_read).toEqual([
      { part: 'senders', code: 'query_timeout', reason: 'query_timeout: the read took longer than 10 s' },
    ])
    expect(structured.exposure?.counterparties_read).toBe(1)
    const missing = await call([nodeMember(SUBJECT_ROW), { id: 'in', ok: false }])
    expect(missing.structured.not_read).toEqual([
      { part: 'senders', code: 'not_answered', reason: 'the in read did not answer' },
      { part: 'receivers', code: 'not_answered', reason: 'the out read is missing from the batch answer' },
    ])
  })

  it('a node read that fails is an error, never "no risk"', async () => {
    const { result } = await call([{ id: 'node', ok: false, error: 'memory_limit' }])
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('memory_limit')
    expect(result.content[0]!.text).toContain('This is not "no risk"')
    const empty = await call([])
    expect(empty.result.isError).toBe(true)
    expect(empty.result.content[0]!.text).toContain('the batch answer held no reads')
  })

  it('keeps 25 partners a direction and says when more exist', async () => {
    const rows = Array.from({ length: 26 }, (_, index) =>
      partner(`0x${(index + 1).toString(16).padStart(40, '0')}`)
    )
    const { structured } = await call([nodeMember(SUBJECT_ROW), rowsMember('in', rows), rowsMember('out', [])])
    expect(structured.exposure).toMatchObject({ counterparties_read: 25, truncated: true })
    const exact = await call([nodeMember(SUBJECT_ROW), rowsMember('in', rows.slice(0, 25)), rowsMember('out', [])])
    expect(exact.structured.exposure).toMatchObject({ counterparties_read: 25, truncated: false })
  })

  it('writes no hint, no summary and no verdict: the only prose is each reason sentence', async () => {
    const { structured } = await call(fullMembers(), { surroundings: true })
    expect(Object.keys(structured)).toEqual([...ANSWER_KEYS, 'surroundings'])
    const text = JSON.stringify(structured)
    expect(text).not.toMatch(/"(hint|summary|verdict|advice)"/)
    expect(text).not.toMatch(/\bsafe\b/i)
    expect(text).not.toContain('suspect')
  })

  it('carries surroundings only when asked, built from the rows already read', async () => {
    const without = await call(fullMembers())
    expect('surroundings' in without.structured).toBe(false)
    const { structured } = await call(fullMembers(), { surroundings: true })
    const surroundings = structured.surroundings!
    expect(surroundings.truncated).toBe(false)
    expect(surroundings.nodes.map((node) => [node.address, node.role, node.kind, node.risk_word])).toEqual([
      [SUBJECT, 'subject', 'account', 'low'],
      [SCAMMER, 'partner', 'account', 'critical'],
      [PLAIN, 'partner', 'account', 'unscored'],
      [BITGET_HOT, 'exchange_end', 'unknown', 'unscored'],
      [POOL, 'partner', 'pool', 'medium'],
    ])
    expect(surroundings.nodes[3]!.name).toBe('bitget')
    const listed = new Set(surroundings.nodes.map((node) => node.address))
    expect(surroundings.links).toHaveLength(4)
    for (const link of surroundings.links) {
      expect(listed.has(link.from_address) && listed.has(link.to_address)).toBe(true)
      expect(link.link).toBe('FLOWED_TO')
    }
    expect(surroundings.links[0]).toEqual({
      from_address: SCAMMER,
      to_address: SUBJECT,
      link: 'FLOWED_TO',
      tokens_worth_usd: 120.5,
      first_seen_utc: '2026-10-03 04:00:00 UTC',
      last_seen_utc: '2026-10-08 22:53:20 UTC',
    })
    expect(surroundings.links[2]).toMatchObject({ from_address: SUBJECT, to_address: BITGET_HOT })
    const unknown = await call([nodeMember(null)], { surroundings: true })
    expect(unknown.structured.surroundings).toEqual({
      nodes: [
        { address: SUBJECT, role: 'subject', kind: 'unknown', name: null, risk_word: 'unscored', model_level: 'not_scored' },
      ],
      links: [],
      truncated: false,
    })
  })

  it('builds the answer of a prefixed address in a larger batch', () => {
    const members = new Map(
      fullMembers().map((member) => [`founder_${member.id}`, { ...member, id: `founder_${member.id}` }])
    )
    const built = addressRiskFromMembers('robinhood', SUBJECT, members, card.document.words, [], 'founder_')
    expect('result' in built && built.result.risk.word).toBe('low')
    // An exchange wallet the lookup does not list is named from its card.
    expect('result' in built && built.result.exchange_ends[0]!.exchange).toBe('bitget')
    expect(addressRiskFromMembers('robinhood', SUBJECT, new Map(), [], [])).toEqual({
      failure: 'the node read is missing from the batch answer',
    })
  })

  it('refuses a bad argument before any read', async () => {
    for (const args of [
      { network: 'robinhood', address: 'Bitget' },
      { network: 'robinhood' },
      { network: '', address: SUBJECT },
      { network: 'robinhood', address: SUBJECT, surroundings: 'yes' },
    ]) {
      const sent: Batch[] = []
      const result = await handleAmlAddressRisk(args, deps([], sent))
      expect(result.isError).toBe(true)
      expect(sent).toEqual([])
    }
    const named = await handleAmlAddressRisk({ network: 'robinhood', address: 'CIA' }, deps([]))
    expect(named.content[0]!.text).toContain('invalid_address')
  })

  it('sends no read when the graph is down or the dictionary is missing; names no exchange when the lookup fails', async () => {
    const sent: Batch[] = []
    const down = await handleAmlAddressRisk(
      { network: 'robinhood', address: SUBJECT },
      { ...deps([], sent), unavailable: () => 'the graph is not connected.' }
    )
    expect(down.isError).toBe(true)
    expect(down.content[0]!.text).toContain('the graph is not connected.')
    const noCard = await handleAmlAddressRisk(
      { network: 'robinhood', address: SUBJECT },
      { ...deps([], sent), loadAddressCard: async () => null }
    )
    expect(noCard.isError).toBe(true)
    expect(noCard.content[0]!.text).toContain('address card dictionary did not load')
    expect(sent).toEqual([])
    const thrown = await handleAmlAddressRisk(
      { network: 'robinhood', address: SUBJECT },
      {
        ...deps(fullMembers()),
        graphQueryBatch: async () => {
          throw new Error('payment required')
        },
      }
    )
    expect(thrown.content[0]!.text).toContain('payment required')
    const noLookup = await handleAmlAddressRisk(
      { network: 'robinhood', address: SUBJECT },
      {
        ...deps(fullMembers()),
        loadExchangeRegistry: async () => {
          throw new Error('offline')
        },
      }
    )
    expect(noLookup.isError).toBe(false)
  })

  it('is a listed local tool with its arguments, and its description tells the host how to judge', () => {
    expect(HIDDEN_REMOTE_TOOL_NAMES.has('aml_address_risk')).toBe(false)
    expect(HIDDEN_REMOTE_TOOL_NAMES.has('address_risk')).toBe(true)
    expect(LOCAL_TOOL_NAMES.has('aml_address_risk')).toBe(true)
    expect(PUBLIC_MCP_TOOL_ALLOWED_ARGS['aml_address_risk']).toEqual([...AML_ADDRESS_RISK_ARGS])
    expect(KNOWN_PUBLIC_TOOL_DESCRIPTIONS['aml_address_risk']).toBe(AML_ADDRESS_RISK_DESCRIPTION)
    expect(AML_ADDRESS_RISK_DESCRIPTION).toContain(ADDRESS_RISK_READING_RULE)
    for (const term of ['rules_word', 'model_word', 'unscored', 'set_by', 'not_read', 'in full']) {
      expect(AML_ADDRESS_RISK_DESCRIPTION).toContain(term)
    }
  })
})
