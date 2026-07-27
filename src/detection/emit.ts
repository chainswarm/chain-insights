// Findings artifact writer (rbmk#462). Writes a detector's findings document to
// the workspace `detections/` dir with a stable, sortable filename. Returns the
// path so the CLI can print it and the operator can review + import it.
import { mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { writeJsonAtomic } from '../monitor/atomic.js'
import type { DetectionFindingsDocument } from '../investigation/detection-findings.js'

export function detectionsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'detections')
}

export async function writeFindings(
  workspaceRoot: string,
  detector: string,
  doc: DetectionFindingsDocument,
): Promise<string> {
  const dir = detectionsDir(workspaceRoot)
  await mkdir(dir, { recursive: true })
  // Empty-and-unchanged skip (durability spec req 6): a dormant detector must
  // not mint a new empty doc every run. Only empty-after-empty is skipped —
  // the non-empty -> empty transition is signal and is still written.
  if (doc.findings.length === 0) {
    const suffix = `-${detector}-${doc.network}.findings.json`
    const prior = (await readdir(dir)).filter((f) => f.endsWith(suffix)).sort().at(-1)
    if (prior) {
      const priorPath = path.join(dir, prior)
      try {
        const priorDoc = JSON.parse(await readFile(priorPath, 'utf8')) as { findings?: unknown[] }
        if ((priorDoc.findings ?? []).length === 0) return priorPath
      } catch {
        // Unreadable prior doc: fall through and write the new one.
      }
    }
  }
  const file = path.join(dir, `${doc.generated_at_timestamp}-${detector}-${doc.network}.findings.json`)
  await writeJsonAtomic(file, doc)
  return file
}
