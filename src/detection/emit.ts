// Findings artifact writer (rbmk#462). Writes a detector's findings document to
// the workspace `detections/` dir with a stable, sortable filename. Returns the
// path so the CLI can print it and the operator can review + import it.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
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
  const file = path.join(dir, `${doc.generated_at_timestamp}-${detector}-${doc.network}.findings.json`)
  await writeFile(file, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  return file
}
