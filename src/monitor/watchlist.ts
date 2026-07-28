// The my-address watchlist: scope the signal the monitor loop already
// produces to the operator's own addresses. watchlist.json is canonical and
// hand-editable; the store `watchlist` table is derived. Distinct from cases,
// which are incident-centric.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod'
import { monitorPaths } from './paths.js'

// Chain addresses are alphanumeric (SS58 base58, or H160 as 0x-prefixed hex).
// Validating here keeps anything else out of the watchlist entirely, so it can
// never reach a query builder. watchlist-run.ts re-checks before building the
// dust query — defence in depth, because a hand-edited watchlist.json is a
// supported workflow and this file is not the only way in.
const ADDRESS_RE = /^(0x)?[A-Za-z0-9]{1,128}$/

const WatchedAddressSchema = z.object({
  address: z.string().min(1).regex(ADDRESS_RE, 'must be a chain address (alphanumeric, optionally 0x-prefixed)'),
  network: z.string().min(1),
  note: z.string().optional(),
  // Cluster auto-watchlist (victim lane spec req 3): "case:<id>" marks an
  // entry as machine-managed by that case's per-trace refresh. Absent =
  // manual entry, which sync NEVER touches.
  managed_by: z.string().min(1).optional(),
})

const WatchlistSchema = z.object({ addresses: z.array(WatchedAddressSchema).default([]) })

export type WatchedAddress = z.infer<typeof WatchedAddressSchema>

function keyOf(address: string, network: string): string {
  return `${network}:${address}`
}

export async function loadWatchlist(workspaceRoot: string): Promise<WatchedAddress[]> {
  const { watchlistPath } = monitorPaths(workspaceRoot)
  let raw: string
  try {
    raw = await readFile(watchlistPath, 'utf8')
  } catch (err) {
    // Missing file = no watchlist. Any other read error (permission, IO) is a
    // real failure and must not be read as "empty".
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new Error(`Cannot read watchlist ${watchlistPath}: ${(err as Error).message}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`Invalid watchlist ${watchlistPath}: not valid JSON (${(err as Error).message})`)
  }
  const result = WatchlistSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    throw new Error(`Invalid watchlist ${watchlistPath}: ${issues.join('; ')}`)
  }
  return result.data.addresses
}

export async function listWatched(workspaceRoot: string): Promise<WatchedAddress[]> {
  return loadWatchlist(workspaceRoot)
}

async function saveWatchlist(workspaceRoot: string, addresses: WatchedAddress[]): Promise<WatchedAddress[]> {
  const { watchlistPath } = monitorPaths(workspaceRoot)
  await mkdir(path.dirname(watchlistPath), { recursive: true })
  await writeFile(watchlistPath, JSON.stringify({ addresses }, null, 2) + '\n', 'utf8')
  return addresses
}

// Idempotent by (network, address): re-adding updates the note rather than
// erroring, so a scripted `watchlist add` is safe to re-run.
export async function addWatched(workspaceRoot: string, entry: WatchedAddress): Promise<WatchedAddress[]> {
  const parsed = WatchedAddressSchema.parse(entry)
  const current = await loadWatchlist(workspaceRoot)
  const next = current.filter((e) => keyOf(e.address, e.network) !== keyOf(parsed.address, parsed.network))
  next.push(parsed)
  return saveWatchlist(workspaceRoot, next)
}

export async function removeWatched(
  workspaceRoot: string,
  address: string,
  network: string,
): Promise<WatchedAddress[]> {
  const current = await loadWatchlist(workspaceRoot)
  return saveWatchlist(
    workspaceRoot,
    current.filter((e) => keyOf(e.address, e.network) !== keyOf(address, network)),
  )
}

/** Refresh one case's managed watchlist set to the given cluster (victim
 *  lane spec req 3). Upserts missing cluster addresses as managed entries,
 *  prunes this case's entries that left the cluster, and never touches
 *  manual entries or entries managed by another case. When a manual entry
 *  already watches a cluster address, the manual entry wins — no managed
 *  duplicate is minted. Callers exclude exchange addresses BEFORE calling
 *  (they are always active and would make the tripwire useless). */
export async function syncManagedWatchlist(
  workspaceRoot: string,
  caseId: string,
  network: string,
  clusterAddresses: string[],
): Promise<{ added: string[]; pruned: string[]; kept: string[] }> {
  const tag = `case:${caseId}`
  const current = await loadWatchlist(workspaceRoot)
  const cluster = new Set(clusterAddresses)
  const next: WatchedAddress[] = []
  const added: string[] = []
  const pruned: string[] = []
  const kept: string[] = []
  // (network, address) pairs owned by anyone OTHER than this case — a
  // cluster address already covered there is left alone entirely.
  const occupied = new Set(current.filter((e) => e.managed_by !== tag).map((e) => keyOf(e.address, e.network)))
  for (const entry of current) {
    if (entry.managed_by !== tag) {
      next.push(entry)
      continue
    }
    if (entry.network === network && cluster.has(entry.address)) {
      next.push(entry)
      kept.push(entry.address)
    } else {
      pruned.push(entry.address)
    }
  }
  for (const address of clusterAddresses) {
    if (occupied.has(keyOf(address, network))) continue
    if (next.some((e) => e.managed_by === tag && e.address === address && e.network === network)) continue
    next.push(WatchedAddressSchema.parse({ address, network, managed_by: tag }))
    added.push(address)
  }
  await saveWatchlist(workspaceRoot, next)
  return { added, pruned, kept }
}
