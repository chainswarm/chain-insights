import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Capability probe suite wrapper (post MemGQL retirement). The probe scripts
// run every query THROUGH the running devkit graph MCP (:18012) and record the
// admitted outcome + error_code; this test replays them and pins the native
// surface:
//   topology  — native Memgraph Cypher; `supported` for the bounded
//               traversal forms, `rejected-bounds`/`rejected-write` for the
//               admission + traversal gate.
//   facts     — corpus-scoped translator; `supported` for the compiled
//               subset, `rejected-cost`/`rejected-translation` otherwise.
// Gated: requires a running devkit compose, so plain `npm test` skips it.
// When an outcome or error_code drifts, re-evaluate the allowed query shapes
// and update the expected-*.json (see docs/graph-query-compatibility.md).

const enabled = process.env.CAPABILITY_PROBES === '1'
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

type Row = { probe_id: string; expected_outcome?: string; actual_outcome?: string; error_code?: string | null }

function assertRowsMatch(artifactRows: Row[], expectedRows: Row[], lane: string) {
  expect(artifactRows.length).toBe(expectedRows.length)
  for (const expectedRow of expectedRows) {
    const actualRow = artifactRows.find((r) => r.probe_id === expectedRow.probe_id)
    expect(actualRow, `${lane} probe ${expectedRow.probe_id} missing from artifact`).toBeDefined()
    expect(
      actualRow!.actual_outcome,
      `${lane} probe ${expectedRow.probe_id} outcome drifted — re-evaluate allowed query shapes and update the expectation`,
    ).toBe(expectedRow.expected_outcome)
    expect(
      actualRow!.error_code ?? null,
      `${lane} probe ${expectedRow.probe_id} error_code drifted`,
    ).toBe(expectedRow.error_code ?? null)
  }
}

function latestArtifact(pattern: RegExp): any {
  const artifacts = readdirSync(join(repoRoot, 'workspace')).filter((f) => pattern.test(f))
  expect(artifacts.length, `no artifact matching ${pattern}`).toBeGreaterThan(0)
  return JSON.parse(readFileSync(join(repoRoot, 'workspace', artifacts.sort().at(-1)!), 'utf8'))
}

describe.skipIf(!enabled)('Native graph capability matrix (live lane)', () => {
  it('probe run matches pinned expectations', { timeout: 10 * 60 * 1000 }, () => {
    execFileSync('bash', [join(repoRoot, 'devkit/scripts/capability-probes-live.sh')], {
      stdio: 'inherit',
      timeout: 10 * 60 * 1000,
    })
    const artifact = latestArtifact(/^capability-matrix\..+\.json$/)
    const expected = JSON.parse(
      readFileSync(join(repoRoot, 'devkit/capability-probes/expected-live.json'), 'utf8'),
    )
    assertRowsMatch(artifact.rows, expected.rows, 'live')
  })
})

// Archive lane needs the devkit compose up as well, so it carries its own gate
// on top of CAPABILITY_PROBES: set CAPABILITY_PROBES_ARCHIVE=1 with
// `docker compose -f devkit/docker-compose.yml up -d` running.
const archiveEnabled = enabled && process.env.CAPABILITY_PROBES_ARCHIVE === '1'

describe.skipIf(!archiveEnabled)('Native graph capability matrix (archive lane, devkit)', () => {
  it('archive probe run matches pinned expectations', { timeout: 10 * 60 * 1000 }, () => {
    execFileSync('bash', [join(repoRoot, 'devkit/scripts/capability-probes-archive.sh')], {
      stdio: 'inherit',
      timeout: 10 * 60 * 1000,
    })
    const artifact = latestArtifact(/^capability-matrix-archive\..+\.json$/)
    const expected = JSON.parse(
      readFileSync(join(repoRoot, 'devkit/capability-probes/expected-archive.json'), 'utf8'),
    )
    assertRowsMatch(artifact.rows, expected.rows, 'archive')
  })
})
