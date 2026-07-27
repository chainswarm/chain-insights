// src/monitor/render/notes.ts
// Per-address notes + append-only case timeline (spec req 4). Notes are
// derived views, overwritten each render; the timeline is append-only and
// idempotent by alert_id. Plain fs — no MCP client.
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AlertEvent } from '../alerts.js'
import type { TraceV1Doc, TraceV1Address } from './trace-io.js'

export function publishedCaseDir(workspaceRoot: string, caseId: string): string {
  return path.join(path.resolve(workspaceRoot), 'published', 'cases', caseId)
}

function utcDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

function safeFilename(address: string): string {
  return address.replace(/[^A-Za-z0-9._-]/g, '_')
}

/** One note per non-trivial address (any address carrying a role other than
 *  bare candidate_intermediate, plus every seed). Overwrites each render. */
export async function writeAddressNotes(
  workspaceRoot: string,
  caseId: string,
  docs: TraceV1Doc[],
  seeds: string[],
): Promise<string[]> {
  // Merge address metadata across docs.
  const byAddress = new Map<string, TraceV1Address>()
  for (const doc of docs) {
    for (const a of doc.addresses) {
      const existing = byAddress.get(a.address)
      if (!existing) {
        byAddress.set(a.address, { ...a, roles: [...a.roles], labels: a.labels ? [...a.labels] : undefined })
      } else {
        existing.roles = [...new Set([...existing.roles, ...a.roles])]
        if (a.labels?.length) existing.labels = [...new Set([...(existing.labels ?? []), ...a.labels])]
        if (a.is_exchange) existing.is_exchange = true
      }
    }
  }
  const seedSet = new Set(seeds)
  const network = docs[0]?.network ?? ''
  const notable = [...byAddress.values()].filter((a) =>
    seedSet.has(a.address) || a.roles.some((r) => r !== 'candidate_intermediate'),
  )
  // First/last seen per address over its edges (either direction).
  const seen = new Map<string, { first?: number; last?: number }>()
  for (const doc of docs) {
    for (const e of doc.edges) {
      for (const addr of [e.from_address, e.to_address]) {
        let s = seen.get(addr)
        if (!s) seen.set(addr, (s = {}))
        if (e.first_seen_timestamp !== undefined && (s.first === undefined || e.first_seen_timestamp < s.first)) s.first = e.first_seen_timestamp
        if (e.last_seen_timestamp !== undefined && (s.last === undefined || e.last_seen_timestamp > s.last)) s.last = e.last_seen_timestamp
      }
    }
  }
  const dir = path.join(publishedCaseDir(workspaceRoot, caseId), 'addresses')
  await mkdir(dir, { recursive: true })
  const written: string[] = []
  for (const a of notable) {
    const s = seen.get(a.address) ?? {}
    const body = [
      `# ${a.address}`,
      '',
      `- Case: ${caseId}`,
      `- Network: ${network}`,
      `- Roles: ${a.roles.join(', ') || '(none)'}`,
      ...(a.labels?.length ? [`- Labels: ${a.labels.join(', ')}`] : []),
      ...(seedSet.has(a.address) ? ['- Seed address'] : []),
      `- First seen: ${s.first !== undefined ? utcDate(s.first) : 'unknown'}`,
      `- Last seen: ${s.last !== undefined ? utcDate(s.last) : 'unknown'}`,
      '',
      '[Back to dossier](../dossier.md)',
      '',
    ].join('\n')
    const file = path.join(dir, `${safeFilename(a.address)}.md`)
    await writeFile(file, body, 'utf8')
    written.push(file)
  }
  return written
}

/** Append-only published/cases/<id>/timeline.md: one line per alert.
 *  Idempotent: alert_ids already present in the file are skipped.
 *  Returns the number of lines appended. */
export async function appendTimeline(
  workspaceRoot: string,
  caseId: string,
  alerts: AlertEvent[],
): Promise<number> {
  const dir = publishedCaseDir(workspaceRoot, caseId)
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, 'timeline.md')
  let existing = ''
  try {
    existing = await readFile(file, 'utf8')
  } catch {
    // First write creates the file with a header.
  }
  const known = new Set([...existing.matchAll(/\(([^()]+)\)\s*$/gm)].map((m) => m[1]))
  const fresh = alerts.filter((a) => !known.has(a.alert_id))
  if (existing === '') {
    await appendFile(file, `# Timeline — ${caseId}\n\n`, 'utf8')
  }
  if (fresh.length === 0) return 0
  const lines = fresh.map((a) =>
    `- ${new Date(a.emitted_at_timestamp * 1000).toISOString()} — ${a.type} — ${a.address ?? a.detector ?? ''} (${a.alert_id})`,
  )
  await appendFile(file, lines.join('\n') + '\n', 'utf8')
  return fresh.length
}
