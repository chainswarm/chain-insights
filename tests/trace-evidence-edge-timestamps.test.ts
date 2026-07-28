import { describe, expect, it, vi } from 'vitest'
import { traceVictimFunds } from '../src/investigation/public-tools.js'

// The chain-insights.trace.v1 evidence edges[] must carry the FLOWS_TO edge
// timestamps (epoch ms) projected from the traced hop rows — computeVerdict
// in the monitor render layer dates ACTIVE/DORMANT off exactly these fields.

type BatchQuery = { id: string; query: string }

const config = { dataDir: '/tmp/ci-test', serverPort: 4321 }

const SEED = '5VictimSeedAddress'
const HOP = '5IntermediateAddr'
const EXCH = '5ExchangeAddr'

const FIRST_MS = 1_752_000_000_000
const LAST_MS = 1_753_400_000_000

function edgeObject(first: number, last: number): Record<string, unknown> {
  // Serialized graph edge: fields nested under `properties`.
  return {
    properties: {
      amount_usd_sum: 100,
      tx_count: 3,
      first_seen_timestamp: first,
      last_seen_timestamp: last,
      first_tx_id: 'tx-first',
      last_tx_id: 'tx-last',
    },
  }
}

function client() {
  return {
    callTool: vi.fn(async (req: { name: string; arguments: { queries?: BatchQuery[] } }) => {
      if (req.name === 'network_capabilities') {
        return { content: [{ type: 'text', text: JSON.stringify({ networks: [] }) }], isError: false }
      }
      const queries = (req.arguments.queries ?? []).map((q) => {
        if (q.id.startsWith('seed_address_exists_')) return { id: q.id, ok: true, results: [{ address: SEED }] }
        if (q.id === 'forward_exchange_paths_2') {
          return {
            id: q.id,
            ok: true,
            results: [{
              addresses: [SEED, HOP, EXCH],
              node_labels: [[], [], ['exchange']],
              path_nodes: [
                { address: SEED },
                { address: HOP },
                { address: EXCH, is_exchange: true, labels: ['exchange'] },
              ],
              edge_props: [edgeObject(FIRST_MS, LAST_MS - 1000), edgeObject(FIRST_MS + 1000, LAST_MS)],
              exchange_address: EXCH,
              exchange_labels: ['exchange'],
              exchange_is_exchange: true,
              deposit_address: HOP,
              hops: 2,
            }],
          }
        }
        return { id: q.id, ok: true, results: [] }
      })
      return { content: [{ type: 'text', text: JSON.stringify({ facts: { queries } }) }], isError: false }
    }),
  }
}

describe('trace.v1 evidence edges carry FLOWS_TO timestamps', () => {
  it('projects first/last_seen_timestamp (ms) onto every evidence edge', async () => {
    const result = await traceVictimFunds(client() as never, config, {
      victimAddresses: SEED,
      network: 'bittensor',
      writeArtifacts: false,
    })
    const content = result.structuredContent as {
      edges: Array<{ from_address: string; to_address: string; first_seen_timestamp?: number; last_seen_timestamp?: number }>
    }
    expect(content.edges.length).toBeGreaterThan(0)
    const hop1 = content.edges.find((e) => e.from_address === SEED && e.to_address === HOP)
    const hop2 = content.edges.find((e) => e.from_address === HOP && e.to_address === EXCH)
    expect(hop1?.first_seen_timestamp).toBe(FIRST_MS)
    expect(hop1?.last_seen_timestamp).toBe(LAST_MS - 1000)
    expect(hop2?.first_seen_timestamp).toBe(FIRST_MS + 1000)
    expect(hop2?.last_seen_timestamp).toBe(LAST_MS)
  })

  it('omits the fields when source rows lack timestamps', async () => {
    const bare = {
      callTool: vi.fn(async (req: { name: string; arguments: { queries?: BatchQuery[] } }) => {
        if (req.name === 'network_capabilities') {
          return { content: [{ type: 'text', text: JSON.stringify({ networks: [] }) }], isError: false }
        }
        const queries = (req.arguments.queries ?? []).map((q) => {
          if (q.id.startsWith('seed_address_exists_')) return { id: q.id, ok: true, results: [{ address: SEED }] }
          if (q.id === 'forward_exchange_paths_1') {
            return {
              id: q.id,
              ok: true,
              results: [{
                addresses: [SEED, EXCH],
                node_labels: [[], ['exchange']],
                path_nodes: [{ address: SEED }, { address: EXCH, is_exchange: true, labels: ['exchange'] }],
                edge_props: [{ properties: { amount_usd_sum: 5 } }],
                exchange_address: EXCH,
                exchange_is_exchange: true,
                deposit_address: SEED,
                hops: 1,
              }],
            }
          }
          return { id: q.id, ok: true, results: [] }
        })
        return { content: [{ type: 'text', text: JSON.stringify({ facts: { queries } }) }], isError: false }
      }),
    }
    const result = await traceVictimFunds(bare as never, config, {
      victimAddresses: SEED,
      network: 'bittensor',
      writeArtifacts: false,
    })
    const content = result.structuredContent as { edges: Array<Record<string, unknown>> }
    expect(content.edges.length).toBeGreaterThan(0)
    for (const edge of content.edges) {
      expect(edge['first_seen_timestamp']).toBeUndefined()
      expect(edge['last_seen_timestamp']).toBeUndefined()
    }
  })
})
