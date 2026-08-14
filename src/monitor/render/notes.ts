// src/monitor/render/notes.ts
// Per-address notes + case timeline (spec req 4). Notes and timeline are
// derived views over the case document (seeds + seed events) — overwritten
// each render. Plain fs — no MCP client.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { MonitorCase } from '../cases.js'

export function publishedCaseDir(workspaceRoot: string, caseId: string): string {
  return path.join(path.resolve(workspaceRoot), 'published', 'cases', caseId)
}

function utcDate(tsMs: number): string {
  return new Date(tsMs).toISOString().slice(0, 10)
}

function safeFilename(address: string): string {
  return address.replace(/[^A-Za-z0-9._-]/g, '_')
}

/** One note per seed address. Overwrites each render. */
export async function writeAddressNotes(
  workspaceRoot: string,
  caseId: string,
  monitorCase: MonitorCase,
): Promise<string[]> {
  const dir = path.join(publishedCaseDir(workspaceRoot, caseId), 'addresses')
  await mkdir(dir, { recursive: true })
  const written: string[] = []
  for (const address of monitorCase.seeds) {
    const addedAt = monitorCase.seeds_added_at_timestamp?.[address]
    const body = [
      `# ${address}`,
      '',
      `- Case: ${caseId}`,
      `- Network: ${monitorCase.network}`,
      `- Role: seed`,
      ...(addedAt !== undefined ? [`- Added: ${utcDate(addedAt)}`] : []),
      '',
      '[Back to dossier](../dossier.md)',
      '',
    ].join('\n')
    const file = path.join(dir, `${safeFilename(address)}.md`)
    await writeFile(file, body, 'utf8')
    written.push(file)
  }
  return written
}

/** Derived published/cases/<id>/timeline.md over the case's seed events.
 *  Overwritten each render — the case document is canonical. */
export async function writeTimeline(
  workspaceRoot: string,
  caseId: string,
  monitorCase: MonitorCase,
): Promise<string> {
  const dir = publishedCaseDir(workspaceRoot, caseId)
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, 'timeline.md')
  const events = monitorCase.seed_events ?? []
  const lines = [`# Timeline — ${caseId}`, '', `- ${utcDate(monitorCase.created_at_timestamp)} — case created with ${monitorCase.seeds.length} seed(s)`]
  for (const e of events) {
    const note = e.note ? ` — ${e.note}` : ''
    lines.push(`- ${utcDate(e.at_timestamp)} — ${e.action} ${e.addresses.join(', ')}${note}`)
  }
  await writeFile(file, lines.join('\n') + '\n', 'utf8')
  return file
}