// src/monitor/label-probe.ts
// Watchlist label probe state (label-cutover spec req 1): last-seen
// (label, source) sets per watched address in the append-only canonical
// logs/label-baseline.jsonl — last line per (network, address) wins, torn
// lines cost themselves only (parseJsonlLines). The baseline is the DIFF
// base, never the correctness dependency: hit dedup by source_ref in
// logs/watchlist-hits.jsonl is what prevents re-alerts, so a deleted or
// stale baseline can only re-bootstrap silently, never fire a duplicate.
//
// label-governance Plan 3 D3 (cutover-proof dedup re-key, #270 class): both
// the source_ref shape (address|family|source, see labelHits) and the
// baseline freshness comparison key on the overlay FAMILY, not the label
// text — so a label-text rename (v2 "attack_attributed" -> v3
// "attribution_transport", both family Scam) can never mint a fresh,
// non-colliding ref for an address already known under the retired text.
// See vocabularyFamily/familyForLabel below and migrateLabelSourceRefs,
// which one-time re-keys pre-existing DB rows the same way.
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { parseJsonlLines } from './jsonl.js'
import { monitorPaths } from './paths.js'
import type { MonitorStore } from './store.js'
// Type-only import: watchlist-run.ts imports labelHits from here at runtime,
// so this edge must stay erased to keep the module graph acyclic (same
// pattern as probe.ts).
import type { WatchlistHit } from './watchlist-run.js'
import type { WatchedAddress } from './watchlist.js'

// The topology label overlay carries no per-label provenance (labels is a
// flat string array on :Address), so the pair's source is this constant.
// The (label, source) pair shape is kept so a future label_sources overlay
// surface slots in without changing source_ref or the alert contract.
export const LABEL_SOURCE = 'topology'

export interface LabelPair {
  label: string
  source: string
}

export interface LabelBaselineRecord {
  network: string
  address: string
  pairs: LabelPair[]
  run_timestamp: number
}

export function pairKey(label: string, source: string): string {
  return `${label}|${source}`
}

export async function readLabelBaseline(workspaceRoot: string): Promise<Map<string, LabelPair[]>> {
  const { labelBaselineLog } = monitorPaths(workspaceRoot)
  let raw: string
  try {
    raw = await readFile(labelBaselineLog, 'utf8')
  } catch {
    // Missing log = nothing bootstrapped yet (normal on a fresh workspace).
    return new Map()
  }
  const baseline = new Map<string, LabelPair[]>()
  for (const r of parseJsonlLines<LabelBaselineRecord>(raw, labelBaselineLog).records) {
    if (typeof r.network === 'string' && typeof r.address === 'string' && Array.isArray(r.pairs)) {
      baseline.set(
        `${r.network}:${r.address}`,
        r.pairs.filter((p) => typeof p?.label === 'string' && typeof p?.source === 'string'),
      )
    }
  }
  return baseline
}

export async function appendLabelBaseline(workspaceRoot: string, record: LabelBaselineRecord): Promise<void> {
  const p = monitorPaths(workspaceRoot)
  await mkdir(p.logsDir, { recursive: true })
  await appendFile(p.labelBaselineLog, JSON.stringify(record satisfies LabelBaselineRecord) + '\n', 'utf8')
}

// Same allow-list stance as probe.ts / watchlist-run.ts: refuse rather than
// escape — hand-escaping Cypher string literals is how injections happen.
const SAFE_ADDRESS = /^[A-Za-z0-9]{1,128}$/

/** ONE query per network over all watched addresses (spec req 1-2). Reads
 *  the topology label overlay — the only queryable label surface (the facts
 *  AddressLabel view is retired). Address membership in the IN list scopes
 *  the shared-graph networks exactly like the dust and activity probes.
 *  LIMIT bounds a pathological fan-out; source_ref dedup absorbs truncation. */
export function labelQuery(addresses: string[]): string {
  const unsafe = addresses.filter((a) => !SAFE_ADDRESS.test(a.startsWith('0x') ? a.slice(2) : a))
  if (unsafe.length > 0) {
    throw new Error(
      `watchlist contains ${unsafe.length} address(es) that are not valid chain addresses: ${unsafe.slice(0, 3).map((a) => JSON.stringify(a)).join(', ')}`,
    )
  }
  const list = addresses.map((a) => `'${a}'`).join(',')
  // labels(a) AS families (label-governance Plan 3 D2) rides the SAME row as
  // a.labels — one query, no extra round trip. It is the graphsync overlay
  // taxonomy (PascalCase node labels: Scam/Mixer/Bridge/Victim/Exchange/
  // Poisoned/Propagated/OnMoneyTrail (label-governance Task 6: renamed from
  // Attributed on the money-trail graph-layer rebuild), plus Address on
  // every node and layer-2 knowledge labels like Neuron/Subnet) — see
  // extractFamilies for the vocabulary filter and severityForFamilies for
  // the D2 mapping.
  return `USE topology MATCH (a:Address)
 WHERE a.address IN [${list}] AND a.labels IS NOT NULL
 RETURN a.address AS address, a.labels AS labels, labels(a) AS families
 LIMIT 500`
}

/** Thin fan-out federation returns PER-SHARD rows: the same address may
 *  appear once per shard, some shards with null labels. The client — never
 *  the backend — merges by UNION per address (labels is shard-invariant,
 *  so union == the value; union also tolerates a lagging shard). */
export function mergeLabelRows(rows: Array<Record<string, unknown>>): Map<string, Set<string>> {
  const merged = new Map<string, Set<string>>()
  for (const row of rows) {
    const address = row.address
    const labels = row.labels
    if (typeof address !== 'string' || address.length === 0) continue
    if (!Array.isArray(labels)) continue
    const set = merged.get(address) ?? new Set<string>()
    for (const l of labels) {
      const label = String(l)
      if (label.length > 0) set.add(label)
    }
    merged.set(address, set)
  }
  return merged
}

/** Per-shard merge of the families(a) column — same UNION semantics as
 *  mergeLabelRows (labels(a) is shard-invariant so union == the value, and
 *  tolerates a lagging shard). RAW node-label set, not yet filtered to the
 *  overlay vocabulary: callers run extractFamilies on the result before
 *  mapping severity. */
export function mergeFamilyRows(rows: Array<Record<string, unknown>>): Map<string, Set<string>> {
  const merged = new Map<string, Set<string>>()
  for (const row of rows) {
    const address = row.address
    const families = row.families
    if (typeof address !== 'string' || address.length === 0) continue
    if (!Array.isArray(families)) continue
    const set = merged.get(address) ?? new Set<string>()
    for (const f of families) {
      const family = String(f)
      if (family.length > 0) set.add(family)
    }
    merged.set(address, set)
  }
  return merged
}

// The overlay-family vocabulary the monitor understands (label-governance
// Plan 3 D2). labels(a) returns EVERY node label on the address — Address
// (stamped on every node) and layer-2 knowledge labels (Neuron, Subnet, ...)
// included — so extractFamilies filters down to exactly this set before any
// severity mapping happens. A new family (e.g. a future overlay addition)
// must be added HERE and to ALERT_FAMILIES below, or it silently falls back
// to the conservative "no families extracted" branch.
export const OVERLAY_FAMILIES = ['Scam', 'Mixer', 'Bridge', 'Victim', 'Exchange', 'Poisoned', 'Propagated', 'OnMoneyTrail'] as const
const OVERLAY_FAMILY_SET: ReadonlySet<string> = new Set(OVERLAY_FAMILIES)

/** Filters a raw labels(a) node-label list down to the overlay vocabulary.
 *  Defensive against untrusted backend shapes, same stance as mergeLabelRows/
 *  mergeFamilyRows: a non-array input (including null/undefined) yields an
 *  empty set rather than throwing. */
export function extractFamilies(rawFamilies: unknown): Set<string> {
  const out = new Set<string>()
  if (!Array.isArray(rawFamilies)) return out
  for (const f of rawFamilies) {
    const family = String(f)
    if (OVERLAY_FAMILY_SET.has(family)) out.add(family)
  }
  return out
}

// Verdict families (D2): transport, holding, and mixing findings that alert
// on their own. OnMoneyTrail alone (label-governance Task 6: renamed from
// Attributed), and Victim/Exchange alone, are informational context — see
// severityForFamilies.
const ALERT_FAMILIES: ReadonlySet<string> = new Set(['Scam', 'Mixer', 'Bridge', 'Poisoned', 'Propagated'])

/** D2 family -> severity mapping. Any verdict family present (Scam, Mixer,
 *  Bridge, Poisoned, Propagated) is 'alert'. Only OnMoneyTrail and/or Victim/
 *  Exchange present is 'context'. NO families extracted at all — the
 *  address's node-label overlay carries nothing (labels-text-only) — maps
 *  to 'alert': today's behavior, conservative until the overlay backfills. */
export function severityForFamilies(families: ReadonlySet<string>): 'alert' | 'context' {
  if (families.size === 0) return 'alert'
  for (const family of families) if (ALERT_FAMILIES.has(family)) return 'alert'
  return 'context'
}

// D3 label-text vocabulary -> family (label-governance Plan 3 Task 4). Covers
// BOTH the label text the detector emits TODAY (v3) and the text it emitted
// before the rename (v2) — 'attack_attributed' is the retired predecessor of
// 'attribution_transport'/'attribution_holding' (both resolve to Scam). That
// overlap is exactly what makes a legacy baseline/DB entry and its v3
// replacement compare EQUAL at the family layer: the #270 class regression
// (a label-text rename minting a fresh, non-colliding ref for an
// already-known address) cannot happen for any label in this table, in
// either direction of the rename.
const LABEL_TEXT_FAMILY: ReadonlyMap<string, string> = new Map([
  ['attribution_transport', 'Scam'],
  ['attribution_holding', 'Scam'],
  // label-governance Task 6: the graph-layer family these two resolve to is
  // renamed OnMoneyTrail (was Attributed) on the money-trail graph rebuild.
  ['attribution_peripheral', 'OnMoneyTrail'],
  ['attribution_funder', 'OnMoneyTrail'],
  ['attack_attributed', 'Scam'], // retired v2 text — kept for the cutover only
])

/** Strict vocabulary lookup: a KNOWN label text (either era) resolves to its
 *  family; anything else is undefined — no dominant-family fallback here.
 *  Three call sites share this exact function so the mapping cannot drift
 *  between them: (1) the source_ref family for a NEW row (familyForLabel,
 *  below), (2) the baseline freshness-comparison key inside labelHits, and
 *  (3) the one-time legacy watchlist_hits re-key (migrateLabelSourceRefs).
 *  The fallback in familyForLabel is deliberately NOT folded in here: reusing
 *  the address's dominant family for baseline/migration matching would
 *  wrongly conflate two UNRELATED generic labels that merely share an
 *  address's dominant family (e.g. an exchange name and an unrelated note),
 *  so anything outside this explicit vocabulary keys on its own literal text,
 *  exactly as before this task. */
export function vocabularyFamily(label: string): string | undefined {
  const known = LABEL_TEXT_FAMILY.get(label)
  if (known) return known
  if (label.startsWith('poisoning_')) return 'Poisoned'
  return undefined
}

// Fallback priority when a label's family cannot be derived from the label
// TEXT vocabulary (D3 adopted rule): verdict families outrank context
// families, matching the ALERT_FAMILIES/severityForFamilies priority; ties
// within a tier break on OVERLAY_FAMILIES declaration order.
const FAMILY_PRIORITY: readonly string[] = ['Scam', 'Poisoned', 'Propagated', 'Mixer', 'Bridge', 'OnMoneyTrail', 'Victim', 'Exchange']

/** The single family this address's extracted overlay families would present
 *  as, for the fallback branch of familyForLabel. Returns undefined for an
 *  empty set — there is nothing to fall back to. */
export function dominantFamily(families: ReadonlySet<string>): string | undefined {
  for (const family of FAMILY_PRIORITY) if (families.has(family)) return family
  return undefined
}

/** D3 per-pair family resolution for a NEW alert row's source_ref (adopted
 *  mapping rule): the label TEXT vocabulary first (vocabularyFamily — this is
 *  what survives the v2->v3 rename); then the address's dominant extracted
 *  family (dominantFamily); then the literal label text itself if nothing
 *  else is known. Severity is NOT derived here — that stays
 *  severityForFamilies over the address's whole families set; this only
 *  picks the source_ref KEY for one label pair. */
export function familyForLabel(label: string, addressFamilies: ReadonlySet<string>): string {
  return vocabularyFamily(label) ?? dominantFamily(addressFamilies) ?? label
}

/** D3 legacy source_ref re-key (label-governance Plan 3 Task 4, the #270
 *  retro-flood class guard): every trigger='label' watchlist_hits row
 *  written before this task shipped holds the OLD `address|label|source`
 *  shape with the v2/v3 label TEXT embedded in the middle segment. This
 *  transparently re-keys it to `address|family|source`, using the SAME
 *  strict vocabulary as familyForLabel/baseline matching (vocabularyFamily) —
 *  a label text outside that vocabulary keeps its OLD ref unchanged (D3):
 *  its shape can no longer collide with a new-format ref, so there is
 *  nothing to repair.
 *
 *  Trigger mechanism (documented choice): runs on every read-write store
 *  open, called from withStore right after migrateAbsoluteDocKeys — the SAME
 *  "transparent migration on open" idiom already used there. No version
 *  marker row and no separate migration command: this monitor's DuckDB store
 *  is a disposable derived index (rebuildStore already wipes and replays it
 *  from canonical JSON), so a plain re-run-safe UPDATE is the simplest
 *  option that fits how this monitor already handles DB-only state repair.
 *  Naturally idempotent, with no explicit marker needed: once a row's middle
 *  segment IS a family name (Scam/Poisoned/Attributed/...), it can never
 *  match vocabularyFamily again on a later pass (no family name collides
 *  with a legacy label-text key), so the WHERE-driven UPDATE below simply
 *  finds nothing left to change. */
export async function migrateLabelSourceRefs(store: MonitorStore): Promise<void> {
  const rows = await store.all(
    `SELECT DISTINCT address, network, source_ref FROM watchlist_hits WHERE trigger = 'label'`,
  )
  for (const row of rows) {
    const address = String(row.address)
    const network = String(row.network)
    const sourceRef = String(row.source_ref)
    const prefix = `${address}|`
    if (!sourceRef.startsWith(prefix)) continue // not this ref's shape — defensive, never throws
    const rest = sourceRef.slice(prefix.length)
    // The middle segment (label or, post-migration, family) may itself
    // contain "|" (label text is unconstrained); the source segment is a
    // controlled constant (LABEL_SOURCE) and never is. Anchoring on the
    // LAST "|" recovers the split exactly, same reasoning as WatchlistHit's
    // doc comment on why source_ref is never parsed for the label/source
    // pair elsewhere in this codebase.
    const lastPipe = rest.lastIndexOf('|')
    if (lastPipe < 0) continue
    const label = rest.slice(0, lastPipe)
    const source = rest.slice(lastPipe + 1)
    const family = vocabularyFamily(label)
    if (!family) continue // unmappable (D3): keep the old ref unchanged
    const newRef = `${address}|${family}|${source}`
    if (newRef === sourceRef) continue
    await store.run(
      `UPDATE watchlist_hits SET source_ref = $1
        WHERE trigger = 'label' AND address = $2 AND network = $3 AND source_ref = $4`,
      [newRef, address, network, sourceRef],
    )
  }
}

// Family name the graph-layer node label carried before the money-trail
// rebuild (label-governance Task 6). Kept as a literal, not folded into
// LABEL_TEXT_FAMILY: this is a FAMILY-shaped legacy value (already the
// output of a prior familyForLabel/migrateLabelSourceRefs pass), not a label
// TEXT, so it cannot be looked up through vocabularyFamily.
const RETIRED_FAMILY = 'Attributed'
const RENAMED_FAMILY = 'OnMoneyTrail'

/** D3-shaped legacy source_ref re-key, second edition (label-governance
 *  Task 6, #270 class again): rows already re-keyed by migrateLabelSourceRefs
 *  to `address|Attributed|source` predate the money-trail graph-layer
 *  rebuild, which renames the node-label family :Attributed -> :OnMoneyTrail
 *  (projection version bump). This transparently re-keys those FAMILY-shaped
 *  rows to `address|OnMoneyTrail|source` so the rebuild's new :OnMoneyTrail
 *  label cannot mint a fresh, non-colliding ref for an address already known
 *  under the retired :Attributed family — same retro-flood guard as
 *  migrateLabelSourceRefs, one layer further down the family lineage.
 *
 *  Same "on store open" trigger idiom as migrateAbsoluteDocKeys/
 *  migrateLabelSourceRefs (see store.ts withStore). Naturally idempotent for
 *  the identical reason: once a row's middle segment is OnMoneyTrail, it no
 *  longer equals RETIRED_FAMILY, so the WHERE-driven UPDATE finds nothing
 *  left to change on a later pass. */
export async function migrateFamilyRename(store: MonitorStore): Promise<void> {
  const rows = await store.all(
    `SELECT DISTINCT address, network, source_ref FROM watchlist_hits WHERE trigger = 'label'`,
  )
  for (const row of rows) {
    const address = String(row.address)
    const network = String(row.network)
    const sourceRef = String(row.source_ref)
    const prefix = `${address}|`
    if (!sourceRef.startsWith(prefix)) continue // not this ref's shape — defensive, never throws
    const rest = sourceRef.slice(prefix.length)
    const lastPipe = rest.lastIndexOf('|')
    if (lastPipe < 0) continue
    const family = rest.slice(0, lastPipe)
    const source = rest.slice(lastPipe + 1)
    if (family !== RETIRED_FAMILY) continue // not the retired family — nothing to repair
    const newRef = `${address}|${RENAMED_FAMILY}|${source}`
    await store.run(
      `UPDATE watchlist_hits SET source_ref = $1
        WHERE trigger = 'label' AND address = $2 AND network = $3 AND source_ref = $4`,
      [newRef, address, network, sourceRef],
    )
  }
}

/** The label probe pass: one graph_query_batch per distinct network over
 *  every watched address, diffed against the canonical baseline. Degrades
 *  per network like dustHits/activityHits — a dead backend yields error
 *  text, never a thrown pass, and NEVER seeds a baseline from a failed
 *  read (an error-minted empty set would fake-diff every pre-existing
 *  label on the next healthy pass). */
export async function labelHits(
  client: Client,
  store: MonitorStore,
  workspaceRoot: string,
  watched: WatchedAddress[],
  runTimestamp: number,
): Promise<{ hits: WatchlistHit[]; calls: number; error?: string }> {
  if (watched.length === 0) return { hits: [], calls: 0 }
  const byNetwork = new Map<string, string[]>()
  for (const w of watched) {
    const list = byNetwork.get(w.network) ?? []
    list.push(w.address)
    byNetwork.set(w.network, list)
  }
  const baseline = await readLabelBaseline(workspaceRoot)
  const seenInBatch = new Set<string>()
  const hits: WatchlistHit[] = []
  let calls = 0
  let error: string | undefined
  for (const [network, addresses] of byNetwork) {
    let merged: Map<string, Set<string>>
    let families: Map<string, Set<string>>
    try {
      calls += 1
      const result = (await client.callTool({
        name: 'graph_query_batch',
        arguments: { network, queries: [{ id: 'labels', query: labelQuery(addresses) }] },
      })) as { structuredContent?: { facts?: { queries?: Array<{ id: string; results?: Array<Record<string, unknown>> }> } } }
      const rows = result.structuredContent?.facts?.queries?.find((q) => q.id === 'labels')?.results ?? []
      merged = mergeLabelRows(rows)
      // families(a) rides the same rows as labels(a) — one query, one extra
      // merge pass. Severity (D2) is derived from this, never from the
      // free-text label, so the v2->v3 label-text rename cannot move it.
      families = mergeFamilyRows(rows)
    } catch (err) {
      error = error ? `${error}; ${(err as Error).message}` : (err as Error).message
      continue
    }
    for (const address of addresses) {
      const currentPairs: LabelPair[] = [...(merged.get(address) ?? [])]
        .sort()
        .map((label) => ({ label, source: LABEL_SOURCE }))
      // Computed ONCE per address per pass and reused for both severity (D2)
      // and the per-pair family key (D3) — one extractFamilies call, one
      // consistent view of the address's overlay for this whole address.
      const addressFamilies = extractFamilies([...(families.get(address) ?? [])])
      const severity = severityForFamilies(addressFamilies)
      const key = `${network}:${address}`
      const seenPairs = baseline.get(key)
      if (seenPairs === undefined) {
        // SILENT bootstrap (spec assumption): pre-existing labels are state,
        // not events. Seeding an EMPTY set matters just as much — it is what
        // makes a later first label a diff instead of another bootstrap.
        await appendLabelBaseline(workspaceRoot, { network, address, pairs: currentPairs, run_timestamp: runTimestamp })
        continue
      }
      // D3 baseline freshness key: (vocabulary family, source), not
      // (label, source). vocabularyFamily is the STRICT lookup (no dominant-
      // family fallback — see its doc comment), so a v2-baselined pair (e.g.
      // "attack_attributed") and its v3 replacement ("attribution_transport")
      // compare EQUAL here; any label outside that explicit vocabulary keys
      // on its own literal text exactly as before this task.
      const baselineKey = (p: LabelPair): string => pairKey(vocabularyFamily(p.label) ?? p.label, p.source)
      const seenKeys = new Set(seenPairs.map(baselineKey))
      const fresh = currentPairs.filter((p) => !seenKeys.has(baselineKey(p)))
      const newHits: LabelPair[] = []
      for (const pair of fresh) {
        // D3: source_ref keys on the FAMILY, not the label text (familyForLabel:
        // vocabulary first, then the address's dominant family, then the
        // literal text) — this is what makes the v2->v3 rename produce the
        // SAME source_ref shape a pre-existing DB row can still match after
        // migrateLabelSourceRefs re-keys it (the #270 class guard).
        const family = familyForLabel(pair.label, addressFamilies)
        const sourceRef = `${address}|${family}|${pair.source}`
        const batchKey = `${network}|${sourceRef}`
        if (seenInBatch.has(batchKey)) continue
        const already = await store.all(
          `SELECT 1 FROM watchlist_hits
            WHERE trigger = 'label' AND address = $1 AND network = $2 AND source_ref = $3 LIMIT 1`,
          [address, network, sourceRef],
        )
        if (already.length > 0) {
          newHits.push(pair) // known to the hits log but missing from the baseline: repair the baseline, alert nothing
          continue
        }
        seenInBatch.add(batchKey)
        hits.push({
          address,
          network,
          trigger: 'label',
          source_ref: sourceRef,
          label: pair.label,
          source: pair.source,
          detail: `label=${pair.label} source=${pair.source}`,
          severity,
        })
        newHits.push(pair)
      }
      // Baseline is MONOTONE (append the union): a label that disappears and
      // reappears must not re-alert — removal is not an event. Quiet
      // addresses append nothing, so the log stays quiet on quiet passes.
      if (newHits.length > 0) {
        await appendLabelBaseline(workspaceRoot, { network, address, pairs: [...seenPairs, ...newHits], run_timestamp: runTimestamp })
      }
    }
  }
  return { hits, calls, error }
}
