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

  it('discloses exchange intermediates on a real fixture route (never filters)', { timeout: 300_000 }, async () => {
    const client = new Client({ name: 'route-evidence-devkit-test-2', version: '0.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))
    const rows = async (query: string): Promise<Array<Record<string, unknown>>> => {
      const result = (await client.callTool({
        name: 'graph_query',
        arguments: { network: 'bittensor', query },
      })) as { content?: Array<{ type: string; text?: string }> }
      const text = result.content?.find((c) => c.type === 'text')?.text ?? '{}'
      const parsed = JSON.parse(text) as Record<string, unknown>
      const found = (function walk(node: unknown): Array<Record<string, unknown>> | null {
        if (Array.isArray(node)) return node.every((r) => r && typeof r === 'object') ? (node as Array<Record<string, unknown>>) : null
        if (node && typeof node === 'object') {
          for (const key of ['results', 'rows']) {
            const candidate = (node as Record<string, unknown>)[key]
            const hit = walk(candidate)
            if (hit) return hit
          }
          for (const value of Object.values(node as Record<string, unknown>)) {
            const hit = walk(value)
            if (hit) return hit
          }
        }
        return null
      })(parsed)
      return found ?? []
    }
    try {
      // Discover a fixture triple a -> exchange -> b with NO direct a->b
      // edge, so the shortest route necessarily crosses the exchange.
      const triples = await rows(
        'USE live_topology MATCH (a:Identity)-[:FLOWS_TO]->(e:Identity)-[:FLOWS_TO]->(b:Identity) ' +
          'WHERE e.is_exchange IS NOT NULL AND a.identity_id <> b.identity_id ' +
          'AND a.is_exchange IS NULL AND b.is_exchange IS NULL ' +
          'RETURN a.identity_id AS a, e.identity_id AS e, b.identity_id AS b LIMIT 10',
      )
      let picked: { a: string; e: string; b: string } | undefined
      for (const t of triples) {
        const a = String(t['a']), e = String(t['e']), b = String(t['b'])
        const direct = await rows(
          `USE live_topology MATCH (a:Identity {identity_id: "${a}"})-[:FLOWS_TO]->(b:Identity {identity_id: "${b}"}) RETURN 1 AS x LIMIT 1`,
        )
        if (direct.length === 0) {
          picked = { a, e, b }
          break
        }
      }
      // Hard requirement (AC8): the deterministic devkit fixture is known
      // to contain indirect exchange-intermediate pairs; absence means the
      // fixture regressed or the discovery queries broke — fail, never skip.
      expect(picked, 'no indirect exchange-intermediate fixture pair found — AC8 cannot be verified').toBeDefined()
      if (!picked) throw new Error('unreachable')
      const member = async (identity: string): Promise<string> => {
        const m = await rows(
          `USE live_topology MATCH (i:Identity {identity_id: "${identity}"})-[:HAS_ADDRESS]->(m:Address) RETURN m.address AS address LIMIT 1`,
        )
        return String(m[0]?.['address'] ?? identity)
      }
      // Prefetch ground truth BEFORE the tool's heavy batch: post-batch
      // lookups have proven to return empty rows on the same backend
      // session (federation-layer session-state defect family, see the
      // capability matrix upstream issue pins).
      const exchangeRows = await rows(
        'USE live_topology MATCH (i:Identity) WHERE i.is_exchange IS NOT NULL RETURN i.identity_id AS id LIMIT 100',
      )
      const exchangeSet = new Set(exchangeRows.map((r) => String(r['id']).replace(/^bittensor:/, '')))
      expect(exchangeSet.size, 'fixture must contain exchange identities').toBeGreaterThan(0)
      const { addressRisk } = await import('../src/investigation/public-tools.js')
      const result = await addressRisk(client, {
        address: await member(picked.a),
        network: 'bittensor',
        compareAddress: await member(picked.b),
        topologyScope: 'live_topology',
      })
      const structured = result.structuredContent as { facts?: Record<string, unknown> }
      const facts = (structured.facts ?? {}) as Record<string, unknown>
      const connection = facts['connection'] as { route_evidence?: RouteEvidence } | undefined
      const evidence = connection?.route_evidence
      expect(evidence?.route_found, 'route through the exchange should be found, not filtered').toBe(true)
      const side = evidence!.outbound ?? evidence!.inbound
      expect(side, 'at least one directed side must carry the route').not.toBeNull()
      expect(side!.hops).toBeGreaterThanOrEqual(2)
      // Ground-truth disclosure check: ANY SHORTEST may pick any of the
      // equal-length routes, so verify against the route it actually
      // returned — every intermediate that IS an exchange must appear in
      // exchange_intermediates, and nothing else may.
      // Path-serialized node properties arrive display-normalized (network
      // prefix stripped) while graph_query row values are prefixed keys —
      // normalize both sides for the comparison and query ground truth
      // with the prefixed form.
      const stripPrefix = (identity: string): string => identity.replace(/^bittensor:/, '')
      const intermediates = side!.identities.slice(1, -1)
      expect(intermediates.length).toBeGreaterThanOrEqual(1)
      const actualExchanges = intermediates
        .map(stripPrefix)
        .filter((identity) => exchangeSet.has(identity))
      expect(
        side!.exchange_intermediates.map(stripPrefix).sort(),
        'disclosed exchange intermediates must exactly match the exchanges on the returned route (real MemGQL path serialization)',
      ).toEqual(actualExchanges.sort())
    } finally {
      await client.close()
    }
  })
})
