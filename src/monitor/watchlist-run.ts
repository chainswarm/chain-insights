// The watchlist pass: scope the signal the loop already produced to the
// operator's own addresses. Two of the three triggers are local joins and cost
// nothing remote; only the dust probe calls out, and it batches per network.
// Address risk is deliberately NOT a trigger — it is a downstream product, not
// a monitoring input.
import type { MonitorStore } from './store.js'
import type { WatchedAddress } from './watchlist.js'

export interface WatchlistHit {
  address: string
  network: string
  trigger: 'finding' | 'movement' | 'dust'
  source_ref: string
  detail?: string
}

// Watched (network, address) pairs as a two-column VALUES list, so the join
// happens inside DuckDB rather than as N round trips.
function watchedPairs(watched: WatchedAddress[]): { sql: string; params: unknown[] } {
  const rows = watched.map((_, i) => `($${i * 2 + 1},$${i * 2 + 2})`).join(',')
  return { sql: rows, params: watched.flatMap((w) => [w.network, w.address]) }
}

export async function findingHits(
  store: MonitorStore,
  watched: WatchedAddress[],
  _runMs: number,
): Promise<WatchlistHit[]> {
  if (watched.length === 0) return []
  const { sql, params } = watchedPairs(watched)
  // NOT EXISTS against watchlist_hits is the dedupe: a finding doc already
  // reported for this address never re-alerts, however often the loop runs.
  const rows = await store.all(
    `SELECT DISTINCT fa.address AS address, fa.network AS network, fa.doc_path AS source_ref
       FROM finding_addresses fa
       JOIN (VALUES ${sql}) AS w(network, address)
         ON w.address = fa.address AND w.network = fa.network
      WHERE NOT EXISTS (
        SELECT 1 FROM watchlist_hits h
         WHERE h.trigger = 'finding' AND h.address = fa.address
           AND h.network = fa.network AND h.source_ref = fa.doc_path)
      ORDER BY fa.doc_path`,
    params,
  )
  return rows.map((r) => ({
    address: String(r.address),
    network: String(r.network),
    trigger: 'finding' as const,
    source_ref: String(r.source_ref),
    detail: undefined,
  }))
}

export async function movementHits(
  store: MonitorStore,
  watched: WatchedAddress[],
  _runMs: number,
): Promise<WatchlistHit[]> {
  if (watched.length === 0) return []
  const { sql, params } = watchedPairs(watched)
  // case_movements carries no network column; the owning case does.
  const rows = await store.all(
    `SELECT DISTINCT cm.address AS address, c.network AS network,
            cm.case_id AS source_ref, cm.movement AS detail
       FROM case_movements cm
       JOIN cases c ON c.case_id = cm.case_id
       JOIN (VALUES ${sql}) AS w(network, address)
         ON w.address = cm.address AND w.network = c.network
      WHERE NOT EXISTS (
        SELECT 1 FROM watchlist_hits h
         WHERE h.trigger = 'movement' AND h.address = cm.address
           AND h.network = c.network AND h.source_ref = cm.case_id
           AND h.detail IS NOT DISTINCT FROM cm.movement)
      ORDER BY cm.case_id`,
    params,
  )
  return rows.map((r) => ({
    address: String(r.address),
    network: String(r.network),
    trigger: 'movement' as const,
    source_ref: String(r.source_ref),
    detail: r.detail === null || r.detail === undefined ? undefined : String(r.detail),
  }))
}
