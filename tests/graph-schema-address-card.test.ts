import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ADDRESS_CARD_RULE,
  addressCardFault,
  addressCardUrl,
  loadAddressCard,
  type AddressCardDocument,
} from '../src/mcp/address-card.js'
import { META_SCHEMA_DESCRIPTION, handleMetaSchema, type GraphSchemaClient } from '../src/mcp/graph-schema.js'
import { flat, read } from './support/schema-text.js'

// meta_schema lists the address card dictionary of registry/address-card.json:
// every card property with its type, question, meaning and closed values, every
// mark and every flag with the words that give it, and the one rule. The file
// is generated from the label vocabulary; these tests read it and compare, they
// hold no second copy of its lists.

const card = JSON.parse(read('registry/address-card.json')) as AddressCardDocument

type Reply = { structuredContent: Record<string, unknown> }
const recorded = JSON.parse(read('tests/fixtures/graph-schema-replies-20261006.json')) as {
  replies: Record<string, Reply>
}

const client: GraphSchemaClient = {
  async callTool(request) {
    const key = request.name === 'graph_query' ? String(request.arguments['query']) : request.name
    const reply = recorded.replies[key]
    if (!reply) throw new Error(`no recorded reply for ${key}`)
    return {
      content: [{ type: 'text', text: JSON.stringify(reply.structuredContent) }],
      structuredContent: reply.structuredContent,
    }
  },
}

const offline = (async () => {
  throw new Error('connect ECONNREFUSED')
}) as typeof fetch

function answering(body: string, status = 200) {
  const calls: string[] = []
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push(String(url))
    return new Response(body, { status })
  }) as typeof fetch
  return { calls, fetchImpl }
}

describe('the address card in meta_schema', () => {
  let home = ''
  let previousHome: string | undefined
  const lines: string[] = []
  const log = (line: string) => lines.push(line)

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ci-address-card-'))
    previousHome = process.env['HOME']
    process.env['HOME'] = home
    lines.length = 0
  })

  afterEach(async () => {
    if (previousHome === undefined) delete process.env['HOME']
    else process.env['HOME'] = previousHome
    await rm(home, { recursive: true, force: true })
  })

  const deps = (fetchImpl: typeof fetch) => ({
    endpoint: 'https://mcp.example.test/',
    now: () => new Date('2026-11-20T09:00:00.000Z'),
    withClient: <T>(fn: (client: GraphSchemaClient) => Promise<T>) => fn(client),
    describeFailure: (err: unknown) => `MCP call failed: ${(err as Error).message}`,
    loadAddressCard: () => loadAddressCard({ fetch: fetchImpl, log }),
  })

  it('the packaged file passes its own rules, and the rule is the one the code carries', () => {
    expect(addressCardFault(card)).toBeNull()
    expect(card.rule).toBe(ADDRESS_CARD_RULE)
  })

  it('refuses a dictionary whose words are missing or malformed, so the packaged copy answers', () => {
    const word = { word: 'scam', question: 'evidence', level: 'critical', plain: 'A sentence.' }
    const faults = [
      [undefined, 'words is not a list'],
      [[], 'words is not a list'],
      [['scam'], 'words[0] is not an object'],
      [[{ ...word, word: '' }], 'words[0] has no word'],
      [[{ ...word, question: '' }], 'words[0] (scam) has no question'],
      [[{ ...word, level: 'severe' }], 'words[0] (scam) level is not one of none, low, medium, high, critical'],
      [[{ ...word, plain: ' ' }], 'words[0] (scam) has no plain sentence'],
      [[{ ...word, value: '' }], 'words[0] (scam) value is empty'],
      [[{ ...word, standing: '' }], 'words[0] (scam) standing is empty'],
    ] as const
    for (const [words, fault] of faults) {
      expect(addressCardFault({ ...card, words })).toBe(fault)
    }
    expect(addressCardFault({ ...card, words: [word] })).toBeNull()
  })

  it('carries the rule of the file word for word in the tool description', () => {
    expect(META_SCHEMA_DESCRIPTION).toContain(card.rule)
    expect(META_SCHEMA_DESCRIPTION.length).toBeLessThan(700)
  })

  it('lists every property, mark and flag of the file with the file values', async () => {
    const result = await handleMetaSchema({ network: 'robinhood' }, deps(offline))
    expect(result.isError).toBe(false)

    const served = result.structuredContent?.['address_card'] as Record<string, unknown>
    expect(served).toMatchObject({
      file: 'registry/address-card.json',
      version: card.version,
      source: 'packaged',
      rule: card.rule,
    })
    expect(served['properties']).toEqual(card.properties)
    expect(served['marks']).toEqual(card.marks)
    expect(served['flags']).toEqual(card.flags)

    // The text for the model: one line per property, mark and flag.
    const text = result.content[0]!.text
    expect(text).toContain(`Rule: ${card.rule}`)
    const textLines = text.split('\n')
    for (const property of card.properties) {
      const line = textLines.find((entry) => entry.startsWith(`- ${property.name} (`))
      expect(line, `no line for ${property.name}`).toBeDefined()
      expect(line).toContain(`${property.type}, question ${property.question}`)
      expect(line).toContain(property.means)
      if (property.values) expect(line).toContain(`Values: ${property.values.join(', ')}.`)
      if (property.value_form) expect(line).toContain(`entries ${property.value_form}`)
    }
    for (const mark of [...card.marks, ...card.flags]) {
      expect(textLines).toContain(`- ${mark.name} (question ${mark.question}): ${mark.words.join(', ')}`)
    }
    // The existing sections keep their order; the card comes after USE chain.
    expect(text.indexOf('USE chain')).toBeLessThan(text.indexOf('Address card, on every :Address node'))
    expect(text).not.toMatch(/not (supported|served)/i)
  })

  it('reads the public file on main and answers from the cache for an hour', async () => {
    expect(addressCardUrl({})).toBe(
      'https://raw.githubusercontent.com/chainswarm/chain-insights/main/registry/address-card.json'
    )
    const { calls, fetchImpl } = answering(JSON.stringify(card))
    const first = await loadAddressCard({ fetch: fetchImpl, log, now: () => 1_000 })
    expect(first?.source).toBe('fetched')
    const again = await loadAddressCard({ fetch: fetchImpl, log, now: () => 2_000 })
    expect(again?.source).toBe('cached')
    expect(calls).toHaveLength(1)
    expect(lines).toEqual([])
  })

  it('refuses a malformed fetched file with one line and answers from the packaged copy', async () => {
    const broken = { ...card, properties: [{ name: 'identity' }] }
    const { fetchImpl } = answering(JSON.stringify(broken))
    const result = await handleMetaSchema({ network: 'robinhood' }, deps(fetchImpl))

    const served = result.structuredContent?.['address_card'] as { source: string; properties: unknown }
    expect(served.source).toBe('packaged')
    expect(served.properties).toEqual(card.properties)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('is malformed: properties[0] (identity) has no type')
  })

  it('still answers the schema, with a note, when the card cannot be read', async () => {
    const result = await handleMetaSchema(
      { network: 'robinhood' },
      {
        ...deps(offline),
        loadAddressCard: async () => {
          throw new Error('the packaged registry/address-card.json is malformed: rule is missing')
        },
      }
    )
    expect(result.isError).toBe(false)
    expect(result.structuredContent?.['address_card']).toBeUndefined()
    expect(result.content[0]!.text).toContain(
      '- The address card dictionary could not be read: the packaged registry/address-card.json is malformed: rule is missing'
    )
  })

  it('is taught by the cypher skill with the same rule and every property', () => {
    const skill = read('skills/chain-insights-cypher/SKILL.md')
    const section = /\n## The address card\n([\s\S]*?)(?=\n## )/.exec(skill)?.[1] ?? ''
    expect(section, 'the cypher skill has no "The address card" section').not.toBe('')
    expect(flat(section)).toContain(card.rule)
    for (const property of card.properties) {
      expect(section, `the skill misses ${property.name}`).toContain(`\`${property.name}\``)
    }
  })
})
