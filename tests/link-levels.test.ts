import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  keptSwapLinkShape,
  mirrorGraphNetworkCapabilities,
  readSwapLinkShape,
} from '../src/mcp/capabilities.js'
import { poolsByFactoryQuery, recipeFor, type RecipeStep } from '../src/mcp/dex-recipes.js'
import type { DexEntry, DexRegistryDocument, LoadedRegistry } from '../src/mcp/dex-registry.js'
import {
  HEAD_QUERY,
  META_DEX_LOOKUP_DESCRIPTION,
  handleMetaDexLookup,
  lookupQueries,
  type BatchAnswer,
  type DexToolDependencies,
  type MetaDexLookupResult,
} from '../src/mcp/dex-tool.js'
import { buildGraphSchema, type GraphSchemaClient } from '../src/mcp/graph-schema.js'
import {
  LEVEL_LANE,
  LEVEL_RULE,
  LEVEL_TRACE,
  LEVEL_WALK,
  levelLines,
  swapLinkShape,
  type ServedFamily,
} from '../src/mcp/layer-routing.js'
import { repoRoot } from './dex-registry.js'

// Money is read on three levels, and a lane serves one of two graph shapes:
//
//   levels   the money family lists ROUTED_TO. ROUTED_TO is the route of a payer
//            and a receiver (level 2), SWAPPED runs from a trader to one pool
//            (level 1).
//   route    the graph of before. SWAPPED runs from a payer to a recipient and
//            holds the whole route, with its pools.
//
// The proxy reads the shape per lane from meta_network_capabilities. On the
// graph of before, every read meta_dex_lookup builds is the one of
// chain-insights 0.81.0, byte for byte: tests/fixtures/dex-reads-0.81.0.json
// was written from src/mcp/dex-recipes.ts and src/mcp/dex-tool.ts at 0.81.0,
// before the first edit of this change, for every row of the registry of the
// day. The rows are stored in the snapshot, so a later registry row change does
// not move it.

type Snapshot = {
  recorded_from: string
  head_query: string
  cases: Array<{
    entry: DexEntry
    top_pool: string
    recipe_with_top_pool: RecipeStep[]
    recipe_without_top_pool: RecipeStep[]
    lookup_with_pools: Array<{ id: string; query: string }>
    lookup_without_pools: Array<{ id: string; query: string }>
  }>
}

const snapshot = JSON.parse(
  readFileSync(join(repoRoot, 'tests/fixtures/dex-reads-0.81.0.json'), 'utf8')
) as Snapshot
const document = JSON.parse(
  readFileSync(join(repoRoot, 'registry/robinhood.json'), 'utf8')
) as DexRegistryDocument

const POOL = '0x7615926023bb149f36095645c2a81dc367d39750'

const queriesOf = (steps: RecipeStep[]) => steps.map((step) => step.query)
const topologyQueries = (steps: RecipeStep[]) =>
  queriesOf(steps).filter((query) => query.startsWith('USE topology '))

function deps(linkShape?: DexToolDependencies['linkShape']): DexToolDependencies {
  const loaded: LoadedRegistry = { document, source: 'packaged', loaded_at_ms: 0 }
  return {
    loadRegistry: async () => loaded,
    graphQueryBatch: async (): Promise<BatchAnswer> => ({
      structuredContent: { facts: { queries: [] } },
    }),
    describeFailure: (err) => String(err),
    ...(linkShape ? { linkShape } : {}),
  }
}

async function lookup(
  name: string,
  linkShape?: DexToolDependencies['linkShape']
): Promise<MetaDexLookupResult> {
  const result = await handleMetaDexLookup({ network: 'robinhood', name }, deps(linkShape))
  return result.structuredContent as unknown as MetaDexLookupResult
}

const rowOf = (trail: DexEntry['trail_type']) =>
  document.rows.find((row) => row.trail_type === trail)!

describe('the shape of a lane, from its money family', () => {
  const capabilities = (file: string) =>
    (JSON.parse(readFileSync(join(repoRoot, file), 'utf8')) as {
      graph_progress: { families: ServedFamily[] }
    }).graph_progress.families

  it('reads the graph of before from every recorded lane reply', () => {
    for (const file of [
      'tests/fixtures/network-capabilities-robinhood-families.json',
      'tests/fixtures/network-capabilities-robinhood-20261017.json',
      'tests/fixtures/network-capabilities-robinhood-20261020.json',
    ]) {
      expect(swapLinkShape(capabilities(file)), file).toBe('route')
    }
    expect(swapLinkShape(undefined)).toBe('route')
    expect(swapLinkShape([])).toBe('route')
  })

  it('reads the levels when money lists ROUTED_TO, in link_types, in link_levels or by its layer', () => {
    const money = { name: 'money', layers: ['flows', 'operated_by'] }
    expect(swapLinkShape([{ ...money, link_types: ['FLOWED_TO', 'ROUTED_TO', 'OPERATED_BY'] }])).toBe(
      'levels'
    )
    expect(swapLinkShape([{ ...money, link_levels: { FLOWED_TO: 2, ROUTED_TO: 2 } }])).toBe('levels')
    expect(swapLinkShape([{ name: 'money', layers: ['flows', 'routed', 'operated_by'] }])).toBe(
      'levels'
    )
    // ROUTED_TO under another family is not the money family's.
    expect(
      swapLinkShape([money, { name: 'dex', layers: ['dex_swaps'], link_types: ['ROUTED_TO'] }])
    ).toBe('route')
  })

  it('keeps link_types and link_levels of a served family through the capabilities mirror', () => {
    const mirrored = mirrorGraphNetworkCapabilities({
      networks: [
        {
          network: 'robinhood',
          graph_progress: {
            complete_through_block: 10,
            layers: [],
            families: [
              {
                name: 'money',
                complete_through_block: 10,
                blocks_behind_head: 0,
                layers: ['flows', 'routed', 'operated_by'],
                link_types: ['FLOWED_TO', 'ROUTED_TO', 'OPERATED_BY'],
                link_levels: { FLOWED_TO: 2, ROUTED_TO: 2 },
              },
            ],
          },
        },
      ],
    })
    const family = mirrored.networks[0]!.graph_progress!.families![0]!
    expect(family.link_types).toEqual(['FLOWED_TO', 'ROUTED_TO', 'OPERATED_BY'])
    expect(family.link_levels).toEqual({ FLOWED_TO: 2, ROUTED_TO: 2 })
    expect(swapLinkShape(mirrored.networks[0]!.graph_progress!.families)).toBe('levels')
  })
})

describe('on the graph of before, every read is the one of 0.81.0, byte for byte', () => {
  it('the snapshot covers every trail type', () => {
    expect(snapshot.recorded_from).toContain('0.81.0')
    expect(new Set(snapshot.cases.map((c) => c.entry.trail_type))).toEqual(
      new Set(['plain', 'gauge', 'vault', 'launchpad'])
    )
    expect(HEAD_QUERY).toBe(snapshot.head_query)
  })

  for (const c of snapshot.cases) {
    it(`${c.entry.dex}: the first reads and the lookup reads`, () => {
      expect(recipeFor(c.entry, c.top_pool)).toEqual(c.recipe_with_top_pool)
      expect(recipeFor(c.entry, c.top_pool, 'route')).toEqual(c.recipe_with_top_pool)
      expect(recipeFor(c.entry, null, 'route')).toEqual(c.recipe_without_top_pool)
      expect(lookupQueries(c.entry, true)).toEqual(c.lookup_with_pools)
      expect(lookupQueries(c.entry, false)).toEqual(c.lookup_without_pools)
    })
  }

  it('meta_dex_lookup with no shape, a route lane or a shape read that fails keeps 0.81.0', async () => {
    const before = snapshot.cases.find((c) => c.entry.dex === 'aero')!
    const none = await lookup('Aero')
    const route = await lookup('Aero', async () => 'route')
    const failed = await lookup('Aero', async () => {
      throw new Error('network_capabilities is down')
    })
    for (const result of [none, route, failed]) {
      expect(result.matched?.recipe).toEqual(before.recipe_without_top_pool)
      expect(result.swap_links).toBeUndefined()
      expect(result.hint).toContain(
        'Read families before a SWAPPED search: it is sent when behind_dex is at most 100000. Never ask the user for an address.'
      )
      expect(result.hint).not.toContain(LEVEL_RULE)
    }
  })
})

describe('on a lane with the levels', () => {
  it('"who sold into this pool" names SWAPPED from a trader to the pool, with no router among them', () => {
    const steps = recipeFor(rowOf('plain'), POOL, 'levels')
    expect(steps[0]!.query).toBe(
      `USE topology MATCH (s:Address)-[sw:SWAPPED]->(p:Address {address: "${POOL}"}) WHERE NOT s:Pool ` +
        'RETURN s.address AS from_address, p.address AS to_address, labels(s) AS from_node_labels, sw.sold_asset AS sold_asset, sw.bought_asset AS bought_asset, sw.sold_usd AS sold_usd, sw.bought_usd AS bought_usd, sw.swap_count AS swap_count, sw.first_seen_height AS first_seen_height, sw.last_seen_height AS last_seen_height ' +
        'ORDER BY sw.sold_usd DESC LIMIT 25'
    )
  })

  for (const trail of ['plain', 'gauge', 'vault', 'launchpad'] as const) {
    it(`${trail}: reads the route on ROUTED_TO or the pool on SWAPPED, and never the retired route properties`, () => {
      const entry = rowOf(trail)
      const steps = recipeFor(entry, POOL, 'levels')
      const topology = topologyQueries(steps)
      for (const query of topology) {
        // SWAPPED names no pool list, no families and no strength any more.
        expect(query).not.toMatch(/sw\.(pools|families|strength)\b/)
        // A trace never walks a level 1 link: SWAPPED is read into a pool only.
        expect(query).not.toMatch(/FLOWED_TO\|SWAPPED|SWAPPED\|FLOWED_TO|TRANSFERRED/)
        // No read sends money into a pool on FLOWED_TO: level 2 names no pool.
        expect(query).not.toMatch(/-\[f:FLOWED_TO\]->\(p:Address/)
      }
      if (trail !== 'launchpad') {
        expect(topology.some((query) => query.includes('-[r:ROUTED_TO]->(b:Address)'))).toBe(true)
      }
      expect(topology.some((query) => /-\[sw:SWAPPED\]->\(p:Address \{address: "[^"]+"\}\)/.test(query))).toBe(
        true
      )
      // Every read differs from the graph of before somewhere, or is shape-free.
      expect(steps.length).toBeGreaterThan(0)
    })
  }

  it('vault: the traders are the SWAPPED links into the manager', () => {
    const entry = rowOf('vault')
    const steps = recipeFor(entry, null, 'levels')
    expect(steps[0]!.query).toContain(
      `-[sw:SWAPPED]->(p:Address {address: "${entry.factories[0]}"}) WHERE NOT s:Pool`
    )
  })

  it('meta_dex_lookup follows the lane: levels recipe, swap_links and the level rule in the hint', async () => {
    const result = await lookup('Aero', async () => 'levels')
    const entry = document.rows.find((row) => row.dex === 'aero')!
    expect(result.swap_links).toBe('levels')
    expect(result.matched?.recipe).toEqual(recipeFor(entry, null, 'levels'))
    expect(result.hint).toContain(LEVEL_RULE)
    expect(result.hint).toContain('a ROUTED_TO search when behind_money is')
  })

  it('the schema of a lane whose catalog lists ROUTED_TO carries the levels and samples ROUTED_TO', async () => {
    const recorded = JSON.parse(
      readFileSync(join(repoRoot, 'tests/fixtures/graph-schema-replies-20261006.json'), 'utf8')
    ) as { replies: Record<string, { structuredContent: Record<string, unknown> }> }
    const reply = (structuredContent: Record<string, unknown>) => ({
      content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
      structuredContent,
    })
    const LINK_TYPES = 'USE topology CALL db.relationshipTypes()'
    const ROUTED_SAMPLE = 'USE topology MATCH ()-[r:ROUTED_TO]->() RETURN keys(r) AS keys LIMIT 5'
    const calls: string[] = []
    const client: GraphSchemaClient = {
      async callTool(request) {
        const key =
          request.name === 'graph_query' ? String(request.arguments['query']) : request.name
        calls.push(key)
        if (key === LINK_TYPES) {
          const base = structuredClone(recorded.replies[LINK_TYPES]!.structuredContent) as {
            facts: { query: { results: Array<Record<string, unknown>> } }
          }
          base.facts.query.results.push({ relationshipType: 'ROUTED_TO' })
          return reply(base)
        }
        if (key === ROUTED_SAMPLE) {
          return reply({
            facts: {
              query: {
                billable_units: 1,
                results: [{ keys: ['pair_key', 'tx_count', 'swap_count', 'amount_usd_sum'] }],
              },
            },
          })
        }
        const found = recorded.replies[key]
        if (!found) throw new Error(`no recorded reply for ${key}`)
        return reply(found.structuredContent)
      },
    }
    const built = await buildGraphSchema({
      client,
      network: 'robinhood',
      now: () => new Date('2026-11-17T12:00:00.000Z'),
    })
    expect(calls).toContain(ROUTED_SAMPLE)
    expect(built.document.swap_links).toBe('levels')
    expect(built.document.notes).toContain(levelLines().join(' '))
  })
})

// On a lane with the levels a pool has no address totals: its transactions are
// not on FLOWED_TO, so `total_volume_usd` is absent. Its trade is its SWAPPED
// links. The read below was admitted on the staging host on 2026-11-18 and
// answered 5 rows in 1.1 s.
const AERO_FACTORY = '0xc63d7338c178e805c544b8f897066bd3bbcbe136'
const LEVELS_POOLS_READ =
  `USE topology MATCH (f:Address {address: "${AERO_FACTORY}"})-[:DEPLOYED_CONTRACT]->(p:Pool) ` +
  'MATCH (t:Address)-[s:SWAPPED]->(p) ' +
  'RETURN f.address AS from_address, p.address AS to_address, p.labels AS to_labels, sum(s.sold_usd) AS swapped_usd, sum(s.swap_count) AS swap_count ' +
  'ORDER BY swapped_usd DESC LIMIT 5'

describe('the pools of an exchange, on each shape', () => {
  it('levels: the pools of a factory are ranked by the USD sold into them on SWAPPED', () => {
    expect(poolsByFactoryQuery(AERO_FACTORY, 5, 'levels')).toBe(LEVELS_POOLS_READ)
  })

  it('route: the read stays the one of 0.81.0', () => {
    const aero = snapshot.cases.find((c) => c.entry.dex === 'aero')!
    const before = aero.lookup_with_pools.find((member) => member.id.startsWith('pools:'))!
    expect(poolsByFactoryQuery(AERO_FACTORY, 10, 'route')).toBe(before.query)
    expect(lookupQueries(aero.entry, true, 'route')).toEqual(aero.lookup_with_pools)
  })

  it('levels: the lookup reads, and a recipe with no busiest pool, send the levels read', () => {
    const aero = document.rows.find((row) => row.dex === 'aero')!
    const members = lookupQueries(aero, true, 'levels').filter((m) => m.id.startsWith('pools:'))
    expect(members).toEqual([
      { id: `pools:${AERO_FACTORY}`, query: poolsByFactoryQuery(AERO_FACTORY, 10, 'levels') },
    ])
    const plain = rowOf('plain')
    const factory = plain.factories.find((a) => plain.roles[a] === 'factory')!
    const queries = queriesOf(recipeFor({ ...plain, example_pool: null }, null, 'levels'))
    expect(queries).toContain(poolsByFactoryQuery(factory, 10, 'levels'))
    for (const query of queries) expect(query).not.toContain('total_volume_usd')
  })

  it('meta_dex_lookup on a lane with the levels: sends the SWAPPED read and ranks by what was sold into each pool', async () => {
    const sent: Array<Array<{ id: string; query: string }>> = []
    const rows = [
      { from_address: AERO_FACTORY, to_address: '0x05afb8e895e77ce70f79056137ea606b05bf5abd', to_labels: ['cl-gauge-v1'], swapped_usd: 70836627, swap_count: 148306 },
      { from_address: AERO_FACTORY, to_address: POOL, to_labels: ['cl-gauge-v1'], swapped_usd: 1667147965, swap_count: 1279600 },
    ]
    const result = await handleMetaDexLookup(
      { network: 'robinhood', name: 'Aero' },
      {
        ...deps(async () => 'levels'),
        graphQueryBatch: async ({ queries }): Promise<BatchAnswer> => {
          sent.push(queries)
          return {
            structuredContent: {
              facts: {
                queries: queries.map(({ id }) => ({
                  id,
                  ok: true,
                  results: id.startsWith('pools:') ? rows : [],
                })),
              },
            },
          }
        },
      }
    )
    const structured = result.structuredContent as unknown as MetaDexLookupResult
    expect(sent[0]!.find((m) => m.id.startsWith('pools:'))!.query).toBe(
      poolsByFactoryQuery(AERO_FACTORY, 10, 'levels')
    )
    expect(structured.matched!.pools).toEqual([
      { address: POOL, labels: ['cl-gauge-v1'], swapped_usd: 1667147965, swap_count: 1279600 },
      { address: '0x05afb8e895e77ce70f79056137ea606b05bf5abd', labels: ['cl-gauge-v1'], swapped_usd: 70836627, swap_count: 148306 },
    ])
    // The busiest pool starts the trail.
    expect(structured.matched!.recipe[0]!.query).toContain(`{address: "${POOL}"}`)
    expect(structured.hint).toContain(
      'Each pool carries swapped_usd, the USD sold into it on its SWAPPED links, and swap_count, its swaps'
    )
  })

  it('meta_dex_lookup on the graph of before: a pool row is the address totals, as in 0.81.0', async () => {
    const result = await handleMetaDexLookup(
      { network: 'robinhood', name: 'Aero' },
      {
        ...deps(async () => 'route'),
        graphQueryBatch: async ({ queries }): Promise<BatchAnswer> => ({
          structuredContent: {
            facts: {
              queries: queries.map(({ id }) => ({
                id,
                ok: true,
                results: id.startsWith('pools:')
                  ? [{ to_address: POOL, to_labels: ['cl-gauge-v1'], total_volume_usd: 9, tx_total_count: 3 }]
                  : [],
              })),
            },
          },
        }),
      }
    )
    const structured = result.structuredContent as unknown as MetaDexLookupResult
    expect(structured.matched!.pools).toEqual([
      { address: POOL, labels: ['cl-gauge-v1'], total_volume_usd: 9, tx_total_count: 3 },
    ])
    expect(structured.hint).not.toContain('swapped_usd')
  })

  it('the documented recipes carry the pools read of each shape, marked with its shape', () => {
    const recipes = (
      JSON.parse(readFileSync(join(repoRoot, 'tests/fixtures/documented-recipes.json'), 'utf8')) as {
        recipes: Array<{ id: string; query: string; shape?: string; expect_rows?: boolean }>
      }
    ).recipes
    const route = recipes.find((r) => r.id === 'recipe_topology_dex_pools_by_factory_01')!
    const levels = recipes.find((r) => r.id === 'recipe_topology_dex_pools_by_factory_levels_01')!
    expect(route).toMatchObject({ shape: 'route', expect_rows: true })
    expect(route.query).toBe(poolsByFactoryQuery(AERO_FACTORY, 10, 'route'))
    expect(levels).toMatchObject({ shape: 'levels', expect_rows: true })
    expect(levels.query).toBe(poolsByFactoryQuery(AERO_FACTORY, 10, 'levels'))
    for (const recipe of recipes)
      if (recipe.shape !== undefined) expect(['route', 'levels']).toContain(recipe.shape)
  })

  it('the tool description says what a pool row holds on a lane with the levels', () => {
    expect(META_DEX_LOOKUP_DESCRIPTION).toContain(
      'There each pool carries swapped_usd (the USD sold into it on its SWAPPED links) and swap_count, in place of total_volume_usd and tx_total_count.'
    )
  })
})

describe('the level rule', () => {
  it('is one sentence that names both level 2 links, the four level 1 links and the facts row', () => {
    expect(LEVEL_RULE.split('. ').length).toBe(1)
    for (const type of [
      'FLOWED_TO',
      'ROUTED_TO',
      'TRANSFERRED',
      'SWAPPED',
      'ADDED_LIQUIDITY',
      'REMOVED_LIQUIDITY',
    ])
      expect(LEVEL_RULE).toContain(`\`${type}\``)
    expect(LEVEL_RULE).toContain('`USE facts` row')
    expect(LEVEL_TRACE).toContain('A router or a pool never holds the money.')
    expect(LEVEL_LANE).toContain('`meta_network_capabilities`')
    for (const line of levelLines()) expect(line).not.toMatch(/not (supported|served)/i)
  })
})

describe('the lane shape and the walk sentence', () => {
  it('reads the lane shape from network_capabilities, and keeps the graph of before on a failure', async () => {
    const reply = (families: unknown[]) => ({
      structuredContent: {
        facts: {
          capabilities: {
            networks: [
              {
                network: 'robinhood',
                graph_progress: { complete_through_block: 1, layers: [], families },
              },
            ],
          },
        },
      },
    })
    const money = (layers: string[]) => ({
      name: 'money',
      complete_through_block: 1,
      blocks_behind_head: 0,
      layers,
    })
    const client = (answer: unknown) => ({ callTool: async () => answer })
    expect(await readSwapLinkShape(client(reply([money(['flows', 'routed'])])), 'robinhood')).toBe(
      'levels'
    )
    expect(await readSwapLinkShape(client(reply([money(['flows'])])), 'robinhood')).toBe('route')
    expect(await readSwapLinkShape(client(reply([])), 'robinhood')).toBe('route')
    // A reply that lists no such network gives no shape: nothing to keep.
    expect(
      await readSwapLinkShape(client(reply([money(['flows', 'routed'])])), 'base')
    ).toBeUndefined()
    const broken = {
      callTool: async () => {
        throw new Error('down')
      },
    }
    expect(await readSwapLinkShape(broken, 'robinhood')).toBeUndefined()
  })

  it('the walk sentence names both link lists and changes nothing else', () => {
    expect(LEVEL_WALK).toContain('`FLOWED_TO|ROUTED_TO`')
    expect(LEVEL_WALK).toContain('`FLOWED_TO|SWAPPED`')
  })
})

describe('a failed shape read is never kept', () => {
  it('one failure, then a good levels answer: the second call sends the levels read', async () => {
    const answers: Array<'levels' | undefined> = [undefined, 'levels']
    let reads = 0
    const linkShape = keptSwapLinkShape(async () => answers[reads++], 10 * 60 * 1000, () => 0)
    const first = await lookup('Aero', linkShape)
    const second = await lookup('Aero', linkShape)
    const entry = document.rows.find((row) => row.dex === 'aero')!
    expect(first.swap_links).toBeUndefined()
    expect(first.matched?.recipe).toEqual(recipeFor(entry, null, 'route'))
    expect(second.swap_links).toBe('levels')
    expect(second.matched?.recipe).toEqual(recipeFor(entry, null, 'levels'))
    expect(reads).toBe(2)
    // A good answer is kept: the third call reads nothing.
    await lookup('Aero', linkShape)
    expect(reads).toBe(2)
  })

  it('a kept shape is read again after its time', async () => {
    let clock = 0
    let reads = 0
    const linkShape = keptSwapLinkShape(
      async () => {
        reads += 1
        return 'levels'
      },
      1000,
      () => clock
    )
    expect(await linkShape('robinhood')).toBe('levels')
    clock = 999
    await linkShape('robinhood')
    expect(reads).toBe(1)
    clock = 1000
    await linkShape('robinhood')
    expect(reads).toBe(2)
  })
})
