import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

// Query-contract pin: the committed corpus is the contract consumed by
// the Chain Insights Graph backend's read-only query validator test. If a
// builder changes without `npm run corpus:generate`, this test fails; if
// the corpus changes, the backend's copy must be refreshed in the same
// release wave.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const committedPath = join(repoRoot, 'tests/fixtures/graph-query-corpus.json')
const tempDir = mkdtempSync(join(tmpdir(), 'corpus-'))

afterAll(() => rmSync(tempDir, { recursive: true, force: true }))

describe('graph query corpus', () => {
  it('committed corpus matches a fresh deterministic regeneration', { timeout: 120_000 }, () => {
    const regeneratedPath = join(tempDir, 'corpus.json')
    execFileSync('npx', ['tsx', 'scripts/generate-query-corpus.mjs'], {
      cwd: repoRoot,
      env: { ...process.env, CORPUS_OUT: regeneratedPath },
      stdio: 'pipe',
    })
    expect(readFileSync(regeneratedPath, 'utf8')).toBe(readFileSync(committedPath, 'utf8'))
  })

  it('every entry is production-shaped (USE-prefixed) and hazard-free', () => {
    const corpus = JSON.parse(readFileSync(committedPath, 'utf8'))
    expect(corpus.entry_count).toBe(corpus.entries.length)
    expect(corpus.entries.length).toBeGreaterThan(100)
    for (const entry of corpus.entries) {
      expect(entry.query.startsWith('USE '), `not USE-prefixed: ${entry.builder}`).toBe(true)
      // memgraph/memgraph#4344: SHORTEST k must not appear anywhere.
      expect(entry.query).not.toMatch(/SHORTEST\s+\d/)
      // A malformed generator parameter (wrong window/limit key) leaks
      // JS junk into the emitted query text — pin its absence.
      expect(entry.query, `malformed value in ${entry.builder}`).not.toMatch(/undefined|NaN|\[object /)
    }
  })
})
