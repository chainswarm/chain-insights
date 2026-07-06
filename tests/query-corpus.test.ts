import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

// R5/AC2 (cia-gql-query-optimization spec): the committed corpus is the
// cross-repo contract consumed by data-pipeline's ValidateReadOnlyGraphQuery
// admission test. If a builder changes without `npm run corpus:generate`,
// this test fails; if the corpus changes, the data-pipeline testdata copy
// must be refreshed in the same wave (RBMK root sha256 sync test pins it).

const repoRoot = resolve(__dirname, '..')
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
    }
  })
})
