import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { addressRisk, type RouteEvidence } from '../src/investigation/public-tools.js'

// AC8 fixture-backed acceptance (devkit-gated): runs the REAL
// aml_address_risk flow against the devkit graph stack and asserts the
// structured route evidence on the deterministic fixture — real response
// path shapes, not synthetic helper inputs. Requires the devkit compose
// up (docker compose -f devkit/docker-compose.yml up -d) and
// CAPABILITY_PROBES=1.
const enabled = process.env.CAPABILITY_PROBES === '1'
const endpoint = process.env.CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT ?? 'http://127.0.0.1:18012/mcp'
const repoRoot = resolve(__dirname, '..')

function fixturePair(): { seed: string; peer: string } {
  // Same derivation as devkit/scripts/smoke-chain-insights-parity.sh:
  // first flow edge whose endpoints both resolve to SS58 member addresses.
  const identityRows = readFileSync(join(repoRoot, 'devkit/data/memgraph/identity_addresses.csv'), 'utf8')
    .split('\n')
    .slice(1)
  const address = new Map<string, string>()
  for (const row of identityRows) {
    const [identity, member] = row.replace(/\r/g, '').split(',')
    if (identity && member?.startsWith('5')) address.set(identity, member)
  }
  const flowRows = readFileSync(join(repoRoot, 'devkit/data/memgraph/flows.csv'), 'utf8')
    .split('\n')
    .slice(1)
  for (const row of flowRows) {
    const [from, to] = row.replace(/\r/g, '').split(',')
    if (from && to && address.has(from) && address.has(to)) {
      return { seed: address.get(from)!, peer: address.get(to)! }
    }
  }
  throw new Error('no connected fixture pair found')
}

describe.skipIf(!enabled)('route evidence against devkit fixture (AC8)', () => {
  it('aml_address_risk returns the known fixture route with disclosure fields', { timeout: 180_000 }, async () => {
    const { seed, peer } = fixturePair()
    const client = new Client({ name: 'route-evidence-devkit-test', version: '0.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))
    try {
      const result = await addressRisk(client, {
        address: seed,
        network: 'bittensor',
        compareAddress: peer,
        topologyScope: 'live_topology',
      })
      const structured = result.structuredContent as { facts?: Record<string, unknown> }
      const facts = (structured.facts ?? {}) as Record<string, unknown>
      const connection = facts['connection'] as
        | { compare_address: string; paths: unknown[]; route_evidence?: RouteEvidence }
        | undefined
      expect(connection, 'connection block missing').toBeDefined()
      // Additive contract: legacy keys survive.
      expect(connection!.compare_address).toBe(peer)
      expect(Array.isArray(connection!.paths)).toBe(true)
      // Route evidence: the fixture pair is a direct flow edge, so the
      // known shortest route is exactly 1 hop seed -> peer.
      const evidence = connection!.route_evidence
      expect(evidence, 'route_evidence missing on live scope').toBeDefined()
      expect(evidence!.search_strategy).toBe('any_shortest')
      expect(evidence!.route_rank_basis).toBe('hop_count')
      expect(evidence!.depth_bound).toBe(4)
      expect(evidence!.route_found).toBe(true)
      expect(evidence!.outbound).not.toBeNull()
      expect(evidence!.outbound!.hops).toBe(1)
      expect(evidence!.outbound!.identities).toEqual([seed, peer])
      expect(Array.isArray(evidence!.outbound!.exchange_intermediates)).toBe(true)
      expect(evidence!.outbound!.amount_usd_sum_total).toBeGreaterThan(0)
    } finally {
      await client.close()
    }
  })
})
