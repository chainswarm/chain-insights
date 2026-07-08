import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const goldenPath = join(repoRoot, 'tests/fixtures/trace-victim-devkit-golden.json')

// render-manifest.py / render-memgraph-csv-fixtures.py split any fixture
// over ~40MB into sorted <name>.part-NNN.gz siblings (GitHub's 50MB/100MB
// blob limits; address-grain edge-count growth made this routine) and
// remove the plain file when they do. Read whichever shape is on disk.
// Every part repeats the CSV header (each part.gz must be independently
// loadable), so the header is stripped from EACH part before
// concatenating, never just once off the front of the joined text.
function readCsvGzFixtureDataRows(absolutePath: string): string[] {
  const fileName = absolutePath.split('/').pop() as string
  const partNames = readdirSync(dirname(absolutePath))
    .filter((name) => name.startsWith(`${fileName}.part-`) && name.endsWith('.gz'))
    .sort()
  const paths = partNames.length > 0 ? partNames.map((name) => join(dirname(absolutePath), name)) : [absolutePath]
  return paths.flatMap((path) =>
    gunzipSync(readFileSync(path))
      .toString('utf8')
      .split('\n')
      .slice(1),
  )
}

function fixtureSeed(): string {
  // Address-grain has no identity indirection: flows.csv's from_address is
  // already the raw :Address key, so the seed is the first flow edge whose
  // source is a bittensor SS58 address (mirrors route-evidence-devkit's
  // fixturePair() and devkit/scripts/smoke-chain-insights-parity.sh).
  const addressRows = readCsvGzFixtureDataRows(join(repoRoot, 'devkit/data/memgraph/addresses.csv.gz'))
  const networkByAddress = new Map<string, string>()
  for (const row of addressRows) {
    const [addr, network] = row.replace(/\r/g, '').split(',')
    if (addr) networkByAddress.set(addr, network ?? '')
  }
  const flowRows = readCsvGzFixtureDataRows(join(repoRoot, 'devkit/data/memgraph/flows.csv.gz'))
  for (const row of flowRows) {
    const [from] = row.replace(/\r/g, '').split(',')
    if (from && networkByAddress.get(from) === 'bittensor') return from
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

async function runGolden(
  toolName: 'victim' | 'suspect' | 'deposit',
  goldenFile: string,
  invoke: (client: Client, seed: string, workspaceDir: string) => Promise<{ structuredContent: unknown }>,
): Promise<void> {
  const workspaceDir = join(repoRoot, `.tmp/trace-golden-ws-${toolName}`)
  execFileSync('npx', ['tsx', 'src/cli.ts', 'init', '--force', workspaceDir], {
    cwd: repoRoot,
    stdio: 'pipe',
    timeout: 120_000,
  })
  const previousCwd = process.cwd()
  process.chdir(workspaceDir)
  const client = new Client({ name: `trace-devkit-golden-${toolName}`, version: '0.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))
  try {
    const result = await invoke(client, fixtureSeed(), workspaceDir)
    const golden = join(repoRoot, 'tests/fixtures', goldenFile)
    const actual = normalize(result.structuredContent, workspaceDir)
    if (JSON.stringify(actual).match(/\/home\/|\/Users\//)) {
      throw new Error('golden must not contain machine-local absolute paths')
    }
    if (!existsSync(golden)) {
      if (process.env.TRACE_GOLDEN_RECORD === '1') {
        writeFileSync(golden, JSON.stringify(actual, null, 1) + '\n')
        throw new Error(`golden recorded (${goldenFile}) — rerun without TRACE_GOLDEN_RECORD to verify`)
      }
      throw new Error(`missing golden ${golden}; record with TRACE_GOLDEN_RECORD=1`)
    }
    expect(actual).toEqual(JSON.parse(readFileSync(golden, 'utf8')))
  } finally {
    process.chdir(previousCwd)
    await client.close()
  }
}

describe.skipIf(!enabled)('trace tool devkit output goldens (AC4: victim, suspect, deposit)', () => {
  it('suspect trace path-set fields are stable', { timeout: 300_000 }, async () => {
    const { traceSuspectFunds } = await import('../src/investigation/public-tools.js')
    await runGolden('suspect', 'trace-suspect-devkit-golden.json', (client, seed, ws) =>
      traceSuspectFunds(client, { dataDir: join(ws, '.chain-insights'), serverPort: 0 }, {
        network: 'bittensor',
        suspectAddresses: seed,
        topologyScope: 'live_topology',
      }))
  })

  it('deposit-sources trace path-set fields are stable', { timeout: 300_000 }, async () => {
    const { traceDepositSources } = await import('../src/investigation/public-tools.js')
    await runGolden('deposit', 'trace-deposit-devkit-golden.json', (client, seed, ws) =>
      traceDepositSources(client, { dataDir: join(ws, '.chain-insights'), serverPort: 0 }, {
        network: 'bittensor',
        depositAddresses: seed,
        topologyScope: 'live_topology',
      }))
  })

  it('victim trace path-set fields are stable against the committed golden', { timeout: 300_000 }, async () => {
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
