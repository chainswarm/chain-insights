import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

// AC4 output golden (devkit-gated): runs the REAL aml_trace_victim_funds
// flow against the deterministic devkit fixture and compares the
// path-set-bearing fields to a committed expected JSON. Complements the
// query-string snapshots in trace-golden.test.ts: this catches result
// parsing, field shaping, and graph-data regressions the query snapshots
// cannot. Requires devkit compose up + CAPABILITY_PROBES=1.
//
// To regenerate after an APPROVED trace-behavior change: delete
// tests/fixtures/trace-victim-devkit-golden.json and run once with
// TRACE_GOLDEN_RECORD=1.
//
// Own gate (TRACE_DEVKIT_GOLDEN=1, not CAPABILITY_PROBES): this file must
// run in its OWN vitest invocation. The federation layer exhibits a
// session-state defect where heavy graph_query_batch traffic from another
// test file degrades subsequent results on the shared backend session
// (empirically deterministic; same family as the pinned upstream issues).
const enabled = process.env.TRACE_DEVKIT_GOLDEN === '1'
const endpoint = process.env.CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT ?? 'http://127.0.0.1:18012/mcp'
const repoRoot = resolve(__dirname, '..')
const goldenPath = join(repoRoot, 'tests/fixtures/trace-victim-devkit-golden.json')

function fixtureSeed(): string {
  const identityRows = readFileSync(join(repoRoot, 'devkit/data/memgraph/identity_addresses.csv'), 'utf8')
    .split('\n')
    .slice(1)
  const address = new Map<string, string>()
  for (const row of identityRows) {
    const [identity, member] = row.replace(/\r/g, '').split(',')
    if (identity && member?.startsWith('5')) address.set(identity, member)
  }
  const flowRows = readFileSync(join(repoRoot, 'devkit/data/memgraph/flows.csv'), 'utf8')
    .split('\n')
    .slice(1)
  for (const row of flowRows) {
    const [from] = row.replace(/\r/g, '').split(',')
    if (from && address.has(from)) return address.get(from)!
  }
  throw new Error('no fixture seed found')
}

// Normalize: keep the path-set identity of the trace, drop volatile
// fields, and REDACT machine-local absolute paths — the golden is
// committed to a public repository (no private filesystem paths) and
// must be portable across checkouts.
function normalize(structured: unknown, workspaceDir: string): unknown {
  return JSON.parse(
    JSON.stringify(structured, (key, value) => {
      if (/timestamp|generated_at|duration|elapsed|schema/i.test(key)) return undefined
      if (typeof value === 'string') {
        return value
          .replaceAll(workspaceDir, '<workspace>')
          .replaceAll(repoRoot, '<repo>')
          // Artifact filenames embed a run timestamp; the path shape
          // matters for the golden, the instant does not.
          .replace(/\d{8}T\d{6}Z/g, 'RUN_TS')
      }
      return value
    }),
  )
}

describe.skipIf(!enabled)('trace victim funds devkit output golden (AC4)', () => {
  it('path-set fields are stable against the committed golden', { timeout: 300_000 }, async () => {
    // The trace tool persists case evidence, so it needs an initialized
    // workspace; run it from a throwaway one under .tmp (git-ignored).
    const workspaceDir = join(repoRoot, '.tmp/trace-golden-ws')
    execFileSync('npx', ['tsx', 'src/cli.ts', 'init', '--force', workspaceDir], {
      cwd: repoRoot,
      stdio: 'pipe',
      timeout: 120_000,
    })
    const previousCwd = process.cwd()
    process.chdir(workspaceDir)
    const { traceVictimFunds } = await import('../src/investigation/public-tools.js')
    const client = new Client({ name: 'trace-devkit-golden', version: '0.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))
    try {
      const result = await traceVictimFunds(
        client,
        { dataDir: join(repoRoot, '.tmp/trace-golden-data'), serverPort: 0 },
        {
          network: 'bittensor',
          victimAddresses: fixtureSeed(),
          topologyScope: 'live_topology',
        },
      )
      const actual = normalize(result.structuredContent, workspaceDir)
      expect(
        JSON.stringify(actual),
        'golden must not contain machine-local absolute paths (public repo rule)',
      ).not.toMatch(/\/home\/|\/Users\//)
      if (!existsSync(goldenPath)) {
        if (process.env.TRACE_GOLDEN_RECORD === '1') {
          writeFileSync(goldenPath, JSON.stringify(actual, null, 1) + '\n')
          throw new Error('golden recorded — rerun without TRACE_GOLDEN_RECORD to verify')
        }
        throw new Error(`missing golden ${goldenPath}; record with TRACE_GOLDEN_RECORD=1`)
      }
      const expected = JSON.parse(readFileSync(goldenPath, 'utf8'))
      expect(actual).toEqual(expected)
    } finally {
      process.chdir(previousCwd)
      await client.close()
    }
  })
})
