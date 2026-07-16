import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// TNC-T9a repo-wide gate: after the USE topology/USE facts migration, Chain
// Insights (including the embedded devkit) must send and expect ONLY the
// federated `USE topology` / `USE facts` scopes. This test is the mechanical,
// CI-able proof that zero legacy scope text remains anywhere in the tracked
// tree, outside append-only history (CHANGELOG.md) and this test file's own
// pattern definitions (which must name the retired literals to search for
// them).
//
// Scope: `git ls-files` (tracked files only -- node_modules/, dist/, and
// other gitignored build output are excluded automatically; anything not
// committed is not a product surface).

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const ALLOWED_FILES = new Set([
  'CHANGELOG.md',
  // This file defines the retired literals as search patterns; it is the
  // detector, not a violation.
  'tests/no-legacy-topology-scope-text.test.ts',
])

// Word-boundary patterns: `archive_topology`/`live_topology`/`topology_scope`
// as bare identifiers or query text, and the `TopologyScope` TS type name.
const LEGACY_PATTERNS = [
  'topology_scope',
  'TopologyScope',
  'live_topology',
  'archive_topology',
]

function trackedFiles(): string[] {
  const output = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
  return output.split('\n').map((line) => line.trim()).filter(Boolean)
}

function ripgrepMatches(pattern: string): string[] {
  try {
    const output = execFileSync(
      'rg',
      ['--fixed-strings', '--ignore-case', '--files-with-matches', '--no-messages', pattern, '.'],
      { cwd: repoRoot, encoding: 'utf8' },
    )
    return output.split('\n').map((line) => line.trim()).filter(Boolean)
  } catch (err) {
    // rg exits 1 with no output when there are zero matches -- not an error.
    const status = (err as { status?: number }).status
    if (status === 1) return []
    throw err
  }
}

describe('TNC-T9a: zero legacy topology-scope text repo-wide', () => {
  it('every tracked file is git-known (sanity check for the file-list mechanism)', () => {
    expect(trackedFiles().length).toBeGreaterThan(0)
  })

  for (const pattern of LEGACY_PATTERNS) {
    it(`no tracked file outside CHANGELOG/history references "${pattern}"`, () => {
      const tracked = new Set(trackedFiles())
      const matches = ripgrepMatches(pattern)
        .map((file) => file.replace(/^\.\//, ''))
        .filter((file) => tracked.has(file))
        .filter((file) => !ALLOWED_FILES.has(file))
      expect(matches, `unexpected "${pattern}" reference(s) outside CHANGELOG/history:\n${matches.join('\n')}`).toEqual([])
    })
  }
})
