/**
 * The first reads of each trail type, filled with the addresses of one
 * exchange. meta_dex_lookup returns them, so a host that loads no skill
 * (Claude Desktop chat) still gets the tested reads of
 * skills/chain-insights-dex*. The shapes are the skills' own: R3 and R4 of
 * chain-insights-dex, G1, G4 and G5 of the gauge trail, V1, V3 and V4 of the
 * vault trail, L1 to L3 of the launchpad trail.
 *
 * A value the lookup cannot know (a seller, a day, a transaction) is written
 * as a placeholder in angle brackets, and the step's `why` says where it comes
 * from. Every address the lookup knows is written in full.
 *
 * Two graph shapes, picked per lane (src/mcp/layer-routing.ts swapLinkShape):
 * `route`, the graph of before, where SWAPPED runs from a payer to a recipient
 * and holds the whole route; and `levels`, where ROUTED_TO is the route of a
 * payer and a receiver (level 2) and SWAPPED runs from a trader to one pool
 * (level 1). Every `route` read is the one of chain-insights 0.81.0, byte for
 * byte: tests/link-levels.test.ts holds them to tests/fixtures/dex-reads-0.81.0.json.
 */

import type { DexEntry, TrailType } from './dex-registry.js'
import type { SwapLinkShape } from './layer-routing.js'

export interface RecipeStep {
  step: string
  why: string
  query: string
}

/** The trail-type skill of each trail, for hosts that load skills. */
export const TRAIL_SKILLS: Record<TrailType, string> = {
  plain: 'chain-insights-dex',
  gauge: 'chain-insights-dex-gauge',
  vault: 'chain-insights-dex-vault',
  launchpad: 'chain-insights-dex-launchpad',
}

const SELLER = '<seller address>'
const DAY = '<YYYY-MM-DD>'
const TX = '<tx_id>'
const TOKEN = '<launched token address>'

/** The pools one factory deployed, by lifetime volume (R3). */
export function poolsByFactoryQuery(factory: string, limit = 10): string {
  return (
    `USE topology MATCH (f:Address {address: "${factory}"})-[:DEPLOYED_CONTRACT]->(p:Pool) WHERE p.total_volume_usd IS NOT NULL ` +
    'RETURN f.address AS from_address, p.address AS to_address, p.labels AS to_labels, p.total_volume_usd AS total_volume_usd, p.tx_total_count AS tx_total_count ' +
    `ORDER BY p.total_volume_usd DESC LIMIT ${limit}`
  )
}

/** The senders of one pool on FLOWED_TO, by lifetime volume (R4, G1). */
function sellersIntoPoolQuery(pool: string): string {
  return (
    `USE topology MATCH (s:Address)-[f:FLOWED_TO]->(p:Address {address: "${pool}"}) WHERE NOT s:Pool ` +
    'RETURN s.address AS from_address, p.address AS to_address, labels(s) AS from_node_labels, f.amount_usd_sum AS amount_usd_sum, f.tx_count AS tx_count, f.first_seen_timestamp AS first_seen_timestamp, f.last_seen_timestamp AS last_seen_timestamp, s.labels AS from_labels, p.labels AS to_labels, s.is_exchange AS from_is_exchange, p.is_exchange AS to_is_exchange ' +
    'ORDER BY f.amount_usd_sum DESC LIMIT 25'
  )
}

/** The payers whose swaps name one contract as the recipient, by sold volume (V4 shape). */
function sellersIntoContractQuery(contract: string): string {
  return (
    `USE topology MATCH (s:Address)-[sw:SWAPPED]->(r:Address {address: "${contract}"}) WHERE NOT s:Pool ` +
    'RETURN s.address AS from_address, r.address AS to_address, labels(s) AS from_node_labels, sw.sold_asset AS sold_asset, sw.bought_asset AS bought_asset, sw.sold_usd AS sold_usd, sw.bought_usd AS bought_usd, sw.swap_count AS swap_count, sw.pools AS pools, sw.last_seen_height AS last_seen_height ' +
    'ORDER BY sw.sold_usd DESC LIMIT 25'
  )
}

/** One seller's swaps (R5, G2, V1). */
function sellerSwapsQuery(): string {
  return (
    `USE topology MATCH (s:Address {address: "${SELLER}"})-[sw:SWAPPED]->(r:Address) ` +
    'RETURN s.address AS from_address, r.address AS to_address, labels(r) AS to_node_labels, sw.sold_asset AS sold_asset, sw.bought_asset AS bought_asset, sw.sold_usd AS sold_usd, sw.bought_usd AS bought_usd, sw.swap_count AS swap_count, sw.pools AS pools, sw.last_seen_height AS last_seen_height ' +
    'ORDER BY sw.swap_count DESC LIMIT 25'
  )
}

/** The facts SWAP rows of a seller and one recipient on one day (R6, G4, V3). */
function swapRowsQuery(recipient: string): string {
  return (
    `USE facts MATCH (s:Address {address: "${SELLER}"})-[x:SWAP]->(r:Address {address: "${recipient}"}) WHERE x.block_date = "${DAY}" ` +
    'RETURN x.tx_id AS tx_id, x.block_timestamp AS block_timestamp, x.payer AS payer, x.recipient AS recipient, x.sold_asset_symbol AS sold_asset_symbol, x.sold_usd AS sold_usd, x.bought_asset_symbol AS bought_asset_symbol, x.bought_usd AS bought_usd LIMIT 50'
  )
}

/** The transfers one router made in one transaction (G5). */
function routerPayoutQuery(router: string): string {
  return (
    `USE facts MATCH (r:Address {address: "${router}"})-[t:TRANSFER]->(b:Address) WHERE t.block_date = "${DAY}" AND t.tx_id = "${TX}" ` +
    'RETURN r.address AS from_address, b.address AS to_address, t.amount_usd AS amount_usd, t.asset_symbol AS asset_symbol, t.kind AS kind, t.tx_id AS tx_id LIMIT 10'
  )
}

/** The traders at one pool or pool manager on SWAPPED, by sold volume (levels). */
function tradersAtPoolQuery(pool: string): string {
  return (
    `USE topology MATCH (s:Address)-[sw:SWAPPED]->(p:Address {address: "${pool}"}) WHERE NOT s:Pool ` +
    'RETURN s.address AS from_address, p.address AS to_address, labels(s) AS from_node_labels, sw.sold_asset AS sold_asset, sw.bought_asset AS bought_asset, sw.sold_usd AS sold_usd, sw.bought_usd AS bought_usd, sw.swap_count AS swap_count, sw.first_seen_height AS first_seen_height, sw.last_seen_height AS last_seen_height ' +
    'ORDER BY sw.sold_usd DESC LIMIT 25'
  )
}

/** One trader's routes on ROUTED_TO: who got what it bought (levels). */
function traderRoutesQuery(): string {
  return (
    `USE topology MATCH (s:Address {address: "${SELLER}"})-[r:ROUTED_TO]->(b:Address) ` +
    'RETURN s.address AS from_address, b.address AS to_address, labels(b) AS to_node_labels, r.tx_count AS tx_count, r.swap_count AS swap_count, r.amount_usd_sum AS amount_usd_sum, r.bought_usd_sum AS bought_usd_sum, r.unpriced_count AS unpriced_count, r.first_seen_timestamp AS first_seen_timestamp, r.last_seen_timestamp AS last_seen_timestamp ' +
    'ORDER BY r.amount_usd_sum DESC LIMIT 25'
  )
}

/** One trader's swaps on SWAPPED: the pools and the assets (levels). */
function traderPoolSwapsQuery(): string {
  return (
    `USE topology MATCH (s:Address {address: "${SELLER}"})-[sw:SWAPPED]->(p:Address) ` +
    'RETURN s.address AS from_address, p.address AS to_address, labels(p) AS to_node_labels, sw.sold_asset AS sold_asset, sw.bought_asset AS bought_asset, sw.sold_usd AS sold_usd, sw.bought_usd AS bought_usd, sw.swap_count AS swap_count, sw.last_seen_height AS last_seen_height ' +
    'ORDER BY sw.swap_count DESC LIMIT 25'
  )
}

const dayStep: RecipeStep = {
  step: 'The day of a swap link',
  why: 'A SWAPPED link carries heights, not times: read the block of its last_seen_height for the day the facts reads need.',
  query:
    'USE chain MATCH (b:Block {block_height: <last_seen_height>}) RETURN b.block_date, b.block_timestamp',
}

/**
 * The pool a trail starts from: the busiest pool read, else the registry's
 * example pool, else none.
 */
function startPool(entry: DexEntry, topPool: string | null): string | null {
  return topPool ?? entry.example_pool ?? null
}

function poolsStep(entry: DexEntry): RecipeStep | null {
  const factory = entry.factories.find((address) => entry.roles[address] === 'factory')
  if (!factory) return null
  return {
    step: 'Pools of the exchange, by factory',
    why: `The pools ${entry.display} deployed, by lifetime volume. One batch member per factory: ${entry.factories.filter((a) => entry.roles[a] === 'factory').join(', ')}.`,
    query: poolsByFactoryQuery(factory),
  }
}

/** The first reads of the exchange's trail type, with its addresses filled in. */
export function recipeFor(
  entry: DexEntry,
  topPool: string | null,
  shape: SwapLinkShape = 'route'
): RecipeStep[] {
  return shape === 'levels' ? levelsRecipeFor(entry, topPool) : routeRecipeFor(entry, topPool)
}

const routesStep: RecipeStep = {
  step: "Who got what a trader bought",
  why: 'Fill a trader from the first step. Each ROUTED_TO link is the swaps of one payer and one receiver, in USD: a link to the trader itself means it bought for itself, any other receiver is the buyer. No router and no pool is a receiver.',
  query: traderRoutesQuery(),
}

const poolSwapsStep: RecipeStep = {
  step: "A trader's pools and assets",
  why: 'Fill the trader: each SWAPPED link is one pool and one asset pair, with what the pool got (sold) and what it gave (bought).',
  query: traderPoolSwapsQuery(),
}

/** The reads of a lane with the levels: SWAPPED to a pool, ROUTED_TO for the route. */
function levelsRecipeFor(entry: DexEntry, topPool: string | null): RecipeStep[] {
  const pool = startPool(entry, topPool)
  const steps: RecipeStep[] = []
  const poolTraders = (at: string): RecipeStep => ({
    step: 'Traders at the busiest pool',
    why: `The traders of ${at} on SWAPPED, by sold volume. A trader that is a contract is often an aggregator or a bot: say "a contract". A sender that only adds liquidity is on ADDED_LIQUIDITY, not here.`,
    query: tradersAtPoolQuery(at),
  })
  switch (entry.trail_type) {
    case 'gauge': {
      const router = entry.routers[0]
      if (pool) steps.push(poolTraders(pool))
      else {
        const pools = poolsStep(entry)
        if (pools) steps.push(pools)
      }
      steps.push(routesStep)
      if (router) {
        steps.push(dayStep)
        steps.push({
          step: "A trader's swaps through the router on one day",
          why: `Fill the trader and the day: each row gives the tx_id of one swap that named the router ${router}; the router is never the buyer.`,
          query: swapRowsQuery(router),
        })
        steps.push({
          step: 'Who the router paid in that transaction',
          why: 'Fill the day and the tx_id: the receiver of the bought asset is the buyer. A pool or a pool manager there is the next leg, not the buyer.',
          query: routerPayoutQuery(router),
        })
      }
      break
    }
    case 'vault': {
      const manager = entry.factories[0]!
      steps.push({
        step: 'Traders at the pool manager',
        why: `${entry.display} keeps every pool in one manager, ${manager}. Each SWAPPED link into it is one trader and one asset pair: the pair names the pool.`,
        query: tradersAtPoolQuery(manager),
      })
      steps.push(routesStep)
      steps.push(dayStep)
      steps.push({
        step: 'The facts SWAP row past the manager',
        why: 'Fill the trader and the day: the recipient column names who the manager paid.',
        query: swapRowsQuery(manager),
      })
      break
    }
    case 'launchpad': {
      const factory = entry.factories[0]!
      steps.push({
        step: 'Launches of the launchpad, newest first',
        why: `The contracts ${factory} created, with the creator of each.`,
        query:
          `USE topology MATCH (f:Address {address: "${factory}"})-[d:DEPLOYED_CONTRACT]->(t:Address) ` +
          'RETURN f.address AS from_address, t.address AS to_address, labels(t) AS to_node_labels, t.labels AS to_labels, d.tx_origin AS creator, d.tx_id AS tx_id, d.block_height AS block_height, d.block_timestamp AS created_timestamp ORDER BY d.block_height DESC LIMIT 25',
      })
      steps.push({
        step: 'Traders on the curve of one launched token',
        why: 'Fill a launched token from the first step. A curve is a pool: its traders are its SWAPPED links. A launch whose curve is another contract has its traders on that contract.',
        query: tradersAtPoolQuery(TOKEN),
      })
      steps.push({
        step: 'The first pool of one launched token',
        why: 'The oldest ADDED_LIQUIDITY into a :Pool is the graduation. None means it has not graduated in the graph yet.',
        query:
          `USE topology MATCH (t:Address {address: "${TOKEN}"})-[l:ADDED_LIQUIDITY]->(p:Pool) ` +
          'RETURN t.address AS from_address, p.address AS to_address, p.labels AS to_labels, l.asset AS asset, l.usd AS usd, l.first_seen_height AS first_seen_height ORDER BY l.first_seen_height ASC LIMIT 5',
      })
      break
    }
    case 'plain': {
      if (pool) steps.push(poolTraders(pool))
      else {
        const pools = poolsStep(entry)
        if (pools) steps.push(pools)
      }
      steps.push(routesStep)
      steps.push(poolSwapsStep)
      steps.push(dayStep)
      steps.push({
        step: 'The swaps of a trader and a receiver on one day',
        why: 'Fill the trader, the receiver and the day.',
        query: swapRowsQuery('<recipient address>'),
      })
      break
    }
  }
  return steps
}

/** The reads of a lane with the graph of before: SWAPPED holds the route. */
function routeRecipeFor(entry: DexEntry, topPool: string | null): RecipeStep[] {
  const pool = startPool(entry, topPool)
  const steps: RecipeStep[] = []
  switch (entry.trail_type) {
    case 'gauge': {
      const router = entry.routers[0]
      if (router) {
        steps.push({
          step: 'Sellers into the router',
          why: `On ${entry.display} a swap pays the router, and the router pays on. These are the payers whose swaps name the router ${router}; the router is never the buyer.`,
          query: sellersIntoContractQuery(router),
        })
      }
      if (pool) {
        steps.push({
          step: 'Sellers into the busiest pool',
          why: `The senders of ${pool} on FLOWED_TO. A sender that also adds liquidity is a liquidity provider, not a seller.`,
          query: sellersIntoPoolQuery(pool),
        })
      } else {
        const pools = poolsStep(entry)
        if (pools) steps.push(pools)
      }
      if (router) {
        steps.push(dayStep)
        steps.push({
          step: "A seller's swaps through the router on one day",
          why: 'Fill the seller from the first step and the day from the block read: each row gives the tx_id of one swap.',
          query: swapRowsQuery(router),
        })
        steps.push({
          step: 'Who the router paid in that transaction',
          why: 'Fill the day and the tx_id: the receiver of the bought asset is the buyer. A pool or a pool manager there is the next leg, not the buyer.',
          query: routerPayoutQuery(router),
        })
      }
      break
    }
    case 'vault': {
      const manager = entry.factories[0]!
      steps.push({
        step: 'The swaps the pool manager settles',
        why: `${entry.display} keeps every pool in one manager, ${manager}. A manager deploys nothing: its pools are the pools of the swaps it settles.`,
        query: sellersIntoContractQuery(manager),
      })
      steps.push({
        step: "One seller's swaps",
        why: 'Fill a seller from the first step. A recipient that is the manager is never the buyer: read the facts row past it.',
        query: sellerSwapsQuery(),
      })
      steps.push(dayStep)
      steps.push({
        step: 'The facts SWAP row past the manager',
        why: 'Fill the seller and the day: the recipient column names who the manager paid.',
        query: swapRowsQuery(manager),
      })
      break
    }
    case 'launchpad': {
      const factory = entry.factories[0]!
      steps.push({
        step: 'Launches of the launchpad, newest first',
        why: `The contracts ${factory} created, with the creator of each.`,
        query:
          `USE topology MATCH (f:Address {address: "${factory}"})-[d:DEPLOYED_CONTRACT]->(t:Address) ` +
          'RETURN f.address AS from_address, t.address AS to_address, labels(t) AS to_node_labels, t.labels AS to_labels, d.tx_origin AS creator, d.tx_id AS tx_id, d.block_height AS block_height, d.block_timestamp AS created_timestamp ORDER BY d.block_height DESC LIMIT 25',
      })
      steps.push({
        step: 'Traders on the curve of one launched token',
        why: 'Fill a launched token from the first step.',
        query:
          `USE topology MATCH (t:Address {address: "${TOKEN}"})-[f:FLOWED_TO]-(b:Address) WHERE NOT t:Pool ` +
          'RETURN startNode(f).address AS from_address, endNode(f).address AS to_address, labels(b) AS node_labels, f.tx_count AS tx_count, f.amount_usd_sum AS amount_usd_sum, f.first_seen_timestamp AS first_seen_timestamp, f.last_seen_timestamp AS last_seen_timestamp ORDER BY f.tx_count DESC LIMIT 25',
      })
      steps.push({
        step: 'The first pool of one launched token',
        why: 'The oldest ADDED_LIQUIDITY into a :Pool is the graduation. None means it has not graduated in the graph yet.',
        query:
          `USE topology MATCH (t:Address {address: "${TOKEN}"})-[l:ADDED_LIQUIDITY]->(p:Pool) ` +
          'RETURN t.address AS from_address, p.address AS to_address, p.labels AS to_labels, l.asset AS asset, l.usd AS usd, l.first_seen_height AS first_seen_height ORDER BY l.first_seen_height ASC LIMIT 5',
      })
      break
    }
    case 'plain': {
      if (pool) {
        steps.push({
          step: 'Sellers into the busiest pool',
          why: `The senders of ${pool} on FLOWED_TO, by lifetime volume. A seller that is a contract is often an aggregator or a router: say "a contract".`,
          query: sellersIntoPoolQuery(pool),
        })
      } else {
        const pools = poolsStep(entry)
        if (pools) steps.push(pools)
      }
      steps.push({
        step: "Who a seller's swaps paid",
        why: 'Fill a seller from the first step. Keep the rows whose pools hold the pool: the recipient is the buyer.',
        query: sellerSwapsQuery(),
      })
      steps.push(dayStep)
      steps.push({
        step: 'The swaps of a seller and a recipient on one day',
        why: 'Fill the seller, the recipient and the day.',
        query: swapRowsQuery('<recipient address>'),
      })
      break
    }
  }
  return steps
}
