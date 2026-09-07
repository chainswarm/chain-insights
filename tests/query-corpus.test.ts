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
    // Facts risk-score recipes were removed (internal epic) and the trace
    // builders retired with the aml_trace_* tools; keep the guard above the
    // post-cut corpus size.
    expect(corpus.entries.length).toBeGreaterThan(30)
    for (const entry of corpus.entries) {
      expect(entry.query.startsWith('USE '), `not USE-prefixed: ${entry.builder}`).toBe(true)
      // A malformed generator parameter (wrong window/limit key) leaks
      // JS junk into the emitted query text — pin its absence.
      expect(entry.query, `malformed value in ${entry.builder}`).not.toMatch(
        /undefined|NaN|\[object /
      )
      // Quantified paths and shortest selectors are legal on topology, but
      // must not appear on facts, which goes through the StarRocks translator.
      if (entry.scope === 'facts') {
        expect(entry.query, `native traversal on translator layer: ${entry.builder}`).not.toMatch(
          /SHORTEST|\*\s*BFS|\*\s*DFS|\*\s*\d|\*\s*KSHORTEST|\*\s*WSHORTEST|\{\d+,\d*\}/
        )
      }
    }
  })

  it('the corpus is address-grain: no Identity node or HAS_ADDRESS satellite edge appears', () => {
    // Bittensor address-grain revert (2026-07-07): the money-flow graph is
    // :Address {address, network}-primary. A (:Identity) node or
    // -[:HAS_ADDRESS]- satellite hop in any emitted query would mean a
    // builder regressed to the retired identity-grain shape.
    const corpus = JSON.parse(readFileSync(committedPath, 'utf8'))
    for (const entry of corpus.entries) {
      expect(entry.query, `identity-grain node in ${entry.builder}`).not.toMatch(
        /\(\s*[a-zA-Z0-9_]*:Identity\b/
      )
      expect(entry.query, `identity_id property in ${entry.builder}`).not.toMatch(/identity_id/)
      expect(entry.query, `HAS_ADDRESS satellite edge in ${entry.builder}`).not.toMatch(
        /HAS_ADDRESS/
      )
    }
  })

  it('documented recipes cover the GQL topology path surface', () => {
    const recipes = JSON.parse(
      readFileSync(join(repoRoot, 'tests/fixtures/documented-recipes.json'), 'utf8')
    ).recipes as Array<{ query: string; layer: string; features: string[] }>
    const topologyFeatures = new Set(
      recipes.filter((r) => r.layer === 'topology').flatMap((r) => r.features)
    )
    // GQL path shapes run directly against DozerDB on the topology graph.
    for (const feature of [
      'gql-shortest',
      'any-shortest',
      'all-shortest',
      'quantified-path',
      'shortest-path',
    ]) {
      expect(topologyFeatures.has(feature), `missing native topology feature: ${feature}`).toBe(
        true
      )
    }
  })
})
