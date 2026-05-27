# Workspace Output Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make initialized Chain Insights workspaces the only destination for AML investigation output, remove `trace_funds` as a public product surface, and align CLI, MCP, shipped skills, tests, and preview serving.

**Architecture:** Add one strict workspace output resolver and route every investigation-producing writer through it. Keep global `~/.chain-insights` for config, wallet, installed skills, and cache only. Expose one public fund-flow workflow, `track_funds`, backed by private implementation helpers.

**Tech Stack:** TypeScript, Commander CLI, MCP SDK, Hono server, Node filesystem APIs, Vitest, shipped Codex/Claude skills.

---

## Spec

Implement:

```text
docs/superpowers/specs/2026-05-16-workspace-output-repair-design.md
```

## File Structure

Create:

- `src/workspace/output-root.ts`: strict initialized workspace resolver for investigation-producing commands and utilities.
- `tests/workspace-output-root.test.ts`: resolver behavior and no-global-fallback regression tests.

Modify:

- `src/workspace/active.ts`: keep workspace discovery, remove case-output fallback behavior from shared investigation paths.
- `src/workspace/init.ts`: ensure initialized workspaces include every required directory, including `artifacts/`, `logs/`, and `.chain-insights/runtime/`.
- `src/config/schema.ts`: keep global `dataDir` documented/typed as global config/cache, not investigation output root.
- `src/cases/store.ts`, `src/cases/evidence.ts`, `src/cases/dossier.ts`, `src/cases/session.ts`: use strict workspace case root.
- `src/investigation/trace-funds.ts`: rename public implementation to private fund-flow probe helpers; remove public `traceFunds` export.
- `src/investigation/public-tools.ts`: make `trackFunds` the only exported fund-flow workflow and route all output to workspace.
- `src/mcp/artifacts.ts`: write artifacts under workspace `artifacts/`, not global config `dataDir`.
- `src/mcp/proxy.ts`: require workspace for investigation-producing local MCP tools, remove `trace_funds`, expose only `track_funds`.
- `src/cli.ts`: remove public `mcp trace-funds`; require workspace for investigation-producing commands; keep `mcp track-funds`.
- `src/playbooks/builtins.ts`: remove `trace_funds` steps; use `track_funds`.
- `src/server/app.ts`: serve workspace-local artifacts/tree, not global artifacts.
- `src/viz/html-generator.ts`, `src/viz/data-extractor.ts`: use workspace roots for visualization paths.
- `skills/chain-insights-investigation/SKILL.md`: teach strict init, workspace output, and `track_funds`.
- `skills/chain-insights-trace-funds/SKILL.md`: rewrite as fund-flow tracking guidance; do not recommend `trace_funds`.
- `skills/test-chain-insights-graphrag-mcp/SKILL.md`: UAT from initialized workspace and no-global-output assertions.
- `skills/chain-insights-investigation/scripts/run-target-uat.sh`: assert initialized workspace and workspace-only output.
- `skills/test-chain-insights-graphrag-mcp/scripts/run-uat.sh`: assert no global investigation output.
- `skills/ci-case/SKILL.md`: update from placeholder to real workspace case guidance.
- `skills/ci-status/SKILL.md`: update from placeholder to workspace/global status split.
- Tests covering all changed behavior.

Do not stage:

- `.tmp/`
- `.serena/`
- `node_modules/`
- local `cases/`
- `.superpowers/brainstorm/`
- unrelated `docs/superpowers/` artifacts

---

### Task 1: Add Strict Workspace Output Resolver

**Files:**
- Create: `src/workspace/output-root.ts`
- Modify: `src/workspace/active.ts`
- Test: `tests/workspace-output-root.test.ts`

- [ ] **Step 1: Write failing resolver tests**

Create `tests/workspace-output-root.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('workspace output root', () => {
  let parent: string
  let prevWorkspace: string | undefined

  beforeEach(() => {
    vi.resetModules()
    parent = mkdtempSync(join(tmpdir(), 'ci-workspace-root-'))
    prevWorkspace = process.env['CHAIN_INSIGHTS_WORKSPACE']
    delete process.env['CHAIN_INSIGHTS_WORKSPACE']
  })

  afterEach(async () => {
    if (prevWorkspace === undefined) delete process.env['CHAIN_INSIGHTS_WORKSPACE']
    else process.env['CHAIN_INSIGHTS_WORKSPACE'] = prevWorkspace
    await rm(parent, { recursive: true, force: true })
    vi.resetModules()
  })

  async function initWorkspace(root: string) {
    await mkdir(join(root, '.chain-insights'), { recursive: true })
    await writeFile(join(root, '.chain-insights', 'workspace.json'), JSON.stringify({
      schema: 'chain-insights.workspace.v1',
      workspace_root: root,
      cases_dir: 'cases',
    }) + '\n')
  }

  it('requires an initialized workspace before returning investigation output root', async () => {
    const dir = join(parent, 'stolen')
    await mkdir(dir, { recursive: true })
    const { requireWorkspaceRoot } = await import('../src/workspace/output-root.js')

    expect(() => requireWorkspaceRoot(dir)).toThrow('No Chain Insights workspace found. Run: cia init .')
  })

  it('returns the nearest initialized workspace root from a nested directory', async () => {
    const root = join(parent, 'stolen')
    const nested = join(root, 'notes', 'day-1')
    await initWorkspace(root)
    await mkdir(nested, { recursive: true })
    const { requireWorkspaceRoot } = await import('../src/workspace/output-root.js')

    expect(requireWorkspaceRoot(nested)).toBe(root)
  })

  it('uses CHAIN_INSIGHTS_WORKSPACE when explicitly set', async () => {
    const root = join(parent, 'opened-in-vscode')
    const other = join(parent, 'other')
    await initWorkspace(root)
    await mkdir(other, { recursive: true })
    process.env['CHAIN_INSIGHTS_WORKSPACE'] = root
    const { requireWorkspaceRoot } = await import('../src/workspace/output-root.js')

    expect(requireWorkspaceRoot(other)).toBe(root)
  })

  it('builds canonical workspace output paths', async () => {
    const root = join(parent, 'stolen')
    await initWorkspace(root)
    const { workspaceOutputPaths } = await import('../src/workspace/output-root.js')

    expect(workspaceOutputPaths(root)).toEqual({
      root,
      metadataDir: join(root, '.chain-insights'),
      schemaDir: join(root, '.chain-insights', 'schema'),
      runtimeDir: join(root, '.chain-insights', 'runtime'),
      casesRoot: join(root, 'cases'),
      reportsRoot: join(root, 'reports'),
      reportGraphsRoot: join(root, 'reports', 'graphs'),
      reportTablesRoot: join(root, 'reports', 'tables'),
      artifactsRoot: join(root, 'artifacts'),
      logsRoot: join(root, 'logs'),
    })
  })
})
```

- [ ] **Step 2: Run resolver tests and verify they fail**

Run:

```bash
npx vitest run tests/workspace-output-root.test.ts
```

Expected: fail because `src/workspace/output-root.ts` does not exist.

- [ ] **Step 3: Implement strict resolver**

Create `src/workspace/output-root.ts`:

```ts
import path from 'node:path'
import { findActiveWorkspace } from './active.js'

export const NO_WORKSPACE_ERROR = 'No Chain Insights workspace found. Run: cia init .'

export interface WorkspaceOutputPaths {
  root: string
  metadataDir: string
  schemaDir: string
  runtimeDir: string
  casesRoot: string
  reportsRoot: string
  reportGraphsRoot: string
  reportTablesRoot: string
  artifactsRoot: string
  logsRoot: string
}

export function requireWorkspaceRoot(startDir = process.cwd()): string {
  const workspace = findActiveWorkspace(startDir)
  if (!workspace) throw new Error(NO_WORKSPACE_ERROR)
  return workspace.root
}

export function workspaceOutputPaths(workspaceRoot = requireWorkspaceRoot()): WorkspaceOutputPaths {
  const root = path.resolve(workspaceRoot)
  return {
    root,
    metadataDir: path.join(root, '.chain-insights'),
    schemaDir: path.join(root, '.chain-insights', 'schema'),
    runtimeDir: path.join(root, '.chain-insights', 'runtime'),
    casesRoot: path.join(root, 'cases'),
    reportsRoot: path.join(root, 'reports'),
    reportGraphsRoot: path.join(root, 'reports', 'graphs'),
    reportTablesRoot: path.join(root, 'reports', 'tables'),
    artifactsRoot: path.join(root, 'artifacts'),
    logsRoot: path.join(root, 'logs'),
  }
}
```

- [ ] **Step 4: Run resolver tests and verify they pass**

Run:

```bash
npx vitest run tests/workspace-output-root.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit resolver**

```bash
git add src/workspace/output-root.ts tests/workspace-output-root.test.ts
git commit -m "feat: add strict workspace output resolver"
```

---

### Task 2: Make `cia init` Create the Full Workspace Layout

**Files:**
- Modify: `src/workspace/init.ts`
- Modify: `tests/cli.test.ts`

- [ ] **Step 1: Extend init test expectations**

In `tests/cli.test.ts`, update the `init creates an investigation workspace in the target directory` test to include:

```ts
expect(readFileSync(join(target, '.chain-insights', 'workspace.json'), 'utf8')).toContain(
  `"workspace_root": "${target}"`
)
expect(readFileSync(join(target, 'README.md'), 'utf8')).toContain('Chain Insights Investigations')
expect(readFileSync(join(target, 'templates', 'case-brief.md'), 'utf8')).toContain('# Case Brief')
expect(readFileSync(join(target, '.chain-insights', 'runtime-skill', 'SKILL.md'), 'utf8')).toContain('Runtime Graph Schema')
expect(readFileSync(join(target, '.chain-insights', 'schema', 'README.md'), 'utf8')).toContain('Runtime Schema Captures')
expect(readFileSync(join(target, 'AGENTS.md'), 'utf8')).toContain('Run `cia init .` before investigation-producing commands')
expect(readFileSync(join(target, 'CLAUDE.md'), 'utf8')).toContain('Run `cia init .` before investigation-producing commands')
expect(() => readFileSync(join(target, 'artifacts', '.keep'), 'utf8')).not.toThrow()
expect(() => readFileSync(join(target, 'logs', '.keep'), 'utf8')).not.toThrow()
expect(() => readFileSync(join(target, '.chain-insights', 'runtime', '.keep'), 'utf8')).not.toThrow()
```

- [ ] **Step 2: Run init test and verify it fails**

Run:

```bash
npx vitest run tests/cli.test.ts -t "init creates an investigation workspace"
```

Expected: fail because `artifacts/`, `logs/`, `.chain-insights/runtime/`, `.keep`, and updated agent text are missing.

- [ ] **Step 3: Update init workspace directories and docs**

In `src/workspace/init.ts`, add to `WORKSPACE_DIRS`:

```ts
'.chain-insights/runtime',
'artifacts',
'logs',
```

Update `README` layout with:

```text
artifacts/         Workspace-local graph app artifacts
logs/              Workspace-local investigation and preview logs
.chain-insights/runtime/        Workspace-local runtime process state
```

Update `AGENTS` text to include:

```text
- Run `cia init .` before investigation-producing commands.
- Investigation output must stay in this initialized workspace.
- Never write cases, evidence, reports, graph JSON, HTML, artifacts, schema captures, or logs to ~/.chain-insights.
```

Add `.keep` files in `workspaceFiles()`:

```ts
['artifacts/.keep', ''],
['logs/.keep', ''],
['.chain-insights/runtime/.keep', ''],
```

- [ ] **Step 4: Run init tests**

Run:

```bash
npx vitest run tests/cli.test.ts -t "init creates an investigation workspace|init refuses"
```

Expected: pass.

- [ ] **Step 5: Commit init layout**

```bash
git add src/workspace/init.ts tests/cli.test.ts
git commit -m "feat: initialize full investigation workspace layout"
```

---

### Task 3: Route Case Stores Through Strict Workspace Root

**Files:**
- Modify: `src/cases/store.ts`
- Modify: `src/cases/evidence.ts`
- Modify: `src/cases/dossier.ts`
- Modify: `src/cases/session.ts`
- Modify: `tests/cases-store.test.ts`
- Modify: `tests/cases-evidence.test.ts`
- Modify: `tests/cases-dossier.test.ts`
- Modify: `tests/cases-session.test.ts`

- [ ] **Step 1: Add failing case-store no-init test**

In `tests/cases-store.test.ts`, add:

```ts
it('CaseStore.create() fails outside an initialized workspace', async () => {
  delete process.env['CHAIN_INSIGHTS_WORKSPACE']
  delete process.env['CHAIN_INSIGHTS_CASES_ROOT']
  const { CaseStore } = await import('../src/cases/index.js')

  await expect(CaseStore.create({ name: 'No Workspace', tags: [], description: '' }))
    .rejects.toThrow('No Chain Insights workspace found. Run: cia init .')
})
```

Update test setup to initialize a workspace instead of setting `CHAIN_INSIGHTS_CASES_ROOT` directly:

```ts
await mkdir(join(fakeHome, '.chain-insights'), { recursive: true })
await writeFile(join(fakeHome, '.chain-insights', 'workspace.json'), JSON.stringify({
  schema: 'chain-insights.workspace.v1',
  workspace_root: fakeHome,
  cases_dir: 'cases',
}) + '\n')
process.env['CHAIN_INSIGHTS_WORKSPACE'] = fakeHome
```

Use `join(fakeHome, 'cases', c.id)` for expected case directories.

- [ ] **Step 2: Run case tests and verify failures**

Run:

```bash
npx vitest run tests/cases-store.test.ts tests/cases-evidence.test.ts tests/cases-dossier.test.ts tests/cases-session.test.ts
```

Expected: fail while stores still use fallback case roots.

- [ ] **Step 3: Update case root implementation**

In `src/cases/store.ts` replace `activeCasesRoot` usage with:

```ts
import { workspaceOutputPaths } from '../workspace/output-root.js'

export const casesRoot = () => workspaceOutputPaths().casesRoot
```

In `src/cases/evidence.ts`, `src/cases/dossier.ts`, and `src/cases/session.ts`, use:

```ts
import { workspaceOutputPaths } from '../workspace/output-root.js'

function caseDir(caseId: string): string {
  return path.join(workspaceOutputPaths().casesRoot, caseId)
}
```

- [ ] **Step 4: Update remaining case tests to initialize workspace**

In each case test file setup:

```ts
let prevWorkspace: string | undefined

prevWorkspace = process.env['CHAIN_INSIGHTS_WORKSPACE']
process.env['CHAIN_INSIGHTS_WORKSPACE'] = fakeHome
await mkdir(join(fakeHome, '.chain-insights'), { recursive: true })
await writeFile(join(fakeHome, '.chain-insights', 'workspace.json'), JSON.stringify({
  schema: 'chain-insights.workspace.v1',
  workspace_root: fakeHome,
  cases_dir: 'cases',
}) + '\n')
```

In teardown:

```ts
if (prevWorkspace === undefined) delete process.env['CHAIN_INSIGHTS_WORKSPACE']
else process.env['CHAIN_INSIGHTS_WORKSPACE'] = prevWorkspace
```

Expected paths become `join(fakeHome, 'cases', testCaseId, ...)`.

- [ ] **Step 5: Run case tests**

Run:

```bash
npx vitest run tests/cases-store.test.ts tests/cases-evidence.test.ts tests/cases-dossier.test.ts tests/cases-session.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit case root repair**

```bash
git add src/cases/store.ts src/cases/evidence.ts src/cases/dossier.ts src/cases/session.ts tests/cases-store.test.ts tests/cases-evidence.test.ts tests/cases-dossier.test.ts tests/cases-session.test.ts
git commit -m "fix: require workspace for case storage"
```

---

### Task 4: Remove Public `trace_funds` and Make `track_funds` the Sole Fund-Flow Surface

**Files:**
- Modify: `src/investigation/trace-funds.ts`
- Modify: `src/investigation/public-tools.ts`
- Modify: `src/mcp/proxy.ts`
- Modify: `src/cli.ts`
- Modify: `src/playbooks/builtins.ts`
- Modify: `tests/mcp-proxy.test.ts`
- Modify: `tests/cli.test.ts`
- Modify: `tests/cli-mcp.test.ts`
- Modify: `tests/playbook-builtins.test.ts`
- Modify: `tests/playbook-cli.test.ts`
- Modify: `tests/playbook-runner.test.ts`

- [ ] **Step 1: Write failing public-surface tests**

In `tests/cli.test.ts`, update the MCP help tests:

```ts
it('mcp --help lists track-funds and hides trace-funds', () => {
  const out = execSync('node bin/cli.js mcp --help', { encoding: 'utf8' })
  expect(out).toContain('track-funds')
  expect(out).not.toContain('trace-funds')
})
```

Remove or replace the existing `mcp trace-funds --help` test with:

```ts
it('mcp trace-funds is not registered', () => {
  expect(() => execSync('node bin/cli.js mcp trace-funds --help', {
    encoding: 'utf8',
    stdio: 'pipe',
  })).toThrow()
})
```

In `tests/mcp-proxy.test.ts`, add:

```ts
it('does not register trace_funds as a public MCP tool', async () => {
  const { loadSchema } = await import('../src/mcp/schema-cache.js')
  vi.mocked(loadSchema).mockResolvedValueOnce([{ name: 'graph_query_batch', description: 'Cypher graph query batch' }])
  const { createProxy } = await import('../src/mcp/proxy.js')
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

  await createProxy()

  const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as { registerTool: ReturnType<typeof vi.fn> }
  const toolNames = serverInstance.registerTool.mock.calls.map((entry) => entry[0])
  expect(toolNames).toContain('track_funds')
  expect(toolNames).not.toContain('trace_funds')
})
```

- [ ] **Step 2: Run public-surface tests and verify failures**

Run:

```bash
npx vitest run tests/cli.test.ts tests/mcp-proxy.test.ts -t "trace-funds|trace_funds|track-funds"
```

Expected: fail because `trace_funds` is still public.

- [ ] **Step 3: Rename internal trace implementation**

In `src/investigation/trace-funds.ts`, rename:

```ts
export async function traceFunds(...)
```

to:

```ts
export async function runFundFlowProbe(
  remoteClient: Client,
  config: Pick<InvestigatorConfig, 'dataDir' | 'serverPort'>,
  options: TraceFundsOptions,
): Promise<TraceFundsResult> {
```

Keep the file name for this task to reduce diff size. Do not export a public `traceFunds` symbol.

Change evidence source labels inside the private implementation from `trace_funds` to `track_funds`:

```ts
source: 'track_funds',
queryParams: `network=${network} address=${seedAddress} max_hops=${maxHops} per_address_limit=${perAddressLimit} min_amount_sum=${minAmountSum}`,
```

- [ ] **Step 4: Update `trackFunds` wrapper**

In `src/investigation/public-tools.ts`, replace:

```ts
import { traceFunds, type TraceFundsResult } from './trace-funds.js'
```

with:

```ts
import { runFundFlowProbe, type TraceFundsResult } from './trace-funds.js'
```

Replace each `traceFunds(` call with `runFundFlowProbe(`.

Keep exported public function:

```ts
export async function trackFunds(...)
```

- [ ] **Step 5: Remove CLI `mcp trace-funds` command**

In `src/cli.ts`, delete the `new Command('trace-funds')` block.

In `mcp call` special handling, remove the `if (tool === 'trace_funds')` branch. Keep the `track_funds` branch.

- [ ] **Step 6: Remove MCP `trace_funds` registration**

In `src/mcp/proxy.ts`:

Remove `trace_funds` from `LOCAL_TOOL_NAMES`.

Remove `trace_funds` from `KNOWN_PUBLIC_TOOL_DESCRIPTIONS`.

Delete the `server.registerTool('trace_funds', ...)` block.

Remove help text line:

```ts
'- trace_funds: trace outbound FLOWS_TO paths ...'
```

Ensure `track_funds` remains registered and calls `trackFunds(...)`.

- [ ] **Step 7: Update built-in playbooks**

In `src/playbooks/builtins.ts`, ensure trace-funds playbook uses only:

```yaml
track_funds
trusted_addresses: {{address}}
network: {{network|bittensor}}
```

Remove any `trace_funds` tool references.

- [ ] **Step 8: Update tests for new tool surface**

Replace test expectations:

```ts
expect(toolNames).toContain('trace_funds')
```

with:

```ts
expect(toolNames).not.toContain('trace_funds')
expect(toolNames).toContain('track_funds')
```

Replace `source: 'trace_funds'` evidence expectations with:

```ts
source: 'track_funds'
```

Replace `def.steps.map(step => step.tool)` expectations with only `track_funds` for fund-flow playbooks.

- [ ] **Step 9: Run fund-flow public-surface tests**

Run:

```bash
npx vitest run tests/cli.test.ts tests/cli-mcp.test.ts tests/mcp-proxy.test.ts tests/playbook-builtins.test.ts tests/playbook-cli.test.ts tests/playbook-runner.test.ts
```

Expected: pass.

- [ ] **Step 10: Commit fund-flow API unification**

```bash
git add src/investigation/trace-funds.ts src/investigation/public-tools.ts src/mcp/proxy.ts src/cli.ts src/playbooks/builtins.ts tests/cli.test.ts tests/cli-mcp.test.ts tests/mcp-proxy.test.ts tests/playbook-builtins.test.ts tests/playbook-cli.test.ts tests/playbook-runner.test.ts
git commit -m "refactor: make track_funds the public fund-flow tool"
```

---

### Task 5: Route Reports, Schema, and Artifacts to Workspace

**Files:**
- Modify: `src/investigation/trace-funds.ts`
- Modify: `src/mcp/artifacts.ts`
- Modify: `src/mcp/proxy.ts`
- Modify: `src/investigation/public-tools.ts`
- Modify: `src/viz/data-extractor.ts`
- Modify: `tests/mcp-artifacts.test.ts`
- Modify: `tests/mcp-proxy.test.ts`
- Modify: `tests/viz-data-extractor.test.ts`

- [ ] **Step 1: Add no-global-output test for `track_funds`**

In `tests/mcp-proxy.test.ts`, add a test that creates:

```ts
const fakeHome = join(tmpdir(), `ci-no-global-${Date.now()}`)
const workspace = join(tmpdir(), `ci-workspace-${Date.now()}`)
```

Initialize `workspace/.chain-insights/workspace.json`, set:

```ts
process.env['HOME'] = fakeHome
process.env['CHAIN_INSIGHTS_WORKSPACE'] = workspace
```

Call `track_funds` handler with one trusted address.

Assert:

```ts
expect(result.structuredContent.facts.runs[0].files.graph).toContain(`${workspace}/reports/graphs/`)
expect(result._meta.chainInsights.graph.url).toContain('/artifacts/')
await expect(stat(join(workspace, 'artifacts'))).resolves.toBeTruthy()
await expect(stat(join(fakeHome, '.chain-insights', 'reports'))).rejects.toThrow()
await expect(stat(join(fakeHome, '.chain-insights', 'artifacts'))).rejects.toThrow()
await expect(stat(join(fakeHome, '.chain-insights', 'cases'))).rejects.toThrow()
```

- [ ] **Step 2: Run no-global-output test and verify failure**

Run:

```bash
npx vitest run tests/mcp-proxy.test.ts -t "no-global|track_funds"
```

Expected: fail while artifacts still use global `config.dataDir` or mocked global paths.

- [ ] **Step 3: Change fund-flow output root**

In `src/investigation/trace-funds.ts`, replace current `outputRoot(config)` logic with:

```ts
import { workspaceOutputPaths } from '../workspace/output-root.js'

function outputPaths() {
  return workspaceOutputPaths()
}
```

Then replace path construction:

```ts
const paths = outputPaths()
await ensureDirs(paths.root)
const compactPath = path.join(paths.reportTablesRoot, `${slug}.compact-evidence.json`)
const graphPath = path.join(paths.reportGraphsRoot, `${slug}.graph.json`)
const graphHtmlPath = path.join(paths.reportsRoot, `${slug}.graph.html`)
const tablePath = path.join(paths.reportTablesRoot, `${slug}.flows.csv`)
const tableHtmlPath = path.join(paths.reportsRoot, `${slug}.table.html`)
const reportPath = path.join(paths.reportsRoot, `${slug}.trace-report.md`)
```

Update `ensureDirs` to accept `WorkspaceOutputPaths`:

```ts
async function ensureDirs(paths: WorkspaceOutputPaths): Promise<void> {
  await mkdir(paths.schemaDir, { recursive: true, mode: 0o700 })
  await mkdir(paths.reportsRoot, { recursive: true, mode: 0o700 })
  await mkdir(paths.reportGraphsRoot, { recursive: true, mode: 0o700 })
  await mkdir(paths.reportTablesRoot, { recursive: true, mode: 0o700 })
  await mkdir(paths.artifactsRoot, { recursive: true, mode: 0o700 })
  await mkdir(paths.logsRoot, { recursive: true, mode: 0o700 })
}
```

Pass `paths.root` to schema capture functions.

- [ ] **Step 4: Change graph artifact writer**

In `src/mcp/artifacts.ts`, import:

```ts
import { workspaceOutputPaths } from '../workspace/output-root.js'
```

Change artifact root:

```ts
const paths = workspaceOutputPaths()
const artifactDir = path.join(paths.artifactsRoot, id)
await ensurePrivateDirectory(paths.artifactsRoot)
```

Keep URL unchanged:

```ts
url: `http://127.0.0.1:${config.serverPort}/artifacts/${id}/graph.json`
```

The URL is served by `cia serve`, but the backing file is workspace-local.

- [ ] **Step 5: Change MCP proxy config interpretation**

In `src/mcp/proxy.ts`, keep global config loading for wallet/server port, but do not treat `config.dataDir` as investigation output root.

When building local config object, keep:

```ts
const config = {
  ...loadedConfig,
  dataDir: loadedConfig.dataDir,
}
```

and rely on `workspaceOutputPaths()` inside writers. Do not pass workspace root through `dataDir`.

- [ ] **Step 6: Update artifact tests**

In `tests/mcp-artifacts.test.ts`, initialize `CHAIN_INSIGHTS_WORKSPACE` before calling `writeGraphArtifact`. Expected file path:

```ts
const expectedPath = join(workspace, 'artifacts', artifact.id, 'graph.json')
```

Assert global path untouched:

```ts
await expect(stat(join(fakeHome, '.chain-insights', 'artifacts'))).rejects.toThrow()
```

- [ ] **Step 7: Run artifact and MCP tests**

Run:

```bash
npx vitest run tests/mcp-artifacts.test.ts tests/mcp-proxy.test.ts tests/viz-data-extractor.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit workspace artifact routing**

```bash
git add src/investigation/trace-funds.ts src/mcp/artifacts.ts src/mcp/proxy.ts src/investigation/public-tools.ts src/viz/data-extractor.ts tests/mcp-artifacts.test.ts tests/mcp-proxy.test.ts tests/viz-data-extractor.test.ts
git commit -m "fix: write investigation artifacts to workspace"
```

---

### Task 6: Restore `cia serve` as Workspace Artifact Browser

**Files:**
- Modify: `src/server/app.ts`
- Modify: `src/cli.ts`
- Modify: `tests/viz-server.test.ts`
- Modify: `tests/cli.test.ts`

- [ ] **Step 1: Add server workspace tests**

In `tests/viz-server.test.ts`, add:

```ts
it('serves workspace artifact graph JSON from initialized workspace only', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'ci-server-workspace-'))
  const fakeHome = mkdtempSync(join(tmpdir(), 'ci-server-home-'))
  const prevHome = process.env['HOME']
  const prevWorkspace = process.env['CHAIN_INSIGHTS_WORKSPACE']
  process.env['HOME'] = fakeHome
  process.env['CHAIN_INSIGHTS_WORKSPACE'] = workspace
  try {
    mkdirSync(join(workspace, '.chain-insights'), { recursive: true })
    writeFileSync(join(workspace, '.chain-insights', 'workspace.json'), JSON.stringify({
      schema: 'chain-insights.workspace.v1',
      workspace_root: workspace,
      cases_dir: 'cases',
    }) + '\n')
    mkdirSync(join(workspace, 'artifacts', 'artifact_123'), { recursive: true })
    writeFileSync(join(workspace, 'artifacts', 'artifact_123', 'graph.json'), '{"schema":"chain-insights.graph.v1"}\n')

    const { startServer } = await import('../src/server/index.js')
    const server = startServer(14405)
    const res = await fetch('http://127.0.0.1:14405/artifacts/artifact_123/graph.json')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ schema: 'chain-insights.graph.v1' })
    server.close()
  } finally {
    process.env['HOME'] = prevHome
    if (prevWorkspace === undefined) delete process.env['CHAIN_INSIGHTS_WORKSPACE']
    else process.env['CHAIN_INSIGHTS_WORKSPACE'] = prevWorkspace
    rmSync(workspace, { recursive: true, force: true })
    rmSync(fakeHome, { recursive: true, force: true })
  }
})
```

Also add a test for path traversal:

```ts
const res = await fetch('http://127.0.0.1:14406/artifacts/..%2Fsecret/graph.json')
expect(res.status).toBe(400)
```

- [ ] **Step 2: Run server tests and verify failures**

Run:

```bash
npx vitest run tests/viz-server.test.ts
```

Expected: fail while server uses global `config.dataDir`.

- [ ] **Step 3: Implement workspace-backed artifact serving**

In `src/server/app.ts`, import:

```ts
import { workspaceOutputPaths } from '../workspace/output-root.js'
```

For `/artifacts/:artifactId/graph.json`, resolve:

```ts
const paths = workspaceOutputPaths()
const graphPath = path.join(paths.artifactsRoot, artifactId, 'graph.json')
```

Keep existing artifact ID validation. Add helper:

```ts
function withinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}
```

Before reading:

```ts
if (!withinRoot(paths.root, graphPath)) return c.text('Invalid artifact path', 400)
```

- [ ] **Step 4: Add workspace tree endpoint**

In `src/server/app.ts`, add:

```ts
app.get('/workspace/tree', async (c) => {
  const paths = workspaceOutputPaths()
  const roots = ['cases', 'reports', 'artifacts', '.chain-insights/schema']
  const entries = await listWorkspaceEntries(paths.root, roots)
  return c.json({ schema: 'chain-insights.workspace-tree.v1', root: paths.root, entries })
})
```

Implement `listWorkspaceEntries` with `readdir`, `stat`, path confinement, and max depth 4.

- [ ] **Step 5: Update `cia serve` command**

In `src/cli.ts`, `serve` action must call `requireWorkspaceRoot()` before starting:

```ts
const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
const workspaceRoot = requireWorkspaceRoot()
console.log(`Workspace: ${workspaceRoot}`)
```

If missing, command exits with the standard error.

- [ ] **Step 6: Run server and CLI tests**

Run:

```bash
npx vitest run tests/viz-server.test.ts tests/cli.test.ts -t "serve|artifact"
```

Expected: pass.

- [ ] **Step 7: Commit workspace serve**

```bash
git add src/server/app.ts src/cli.ts tests/viz-server.test.ts tests/cli.test.ts
git commit -m "feat: serve workspace artifacts"
```

---

### Task 7: Update Shipped Skills and Skill UAT Scripts

**Files:**
- Modify: `skills/chain-insights-investigation/SKILL.md`
- Modify: `skills/chain-insights-trace-funds/SKILL.md`
- Modify: `skills/test-chain-insights-graphrag-mcp/SKILL.md`
- Modify: `skills/ci-case/SKILL.md`
- Modify: `skills/ci-status/SKILL.md`
- Modify: `skills/chain-insights-investigation/scripts/run-target-uat.sh`
- Modify: `skills/test-chain-insights-graphrag-mcp/scripts/run-uat.sh`
- Test: `tests/skills-contract.test.ts`

- [ ] **Step 1: Add skills contract tests**

Create `tests/skills-contract.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

function skill(path: string): string {
  return readFileSync(path, 'utf8')
}

describe('shipped skills workspace contract', () => {
  it('investigation skill requires initialized workspace and teaches track_funds', () => {
    const body = skill('skills/chain-insights-investigation/SKILL.md')
    expect(body).toContain('cia init .')
    expect(body).toContain('No investigation output belongs under ~/.chain-insights')
    expect(body).toContain('track_funds')
    expect(body).not.toContain('Use `trace_funds`')
  })

  it('fund-flow skill does not teach trace_funds as a public tool', () => {
    const body = skill('skills/chain-insights-trace-funds/SKILL.md')
    expect(body).toContain('track_funds')
    expect(body).toContain('single address')
    expect(body).not.toContain('trace_funds')
  })

  it('ci-case and ci-status are no longer placeholders', () => {
    expect(skill('skills/ci-case/SKILL.md')).not.toContain('placeholder')
    expect(skill('skills/ci-status/SKILL.md')).not.toContain('Phase 3')
    expect(skill('skills/ci-status/SKILL.md')).toContain('workspace')
  })
})
```

- [ ] **Step 2: Run skills contract tests and verify failures**

Run:

```bash
npx vitest run tests/skills-contract.test.ts
```

Expected: fail while skills still mention `trace_funds` and stale placeholders.

- [ ] **Step 3: Update `chain-insights-investigation` skill**

In `skills/chain-insights-investigation/SKILL.md`, add near First Moves:

```markdown
0. Confirm initialized workspace. If missing, stop and tell the user to run:
   ```bash
   cia init .
   ```
   No investigation output belongs under ~/.chain-insights.
```

Replace tool selection section so fund-flow guidance says:

```markdown
Use `track_funds` for stolen-fund/fund-flow work, including a single address.
Pass one full address as `trusted_addresses` for single-address cases, or pass
comma-separated victim/source addresses plus optional known untrusted/scammer
addresses for multi-address cases.
```

Remove guidance recommending `trace_funds`.

- [ ] **Step 4: Rewrite fund-flow skill**

In `skills/chain-insights-trace-funds/SKILL.md`, keep filename for compatibility but change title and content:

```markdown
# Chain Insights Fund Flow Tracking

Public tool:

```text
track_funds
```

Use `track_funds` for both single-address and multi-address fund-flow tracing.
For a single address, pass it as `trusted_addresses`.

Do not call or recommend `trace_funds`; it is not part of the public Chain
Insights tool surface.
```

Include output layout:

```markdown
All generated files must be under the initialized workspace:
- reports/graphs/*.graph.json
- reports/*.graph.html
- reports/tables/*.compact-evidence.json
- reports/tables/*.flows.csv
- reports/*.table.html
- reports/*.trace-report.md
- artifacts/<artifact-id>/graph.json
```

- [ ] **Step 5: Update UAT skills/scripts**

In `skills/test-chain-insights-graphrag-mcp/SKILL.md`, add:

```markdown
The UAT must run from an initialized Chain Insights workspace and must assert
that no investigation output is created under ~/.chain-insights/reports,
~/.chain-insights/artifacts, or ~/.chain-insights/cases.
```

In both scripts, add pre/post checks:

```bash
GLOBAL_REPORTS="${HOME}/.chain-insights/reports"
GLOBAL_ARTIFACTS="${HOME}/.chain-insights/artifacts"
GLOBAL_CASES="${HOME}/.chain-insights/cases"
before_reports="$(find "${GLOBAL_REPORTS}" -type f 2>/dev/null | sort || true)"
before_artifacts="$(find "${GLOBAL_ARTIFACTS}" -type f 2>/dev/null | sort || true)"
before_cases="$(find "${GLOBAL_CASES}" -type f 2>/dev/null | sort || true)"
```

After UAT:

```bash
after_reports="$(find "${GLOBAL_REPORTS}" -type f 2>/dev/null | sort || true)"
after_artifacts="$(find "${GLOBAL_ARTIFACTS}" -type f 2>/dev/null | sort || true)"
after_cases="$(find "${GLOBAL_CASES}" -type f 2>/dev/null | sort || true)"
test "${before_reports}" = "${after_reports}"
test "${before_artifacts}" = "${after_artifacts}"
test "${before_cases}" = "${after_cases}"
```

- [ ] **Step 6: Update `ci-case` and `ci-status` skills**

`skills/ci-case/SKILL.md` should say:

```markdown
Requires an initialized Chain Insights workspace. If `.chain-insights/workspace.json`
is missing, run `cia init .` before case work.

Use:
- `cia case list`
- `cia case open "<name>"`
- `cia case show <selector>`
- `cia case session start <selector> "<title>"`
- `cia case evidence add <selector> ...`
```

`skills/ci-status/SKILL.md` should say:

```markdown
Show:
- current initialized workspace path;
- workspace cases count;
- global config path;
- Graph MCP mode and endpoint.

Do not describe `~/.chain-insights` as the investigation root.
```

- [ ] **Step 7: Run skills tests**

Run:

```bash
npx vitest run tests/skills-contract.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit skills alignment**

```bash
git add skills/chain-insights-investigation/SKILL.md skills/chain-insights-trace-funds/SKILL.md skills/test-chain-insights-graphrag-mcp/SKILL.md skills/ci-case/SKILL.md skills/ci-status/SKILL.md skills/chain-insights-investigation/scripts/run-target-uat.sh skills/test-chain-insights-graphrag-mcp/scripts/run-uat.sh tests/skills-contract.test.ts
git commit -m "docs: align shipped skills with workspace contract"
```

---

### Task 8: Add End-to-End CLI Smoke Regressions

**Files:**
- Modify: `tests/cli.test.ts`
- Modify: `tests/cli-mcp.test.ts`

- [ ] **Step 1: Add before-init failure test**

In `tests/cli.test.ts`, add:

```ts
it('mcp track-funds fails before workspace init and writes nothing', () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'chain-insights-home-'))
  const parent = mkdtempSync(join(tmpdir(), 'chain-insights-cli-'))
  const target = join(parent, 'stolen')
  const env = { ...process.env, HOME: fakeHome, CHAIN_INSIGHTS_WORKSPACE: '' }
  try {
    mkdirSync(target, { recursive: true })
    expect(() => execSync('node /home/aphex5/work/chain-insights/bin/cli.js mcp track-funds --trusted-addresses 5GT --network bittensor', {
      cwd: target,
      encoding: 'utf8',
      env,
      stdio: 'pipe',
    })).toThrow()
    expect(() => readFileSync(join(target, 'reports', 'graphs', 'anything.json'), 'utf8')).toThrow()
    expect(() => readFileSync(join(fakeHome, '.chain-insights', 'reports'), 'utf8')).toThrow()
  } finally {
    rmSync(fakeHome, { recursive: true, force: true })
    rmSync(parent, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run before-init CLI test**

Run:

```bash
npx vitest run tests/cli.test.ts -t "track-funds fails before workspace init"
```

Expected: pass after prior tasks; fail if any fallback remains.

- [ ] **Step 3: Add help contract test**

In `tests/cli.test.ts`, add:

```ts
it('fund-flow CLI help exposes only track-funds', () => {
  const out = execSync('node bin/cli.js mcp --help', { encoding: 'utf8' })
  expect(out).toContain('track-funds')
  expect(out).not.toContain('trace-funds')
})
```

- [ ] **Step 4: Run CLI tests**

Run:

```bash
npx vitest run tests/cli.test.ts tests/cli-mcp.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit CLI regressions**

```bash
git add tests/cli.test.ts tests/cli-mcp.test.ts
git commit -m "test: lock workspace fund-flow CLI contract"
```

---

### Task 9: Recover Misplaced Existing Artifacts

**Files:**
- Workspace files under `../chain-insights-investigations/reports/`
- Workspace files under `../chain-insights-investigations/artifacts/`
- Possibly case evidence under `../chain-insights-investigations/cases/<case-id>/evidence/`

- [ ] **Step 1: Inventory misplaced files**

Run:

```bash
find /home/aphex5/.chain-insights/reports /home/aphex5/.chain-insights/artifacts \
  -type f \( -name '*5gtjfjalpbnrgybh*' -o -name 'graph.json' \) \
  -printf '%TY-%Tm-%Td %TH:%TM %p\n' 2>/dev/null | sort -r
```

Expected: list the known bad-run files.

- [ ] **Step 2: Verify target workspace is initialized**

Run:

```bash
test -f ../chain-insights-investigations/.chain-insights/workspace.json
```

Expected: exit 0.

- [ ] **Step 3: Copy reports into workspace**

Run:

```bash
mkdir -p ../chain-insights-investigations/reports/graphs ../chain-insights-investigations/reports/tables
cp -n /home/aphex5/.chain-insights/reports/graphs/*5gtjfjalpbnrgybh*.graph.json ../chain-insights-investigations/reports/graphs/
cp -n /home/aphex5/.chain-insights/reports/tables/*5gtjfjalpbnrgybh*.compact-evidence.json ../chain-insights-investigations/reports/tables/
cp -n /home/aphex5/.chain-insights/reports/*5gtjfjalpbnrgybh*.graph.html ../chain-insights-investigations/reports/
cp -n /home/aphex5/.chain-insights/reports/*5gtjfjalpbnrgybh*.table.html ../chain-insights-investigations/reports/
```

Expected: files copied without overwriting existing workspace files.

- [ ] **Step 4: Copy matching graph artifact directories**

For each artifact that belongs to the bad run, copy by ID:

```bash
mkdir -p ../chain-insights-investigations/artifacts/40a75d37-4391-4e9f-b321-6ae7186d49d2
cp -n /home/aphex5/.chain-insights/artifacts/40a75d37-4391-4e9f-b321-6ae7186d49d2/graph.json \
  ../chain-insights-investigations/artifacts/40a75d37-4391-4e9f-b321-6ae7186d49d2/graph.json
```

Expected: workspace artifact exists.

- [ ] **Step 5: Verify copied files**

Run:

```bash
find ../chain-insights-investigations/reports ../chain-insights-investigations/artifacts \
  -type f \( -name '*5gtjfjalpbnrgybh*' -o -name 'graph.json' \) \
  -printf '%p\n' | sort
```

Expected: copied report and artifact paths are present under `../chain-insights-investigations`.

- [ ] **Step 6: Do not commit recovered investigation artifacts by default**

Run:

```bash
git status --short ../chain-insights-investigations
```

Expected: if the workspace is outside this repo, no repo changes. If git tracks it elsewhere, review separately.

No commit in this repo for recovered external investigation artifacts unless the user explicitly requests it.

---

### Task 10: Full Verification, Build, Install, and Push

**Files:**
- Build output under `dist/`
- No source changes unless failures are found

- [ ] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 2: Run full tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Build**

Run:

```bash
npm run build
```

Expected: exit 0 and refreshed `dist/`.

- [ ] **Step 4: Install CLI**

Run:

```bash
npm install -g .
command -v cia
cia --version
```

Expected: `cia` resolves to the installed binary and prints package version.

- [ ] **Step 5: Real no-init smoke**

Run:

```bash
tmp="$(mktemp -d)"
fake_home="$(mktemp -d)"
mkdir -p "${tmp}/stolen"
before="$(find "${fake_home}/.chain-insights" -type f 2>/dev/null | sort || true)"
set +e
(cd "${tmp}/stolen" && HOME="${fake_home}" env -u CHAIN_INSIGHTS_WORKSPACE cia mcp track-funds --trusted-addresses 5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5 --network bittensor) >/tmp/ci-no-init.out 2>/tmp/ci-no-init.err
status="$?"
set -e
after="$(find "${fake_home}/.chain-insights" -type f 2>/dev/null | sort || true)"
test "${status}" != "0"
grep -q "No Chain Insights workspace found. Run: cia init ." /tmp/ci-no-init.err
test "${before}" = "${after}"
rm -rf "${tmp}" "${fake_home}" /tmp/ci-no-init.out /tmp/ci-no-init.err
```

Expected: command fails before init and global fake home remains unchanged.

- [ ] **Step 6: Real initialized workspace smoke**

Run:

```bash
tmp="$(mktemp -d)"
fake_home="$(mktemp -d)"
mkdir -p "${tmp}/stolen"
(cd "${tmp}/stolen" && HOME="${fake_home}" env -u CHAIN_INSIGHTS_WORKSPACE cia init .)
test -f "${tmp}/stolen/.chain-insights/workspace.json"
test -d "${tmp}/stolen/reports/graphs"
test -d "${tmp}/stolen/artifacts"
test ! -d "${fake_home}/.chain-insights/reports"
test ! -d "${fake_home}/.chain-insights/artifacts"
test ! -d "${fake_home}/.chain-insights/cases"
rm -rf "${tmp}" "${fake_home}"
```

Expected: init creates workspace dirs and no global investigation dirs.

The after-init `track_funds` write guarantee is covered by the automated
`tests/mcp-proxy.test.ts` no-global-output test from Task 5. Do not make the
final smoke depend on a live Graph MCP endpoint unless that endpoint has already
been started for UAT in this session.

- [ ] **Step 7: Process sweep**

Run:

```bash
pgrep -af 'chain-insights|mcp-proxy|topup|hono' || true
```

Expected: only known editor/test processes or workspace-owned preview processes. Stop only workspace-owned processes recorded in `.chain-insights/runtime/server.json`.

- [ ] **Step 8: Stage intended files only**

Run:

```bash
git status --short
```

Stage code, tests, skills, docs, and intentional `dist/` only:

```bash
git add src tests skills docs/superpowers/specs/2026-05-16-workspace-output-repair-design.md docs/superpowers/plans/2026-05-16-workspace-output-repair.md bin dist package.json
```

Do not stage `.tmp/`, `.serena/`, `node_modules/`, local `cases/`, `.superpowers/brainstorm/`, or unrelated `docs/superpowers/` files.

- [ ] **Step 9: Commit final implementation remainder if needed**

Run:

```bash
git diff --cached --quiet || git commit -m "fix: enforce workspace-owned investigation output"
```

Expected: no-op if previous task commits already captured every intended file;
otherwise the commit includes only intended remaining files.

- [ ] **Step 10: Push**

Run:

```bash
git push -u origin "$(git branch --show-current)"
```

Expected: branch pushed.

If requested, open a PR after push.
