// Regression guard for chain-insights#228: several network views share ONE
// address-grain topology graph, and the `network` argument selects the GRAPH,
// not the subset of addresses inside it. Every `USE topology` query that
// matches `:Address` must therefore carry an `Address.network` predicate, or
// each network's sweep returns identical, wrong-network findings.
import { describe, expect, it } from 'vitest'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { networkPredicate } from '../../src/detection/graph-client.js'
import { attackAttributionDetector } from '../../src/detection/detectors/attack-attribution.js'
import { mixerDetector, mixerScanCandidates } from '../../src/detection/detectors/mixer.js'
import { addressPoisoningDetector } from '../../src/detection/detectors/address-poisoning.js'
import { fakeTokenDetector } from '../../src/detection/detectors/fake-token.js'
import type { DetectionWindow } from '../../src/detection/runtime.js'

const WINDOW: DetectionWindow = { fromTimestamp: 0, toTimestamp: Date.parse('2026-07-26T00:00:00Z'), full: true }

// recordingClient captures every emitted graph_query and replays canned rows so
// a detector's walk terminates without a live graph.
function recordingClient(rowsFor: (query: string) => unknown[] = () => []): {
  client: Client
  queries: string[]
} {
  const queries: string[] = []
  const client = {
    async callTool(req: { name: string; arguments?: Record<string, unknown> }) {
      const query = String(req.arguments?.query ?? '')
      queries.push(query)
      return { structuredContent: { facts: { query: { results: rowsFor(query) } } } }
    },
  } as unknown as Client
  return { client, queries }
}

const topologyAddressQueries = (queries: string[]): string[] =>
  queries.filter((q) => q.includes('USE topology') && q.includes(':Address'))

describe('networkPredicate', () => {
  it('builds an alias-qualified network predicate', () => {
    expect(networkPredicate('a', 'bittensor_evm')).toBe('a.network = "bittensor_evm"')
  })
  // The value interpolates into Cypher (graph_query binds no parameters), so it
  // is validated to a strict identifier charset instead of hand-escaped.
  it('rejects a network identifier that could break out of the query', () => {
    expect(() => networkPredicate('a', 'bittensor" OR true OR "')).toThrow(/unsafe network identifier/)
    expect(() => networkPredicate('a', '')).toThrow(/unsafe network identifier/)
    expect(() => networkPredicate('a"', 'bittensor')).toThrow(/unsafe query alias/)
  })
})

describe('attack-attribution scopes its topology queries by network', () => {
  it('scopes the seed pull', async () => {
    const { client, queries } = recordingClient()
    await attackAttributionDetector.scan(WINDOW, client, 'bittensor_evm', {})
    expect(queries).toHaveLength(1)
    expect(queries[0]).toContain('a.network = "bittensor_evm"')
    // The label disjunction must stay parenthesised, or AND/OR precedence would
    // silently drop the network scope for every label after the first.
    expect(queries[0]).toContain('AND (a:Scam)')
  })

  it('scopes both endpoints of the frontier expansion', async () => {
    const seed = '5Df97gT4omdxrwckBKs2AekbBB66fDNA6VRKR46J2iSmJGgd'
    const { client, queries } = recordingClient((q) =>
      q.includes('FLOWS_TO') ? [] : [{ address: seed }],
    )
    await attackAttributionDetector.scan(WINDOW, client, 'bittensor', {})
    const frontier = queries.filter((q) => q.includes('FLOWS_TO'))
    expect(frontier.length).toBeGreaterThan(0)
    for (const q of frontier) {
      expect(q).toContain('a.network = "bittensor"')
      expect(q).toContain('b.network = "bittensor"')
    }
  })

  it('emits different queries for the two views of the shared graph', async () => {
    const ss58 = recordingClient()
    await attackAttributionDetector.scan(WINDOW, ss58.client, 'bittensor', {})
    const evm = recordingClient()
    await attackAttributionDetector.scan(WINDOW, evm.client, 'bittensor_evm', {})
    expect(ss58.queries[0]).not.toBe(evm.queries[0])
  })
})

describe('mixer scopes its candidate enumeration by network', () => {
  it('scopes the degree-qualified batch scan', async () => {
    const { client, queries } = recordingClient()
    await mixerDetector.scan(WINDOW, client, 'bittensor_evm', {})
    expect(topologyAddressQueries(queries).length).toBeGreaterThan(0)
    for (const q of topologyAddressQueries(queries)) {
      expect(q).toContain('a.network = "bittensor_evm"')
    }
  })

  // Deliberate exception: the address-anchored interactive path names an exact
  // address, which is already unique in the shared graph. Scoping it would
  // fail-closed on EVM addresses screened under the chain's primary network
  // name, which is the documented interactive contract.
  it('leaves the address-anchored candidate lookup unscoped', async () => {
    const { client, queries } = recordingClient()
    await mixerScanCandidates(client, 'bittensor', ['0x2fe67cd01e3a05f116678c05289cd61d7d484d3d'])
    expect(queries[0]).toContain('{address: "0x2fe67cd01e3a05f116678c05289cd61d7d484d3d"}')
    expect(queries[0]).not.toContain('a.network =')
  })
})

// The facts-backed detectors route to a per-network database, and the facts
// `Address` label maps no `network` property — adding a predicate there would
// fail the query outright. Assert they stay off `USE topology` entirely.
describe('facts-backed detectors need no Address.network predicate', () => {
  it('address-poisoning reads only USE facts and adds no network predicate', async () => {
    const { client, queries } = recordingClient()
    await addressPoisoningDetector.scan(WINDOW, client, 'bittensor_evm', {})
    expect(queries.length).toBeGreaterThan(0)
    for (const q of queries) {
      expect(q).toContain('USE facts')
      expect(q).not.toContain('.network =')
    }
  })

  it('fake-token reads the USE facts Asset registry, not Address nodes', async () => {
    const { client, queries } = recordingClient()
    await fakeTokenDetector.scan(WINDOW, client, 'bittensor_evm', {})
    expect(queries.length).toBeGreaterThan(0)
    for (const q of queries) {
      expect(q).toContain('USE facts')
      expect(q).toContain('(t:Asset)')
      expect(q).not.toContain(':Address')
    }
  })
})
