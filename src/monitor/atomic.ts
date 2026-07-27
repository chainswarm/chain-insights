// Atomic canonical-doc writer (durability spec req 3). The tmp file lives in
// the SAME directory as the target so rename() is atomic on the same
// filesystem — a crash leaves either the old doc or the new doc, never a torn
// half-written one that wedges ingest.
import { rename, writeFile } from 'node:fs/promises'

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tmp = `${filePath}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  await rename(tmp, filePath)
}
