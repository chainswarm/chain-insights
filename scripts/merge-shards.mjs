#!/usr/bin/env node
/**
 * Shard-merge filter: reads a JSON payload on stdin, writes merged JSON on stdout.
 *
 * Exists so the oracle differential harness (chainswarm/data-pipeline#289) can
 * prove the EXACT merge implementation that ships, rather than a second copy
 * written in Go. Two implementations would drift, and a proof of the copy that
 * does not ship certifies nothing.
 *
 * Input:  {"rows": [...], "options": {...}}   (options optional, see MergeOptions)
 * Output: {"rows": [...], "perShard": {...}, "ordering": "exact|approximate|unordered"}
 *
 * Not a public CLI surface: no bin entry, no command registration.
 */
import { mergeShardRows } from '../dist/index.mjs'

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

const raw = await readStdin()
let payload
try {
  payload = JSON.parse(raw)
} catch (err) {
  process.stderr.write(`merge-shards: input is not valid JSON: ${err.message}\n`)
  process.exit(2)
}
if (!payload || !Array.isArray(payload.rows)) {
  process.stderr.write('merge-shards: expected {"rows": [...]}\n')
  process.exit(2)
}
process.stdout.write(JSON.stringify(mergeShardRows(payload.rows, payload.options ?? {})))
