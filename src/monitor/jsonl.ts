// Line-tolerant JSONL reading, shared by every append-only monitor log reader
// (alerts.ts list/ack path and store.ts ingest path).
//
// Why tolerance is the correct policy here: alerts.jsonl and acks.jsonl are
// appended to with a plain appendFile, so a process killed mid-append leaves a
// torn final line. Before this helper the two readers disagreed on that file —
// the list path swallowed the JSON.parse error and returned ZERO alerts (silent
// total data loss to the user's eyes), while the ingest path threw, so every
// later `monitor run` exited 1 at the final ingest step and `monitor rebuild`
// replayed the same bad line without recovering. One torn line must cost you
// that one line and nothing else, in BOTH paths.
//
// Only per-line parse damage is tolerated. A read error on the file itself
// (permissions, IO) is NOT swallowed by parseJsonlLines — callers decide.

export interface JsonlSkip {
  lineNumber: number
  message: string
}

/**
 * Parse JSONL text, skipping (not throwing on) unparseable lines.
 * Returns the good records plus a description of every skipped line.
 */
export function parseJsonlLines<T>(raw: string, filePath: string): { records: T[]; skipped: JsonlSkip[] } {
  const records: T[] = []
  const skipped: JsonlSkip[] = []
  const lines = raw.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line) continue
    try {
      records.push(JSON.parse(line) as T)
    } catch (err) {
      skipped.push({ lineNumber: i + 1, message: (err as Error).message })
    }
  }
  if (skipped.length > 0) warnSkipped(filePath, skipped)
  return { records, skipped }
}

function warnSkipped(filePath: string, skipped: JsonlSkip[]): void {
  for (const s of skipped) {
    console.warn(`[monitor] skipping unparseable line ${s.lineNumber} in ${filePath}: ${s.message}`)
  }
}
