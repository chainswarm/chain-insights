import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Legacy topology-scope retirement gate: Chain Insights sends and expects ONLY the unified `USE topology` /
// `USE facts` graph scopes. This test is the mechanical, CI-able proof that
// zero legacy scope text remains anywhere in the tracked tree, outside
// append-only history (CHANGELOG.md) and this test file's own pattern
// definitions (which must name the retired literals to search for them).
//
// Scope: `git grep` over the tracked working tree -- exactly the committed
// product surface, including hidden paths such as .github/ (which a default
// ripgrep traversal would skip) and independent of ignore-file semantics.
// Binary files are excluded (-I); gitignored build output (node_modules/,
// dist/) is untracked and therefore never scanned.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const ALLOWED_FILES = new Set([
  'CHANGELOG.md',
  // This file defines the retired literals as search patterns; it is the
  // detector, not a violation.
  'tests/no-legacy-topology-scope-text.test.ts',
])

// Fixed-string, case-insensitive patterns: `archive_topology`/`live_topology`/
// `topology_scope` as identifiers or query text, plus the retired
// `TopologyScope` TS type name (no underscore, so it needs its own pattern).
const LEGACY_PATTERNS = ['topology_scope', 'TopologyScope', 'live_topology', 'archive_topology']

function trackedFiles(): string[] {
  const output = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function gitGrepMatches(pattern: string): string[] {
  try {
    const output = execFileSync(
      'git',
      [
        'grep',
        '-I',
        '--ignore-case',
        '--fixed-strings',
        '--files-with-matches',
        pattern,
        '--',
        '.',
      ],
      { cwd: repoRoot, encoding: 'utf8' }
    )
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  } catch (err) {
    // git grep exits 1 with no output when there are zero matches -- not an error.
    const status = (err as { status?: number }).status
    if (status === 1) return []
    throw err
  }
}

describe('zero legacy topology-scope text repo-wide', () => {
  it('every tracked file is git-known (sanity check for the file-list mechanism)', () => {
    expect(trackedFiles().length).toBeGreaterThan(0)
  })

  for (const pattern of LEGACY_PATTERNS) {
    it(`no tracked file outside CHANGELOG/history references "${pattern}"`, () => {
      const matches = gitGrepMatches(pattern).filter((file) => !ALLOWED_FILES.has(file))
      expect(
        matches,
        `unexpected "${pattern}" reference(s) outside CHANGELOG/history:\n${matches.join('\n')}`
      ).toEqual([])
    })
  }
})
