import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Capability probe suite wrapper. Runs the live-lane probe script (spins
// throwaway Memgraph + MemGQL containers) and validates the emitted
// capability matrix against the pinned expectations. Gated: requires
// docker, so plain `npm test` skips it.
//
// Expectations are pinned to CURRENT MemGQL behavior including its known
// defects (memgraph/memgraph#4343/#4344/#4345 rows carry
// expected_outcome "supported-but-wrong"/"rejected-translation"). When a
// future MemGQL image bump fixes one, the probe run diverges from the
// pin, this test fails loudly, and the operator updates the expectation
// AND revisits the R2 rewrite gates in
// docs/superpowers/specs/2026-07-06-cia-gql-query-optimization-design.md.
const enabled = process.env.CAPABILITY_PROBES === '1'
const repoRoot = resolve(__dirname, '..')

describe.skipIf(!enabled)('MemGQL capability matrix (live lane)', () => {
  it('probe run matches pinned expectations', { timeout: 10 * 60 * 1000 }, () => {
    execFileSync('bash', [join(repoRoot, 'devkit/scripts/capability-probes-live.sh')], {
      stdio: 'inherit',
      timeout: 10 * 60 * 1000,
    })

    const artifacts = readdirSync(join(repoRoot, 'workspace')).filter((f) =>
      /^capability-matrix\..+\.json$/.test(f),
    )
    expect(artifacts.length).toBeGreaterThan(0)
    const artifact = JSON.parse(
      readFileSync(join(repoRoot, 'workspace', artifacts.sort().at(-1)!), 'utf8'),
    )
    const expected = JSON.parse(
      readFileSync(join(repoRoot, 'devkit/capability-probes/expected-live.json'), 'utf8'),
    )

    expect(artifact.memgql_image).toBe(expected.memgql_image)
    expect(artifact.rows.length).toBe(expected.rows.length)

    for (const expectedRow of expected.rows) {
      const actualRow = artifact.rows.find(
        (r: { probe_id: string }) => r.probe_id === expectedRow.probe_id,
      )
      expect(actualRow, `probe ${expectedRow.probe_id} missing from artifact`).toBeDefined()
      expect(
        actualRow.actual_outcome,
        `probe ${expectedRow.probe_id} (${expectedRow.upstream_issue ?? 'no upstream issue'}): ` +
          `outcome drifted — if an upstream fix landed, update expected-live.json AND revisit the R2 gates`,
      ).toBe(expectedRow.expected_outcome)
    }
  })
})

// Archive lane needs the devkit compose up as well, so it carries its own
// gate on top of CAPABILITY_PROBES: set CAPABILITY_PROBES_ARCHIVE=1 with
// `docker compose -f devkit/docker-compose.yml up -d` running.
const archiveEnabled = enabled && process.env.CAPABILITY_PROBES_ARCHIVE === '1'

describe.skipIf(!archiveEnabled)('MemGQL capability matrix (archive lane, devkit)', () => {
  it('archive probe run matches pinned expectations with digest metadata', { timeout: 10 * 60 * 1000 }, () => {
    execFileSync('bash', [join(repoRoot, 'devkit/scripts/capability-probes-archive.sh')], {
      stdio: 'inherit',
      timeout: 10 * 60 * 1000,
    })
    const artifacts = readdirSync(join(repoRoot, 'workspace')).filter((f) =>
      /^capability-matrix-archive\..+\.json$/.test(f),
    )
    expect(artifacts.length).toBeGreaterThan(0)
    const artifact = JSON.parse(
      readFileSync(join(repoRoot, 'workspace', artifacts.sort().at(-1)!), 'utf8'),
    )
    const expected = JSON.parse(
      readFileSync(join(repoRoot, 'devkit/capability-probes/expected-archive.json'), 'utf8'),
    )
    expect(artifact.memgql_image).toBe(expected.memgql_image)
    expect(artifact.memgql_digest, 'archive artifact must carry the image digest (AC7)').toBeTruthy()
    for (const expectedRow of expected.rows) {
      const actualRow = artifact.rows.find(
        (r: { probe_id: string }) => r.probe_id === expectedRow.probe_id,
      )
      expect(actualRow, `probe ${expectedRow.probe_id} missing`).toBeDefined()
      expect(actualRow.actual_outcome, `archive probe ${expectedRow.probe_id} drifted`).toBe(
        expectedRow.expected_outcome,
      )
    }
  })
})
