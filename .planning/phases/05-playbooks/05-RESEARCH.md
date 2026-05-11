# Phase 05: Playbooks - Research

**Researched:** 2026-05-11
**Domain:** Markdown-declared multi-step investigation workflow engine
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Playbook Format & Declaration**
- Playbooks are markdown files with YAML frontmatter for metadata + ordered H2 sections per step, each with `tool:` and `params:` code blocks — matches evidence file pattern from Phase 3
- Built-in playbooks in `src/playbooks/` bundled with dist, user playbooks in `~/.chain-insights/playbooks/`
- Name resolution: search user dir first, then built-in dir — user can override built-in playbooks by name
- Playbooks support parameters via YAML frontmatter `params:` array (name/type/required), injected via `{{param}}` template syntax in step definitions

**Runner Execution Model**
- Sequential execution — each step calls an MCP tool via `@x402/fetch`, waits for response, stores result as evidence in the case, then proceeds to next step
- Timeout: auto-retry 3x (no cost — x402 charges only after successful MCP execution)
- MCP error: stop and report which step failed, what error, what completed so far
- x402 payment failure (insufficient funds): pause and prompt user to fund wallet, allow `retry` to continue from same step
- User can re-run from a failed step with `--from N`
- No active case required — if no `--case` specified, auto-create a quick case (`quick_{timestamp}_{playbook-name}`) so results are always stored as evidence
- Dry-run mode: `--dry-run` shows what steps would execute, what MCP tools would be called, estimated x402 cost per step. No actual calls made

**Output & Built-in Playbooks**
- Each step result stored as evidence file in the case (Phase 3 evidence store pattern). Runner prints progress: `Step 1/3: trace-funds... ✓ (2 hops found)`. Final summary with key findings to stdout
- trace-funds and risk-check are built-in MCP tool actions — playbooks orchestrate them and process their entire output into evidence
- 3 built-in playbooks: trace-funds (query address → follow hops → build graph → auto-viz), risk-check (query address → check exposure → score), entity-profile (query address → gather history → build dossier)
- trace-funds: 2 hops by default, configurable via `hops` parameter
- trace-funds auto-generates visualization (Phase 4's `generateVisualization`) if case has transaction data. Other playbooks do not auto-viz

### Claude's Discretion
- Internal playbook parser implementation details
- Step result formatting before evidence storage
- Progress display formatting and verbosity levels
- Error message wording for x402 failures and MCP errors

### Deferred Ideas (OUT OF SCOPE)
- Playbook composition (one playbook calling another) — v2
- Conditional branching in playbooks (if/else based on step results) — v2
- Playbook marketplace/sharing — future
- Parallel step execution — future
- Cost estimation before full playbook run — future (would need MCP pricing metadata)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLAY-01 | Basic playbook runner — execute markdown-declared multi-step investigation workflows | Playbook parser (H2-step extraction, frontmatter, `{{param}}` template), runner loop (sequential MCP calls, retry, `--from N` resume, `--dry-run`), quick case auto-creation |
| PLAY-02 | Built-in starter playbooks (trace-funds, risk-check, entity-profile) | Three markdown playbook files in `src/playbooks/`, bundled via tsdown, auto-viz integration for trace-funds via `generateVisualization()` |
</phase_requirements>

---

## Summary

Phase 5 adds the playbook engine — the capstone workflow layer that ties together every previous phase. The engine has two distinct components: a **parser** that turns a markdown file into an ordered list of typed step definitions, and a **runner** that executes those steps sequentially against the live MCP, persisting each result as case evidence.

The implementation is almost entirely new code (no equivalent exists in the codebase), but it sits entirely on top of already-proven infrastructure. The key integration surfaces are: `parseFrontmatter()` for reading playbook files, `client.callTool()` (via `@x402/fetch`) for executing steps, `EvidenceStore.append()` for persisting results, `CaseStore.create()` for quick-case auto-creation, and `generateVisualization()` for the trace-funds auto-viz. All of these APIs are understood and working.

The main engineering work is the markdown-to-step parser (H2 section extraction with fenced code block parsing), the `{{param}}` template substitution engine, the three-layer error model (timeout-retry vs MCP error vs x402 failure), the `--from N` step-offset resume, and the three built-in playbook files that exercise all the above. The `frontmatter.ts` parser is currently flat-key only — the playbook format requires the `params:` array in frontmatter, which will need special handling.

**Primary recommendation:** Implement in two plans — Plan 1: playbook parser + runner engine (`src/playbooks/runner.ts`, `src/playbooks/parser.ts`), Plan 2: three built-in playbook files + CLI wiring + Vitest coverage.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Playbook file parsing | src/playbooks/parser.ts | — | Pure data transformation: markdown text in, typed step array out. No I/O side effects. |
| Template substitution (`{{param}}`) | src/playbooks/parser.ts | — | Applied at parse-time after CLI params are resolved, before steps execute. |
| Step execution loop | src/playbooks/runner.ts | src/mcp/client.ts | Runner owns orchestration; MCP client owns transport/payment. |
| Retry / error handling | src/playbooks/runner.ts | — | Three-layer model (timeout-retry, MCP error stop, x402 pause) lives in runner. |
| Quick case auto-creation | src/playbooks/runner.ts | src/cases/store.ts | Runner decides when to auto-create; CaseStore owns the creation. |
| Evidence persistence | src/cases/evidence.ts | — | Unchanged; runner calls EvidenceStore.append() after each step. |
| Auto-viz (trace-funds) | src/playbooks/runner.ts | src/viz/index.ts | Runner triggers generateVisualization() post-execution if step data is present. |
| CLI wiring | src/cli.ts | — | New `playbook` Commander subcommand added to existing program. |
| Built-in playbook files | src/playbooks/ | — | Bundled as static markdown assets via tsdown; read at runtime from dist/. |
| User playbook discovery | src/playbooks/runner.ts | — | fs.access() check on `~/.chain-insights/playbooks/<name>.md` before falling back to built-in. |

---

## Standard Stack

No new dependencies are required. Phase 5 is implemented entirely with already-installed packages.

### Core (existing, no additions)
| Library | Version | Purpose | Source |
|---------|---------|---------|--------|
| `@modelcontextprotocol/sdk` | 1.29.x | MCP client.callTool() for step execution | [VERIFIED: already in package.json] |
| `@x402/fetch` | 2.1.x | Payment-wrapping fetch — used inside createMcpFetchClient() | [VERIFIED: already in package.json] |
| `zod` | 4.4.x | PlaybookSchema, StepSchema for parsed playbook validation | [VERIFIED: already in package.json] |
| `commander` | 14.0.x | `program.command('playbook')` subcommand | [VERIFIED: already in package.json] |
| Node.js `fs/promises` | built-in | Read playbook files from disk | [VERIFIED: used throughout existing code] |
| Node.js `readline` | built-in | Interactive `retry` prompt on x402 payment failure | [VERIFIED: built-in, no install needed] |

**No `npm install` needed for this phase.**

---

## Architecture Patterns

### System Architecture Diagram

```
CLI (chain-insights playbook run <name>)
         |
         v
  PlaybookResolver
  (user dir → built-in dir)
         |
         v
  PlaybookParser.parse(markdown)
  ├── parseFrontmatter() → metadata, params spec
  ├── extractSteps() → H2 sections → [{tool, params}]
  └── applyTemplate({{param}} → resolved values)
         |
         v
  PlaybookRunner.run(playbook, resolvedParams, opts)
  ├── ensure case (CaseStore.get | CaseStore.create quick)
  ├── if --dry-run → print steps + estimated cost, exit
  └── for step N of steps (starting from --from N or 1):
       ├── callTool(step.tool, step.params) via MCP client
       │    ├── timeout → retry up to 3x (no x402 charge)
       │    ├── x402 failure → pause + readline prompt → retry same step
       │    └── MCP error → report failure, stop
       ├── EvidenceStore.append(caseId, {source: step.tool, content: result})
       └── print "Step N/M: <tool>... ✓ (<summary>)"
         |
         v (after all steps)
  trace-funds only: generateVisualization({caseId})
         |
         v
  print final summary to stdout
```

### Recommended Project Structure

```
src/
├── playbooks/
│   ├── parser.ts         # PlaybookParser: markdown → typed PlaybookDefinition
│   ├── runner.ts         # PlaybookRunner: execute steps, handle errors, auto-case
│   ├── schema.ts         # Zod schemas: PlaybookSchema, StepSchema, ParamSpec
│   ├── resolver.ts       # Name → file path (user dir first, built-in fallback)
│   ├── trace-funds.md    # Built-in playbook: address tracing with auto-viz
│   ├── risk-check.md     # Built-in playbook: exposure + risk scoring
│   └── entity-profile.md # Built-in playbook: address history + dossier
├── cli.ts                # + playbook subcommand (run, list, show)
```

### Pattern 1: Playbook File Format (locked decision)

Markdown with YAML frontmatter + H2 step sections. Each step has fenced `tool:` and `params:` blocks.

```markdown
---
name: trace-funds
description: Trace fund flows from a target address
version: 1.0.0
params:
  - name: address
    type: string
    required: true
  - name: hops
    type: number
    required: false
    default: "2"
---

## Step 1: Query Address

```tool
trace_funds
```

```params
address: {{address}}
hops: {{hops}}
```

## Step 2: Build Graph

```tool
get_transaction_graph
```

```params
root: {{address}}
depth: {{hops}}
```
```

**Note on frontmatter parser limitation:** `parseFrontmatter()` in `src/cases/frontmatter.ts` supports only flat `key: value` pairs. The `params:` array in playbook frontmatter requires either (a) a special array parser added to the existing frontmatter module, or (b) parsing `params:` as a comma-separated string like `"address:string:required,hops:number:optional"`. Option (b) avoids modifying shared code but is less readable. **Discretionary choice for planner.**

### Pattern 2: Step Extraction from Markdown Body

Extract H2 sections from the body, then extract fenced code blocks by language label:

```typescript
// Source: [ASSUMED] - based on existing parseFrontmatter() pattern in frontmatter.ts
function extractSteps(body: string): RawStep[] {
  // Split on H2 headings
  const sections = body.split(/^## /m).slice(1)
  return sections.map(section => {
    const toolMatch = section.match(/```tool\n([\s\S]*?)```/)
    const paramsMatch = section.match(/```params\n([\s\S]*?)```/)
    return {
      label: section.split('\n')[0].trim(),
      tool: toolMatch?.[1].trim() ?? '',
      rawParams: paramsMatch?.[1] ?? '',
    }
  })
}
```

### Pattern 3: Template Substitution

Simple string replace — no template library needed:

```typescript
// Source: [ASSUMED] - standard string replacement, no deps
function applyTemplate(text: string, params: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => params[key] ?? `{{${key}}}`)
}
```

### Pattern 4: MCP Tool Call (existing pattern, from src/cli.ts)

The runner reuses the exact pattern already established in `mcp call` and the proxy:

```typescript
// Source: [VERIFIED: src/cli.ts lines 173-191]
const client = new Client({ name: 'chain-insights-playbook', version: '0.1.0' })
await client.connect(new StreamableHTTPClientTransport(new URL(config.mcpEndpoint), { fetch: paymentFetch }))
try {
  const result = await client.callTool({ name: toolName, arguments: params })
  const content = result.content as Array<{ type: string; text?: string }>
  return content.filter(c => c.type === 'text').map(c => c.text ?? '').join('\n')
} finally {
  await client.close()
}
```

**Important:** The existing pattern opens a new MCP client per call. For the playbook runner executing N steps, a single client connection should be opened before the loop and closed after — not one-per-step. This avoids N separate transport negotiation round-trips and x402 overhead.

### Pattern 5: Quick Case Auto-Creation

```typescript
// Source: [VERIFIED: src/cases/store.ts CaseStore.create()]
const quickName = `quick_${Date.now()}_${playbookName}`
const qcase = await CaseStore.create({ name: quickName, tags: ['quick', 'playbook'], description: `Auto-created by playbook: ${playbookName}` })
// Note: CaseStore.create() calls getDb() internally — db must be initialized first
```

**Constraint:** `CaseStore.create()` requires `initSchema(conn)` to have been called before it runs (see cli.ts case open action pattern — lines 207-213). The runner must call `initSchema` once before case operations.

### Pattern 6: Evidence Storage (per step)

```typescript
// Source: [VERIFIED: src/cases/evidence.ts EvidenceStore.append()]
await EvidenceStore.append(caseId, {
  source: step.tool,               // MCP tool name — sanitized to 40 chars in evidence.ts
  content: stepResult,             // Full text response from MCP
  queryParams: JSON.stringify(step.params),
})
```

### Pattern 7: Interactive Retry Prompt (x402 payment failure)

```typescript
// Source: [ASSUMED] - node:readline standard pattern
import { createInterface } from 'node:readline'
async function promptRetry(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(`${message} (retry/skip/abort): `, answer => {
      rl.close()
      resolve(answer.trim().toLowerCase() === 'retry')
    })
  })
}
```

### Pattern 8: Built-in Playbook Path Resolution

Built-in playbooks are bundled markdown files in `src/playbooks/`. tsdown copies non-TS assets or they can be inlined. The safe pattern (matching how `bin/install.cjs` resolves paths) is `import.meta.url`:

```typescript
// Source: [VERIFIED: src/cli.ts lines 13-14 — identical pattern]
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const builtinDir = path.join(__dirname) // .md files live alongside .js in dist/playbooks/
```

**Bundler note:** tsdown (Rolldown) does not automatically copy `.md` files to `dist/`. The build config (`tsdown.config.ts`) will need a `copyPublicDir` or equivalent to bundle the `.md` files — or they can be embedded as string literals in a TypeScript file. **Discretionary: recommend embedding as string constants** to avoid build config complexity and asset-copying at install time.

### Anti-Patterns to Avoid

- **Opening N MCP connections for N steps:** The MCP client should be connected once, reused across all steps, then closed. One connection per step multiplies auth overhead and x402 payment initiation latency.
- **Treating `parseFrontmatter()` as YAML-aware:** The existing parser is deliberately flat-key only (see frontmatter.ts line 9 — only handles `key: value`). Do not pass it raw YAML arrays without first extracting the `params:` block specially.
- **Calling `CaseStore.create()` without `initSchema`:** The DuckDB schema must exist before any `INSERT INTO cases` call. Follow the cli.ts pattern of calling `initSchema(conn)` once before case operations.
- **Writing step results directly to filesystem without EvidenceStore:** The evidence manifest (`manifest.json`) must be updated alongside each file write. Always go through `EvidenceStore.append()` — never write evidence files directly.
- **Auto-viz failure crashing the run:** `generateVisualization()` throws if no transaction data is found (see viz/index.ts line 30). For trace-funds, wrap the auto-viz call in try/catch and print a warning, not a fatal error — the evidence is already stored even if viz fails.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP tool invocation | Custom HTTP client with x402 logic | `createMcpFetchClient()` + MCP SDK `client.callTool()` | x402 payment challenge/response already handled transparently |
| Evidence file writing + SHA manifest | Custom file writer | `EvidenceStore.append()` | Manifest integrity, sequence collision handling, mode 0o600 all built in |
| Case creation | Direct filesystem writes | `CaseStore.create()` | DuckDB index + directory structure + manifest init |
| YAML parsing for params | Full YAML parser (js-yaml) | Parse params array from frontmatter as special case | No new dependency needed — params spec is simple and bounded |
| Template engine | Handlebars / mustache | Simple `string.replace(/\{\{(\w+)\}\}/g)` | Scope is bounded to `{{name}}` substitution only — full template engine is scope creep |

**Key insight:** The playbook runner is orchestration glue, not infrastructure. Every hard problem (MCP payments, evidence integrity, case persistence, visualization) is already solved by the layers below it.

---

## Common Pitfalls

### Pitfall 1: Frontmatter Parser Cannot Handle YAML Arrays
**What goes wrong:** Calling `parseFrontmatter()` on a playbook file with a `params:` array like `- name: address` will silently discard lines not matching `key: value` format.
**Why it happens:** `frontmatter.ts` line 8: `const colon = line.indexOf(':')` — lines beginning with `-` are skipped without error.
**How to avoid:** Either (a) add an `extractBlock()` helper that splits out the `params:` YAML block before calling `parseFrontmatter()`, or (b) define params as a single-line string in frontmatter: `params: address:string:required,hops:number:optional:2`. Decision is discretionary.
**Warning signs:** `playbook.params` comes back as an empty array even though the frontmatter has `params:` entries.

### Pitfall 2: MCP Client Connection Lifecycle
**What goes wrong:** Opening a new MCP `Client` + `StreamableHTTPClientTransport` for each step leaves connections unclosed on error paths, and multiplies x402 overhead.
**Why it happens:** The existing `mcp call` CLI action (cli.ts lines 174-191) opens/closes per call — fine for single calls, wrong for a multi-step loop.
**How to avoid:** In the runner, open one connection before the step loop, use `finally` to close it, and handle SSE fallback once at connection time (see proxy.ts lines 40-56 for the fallback pattern).
**Warning signs:** Connection timeout errors on step 2+ when step 1 succeeded.

### Pitfall 3: `initSchema` Must Run Before Case Operations
**What goes wrong:** `CaseStore.create()` calls `INSERT INTO cases` — if the DuckDB `cases` table doesn't exist yet, this throws.
**Why it happens:** DuckDB schema is initialized lazily (not at install time). The pattern in cli.ts is to call `initSchema(conn)` before any case operation.
**How to avoid:** At the start of the runner, call `initSchema` once. Pattern from cli.ts lines 207-212:
```typescript
const conn = await getDb()
await initSchema(conn)
conn.closeSync()
// Now CaseStore.create / CaseStore.get are safe
```

### Pitfall 4: Auto-Viz Throws on Empty Evidence
**What goes wrong:** `generateVisualization({ caseId })` throws `"No Transaction Data"` if case evidence contains no recognizable transaction objects (viz/index.ts line 29-31).
**Why it happens:** trace-funds runs MCP queries — if the MCP returns no transaction data (e.g., empty wallet), there is nothing to visualize.
**How to avoid:** Wrap auto-viz in try/catch. Print `"No transaction data to visualize."` and continue — the evidence files are already stored.

### Pitfall 5: tsdown Does Not Copy .md Files
**What goes wrong:** Built-in `.md` playbook files in `src/playbooks/` are absent from `dist/playbooks/` after build.
**Why it happens:** tsdown bundles TypeScript but ignores non-TS assets by default.
**How to avoid:** Either (a) configure tsdown's `copy` option to include `*.md` files, or (b) embed playbook content as exported TypeScript string constants (`export const TRACE_FUNDS_PLAYBOOK = \`...\``). Option (b) is simpler and eliminates a runtime file-not-found failure mode.

### Pitfall 6: `--from N` Step Index Off-by-One
**What goes wrong:** Steps are 1-indexed in the CLI (`--from 2` means start from step 2), but arrays are 0-indexed internally.
**Why it happens:** Human-readable step numbers in progress output (`Step 1/3`) conflict with zero-based array indexing.
**How to avoid:** Convert once at the runner boundary: `const startIndex = (opts.from ?? 1) - 1`. Never pass raw `--from` values into array indexing.

---

## Code Examples

### Playbook Definition Schema (Zod)

```typescript
// Source: [ASSUMED] — consistent with existing schema.ts patterns
import * as z from 'zod'

export const ParamSpecSchema = z.object({
  name:     z.string(),
  type:     z.enum(['string', 'number', 'boolean']).default('string'),
  required: z.boolean().default(true),
  default:  z.string().optional(),
})

export const StepSchema = z.object({
  index:  z.number().int().positive(),
  label:  z.string(),
  tool:   z.string().min(1),
  params: z.record(z.string()),
})

export const PlaybookSchema = z.object({
  name:        z.string().min(1),
  description: z.string().default(''),
  version:     z.string().default('1.0.0'),
  params:      z.array(ParamSpecSchema).default([]),
  steps:       z.array(StepSchema),
})

export type PlaybookDefinition = z.infer<typeof PlaybookSchema>
export type StepDefinition = z.infer<typeof StepSchema>
```

### Quick Case ID Pattern

Quick cases use a different ID shape from the regex in `schema.ts`. Current regex: `^\d{8}_\d{3}_[a-z0-9][a-z0-9-]*$`. The auto-created name `quick_{timestamp}_{playbook-name}` must pass `generateCaseId()` in `store.ts` — which takes a `name` and produces the `YYYYMMDD_NNN_slug` format. So the runner should call:

```typescript
// Source: [VERIFIED: src/cases/store.ts CaseStore.create()]
// Pass human-readable name — CaseStore generates the ID from it
const quickCase = await CaseStore.create({
  name: `quick-${playbookName}-${Date.now()}`,
  tags: ['quick', 'playbook', playbookName],
  description: `Auto-created for one-off playbook run: ${playbookName}`,
})
```

The `quick_{timestamp}_{playbook-name}` value from CONTEXT.md is the *intent* (a short-lived case), not a literal ID format. The actual ID is generated by `generateCaseId()`.

### CLI Subcommand Pattern (from existing cli.ts)

```typescript
// Source: [VERIFIED: src/cli.ts — addCommand pattern used for case, mcp, config]
program
  .command('playbook')
  .description('Run investigation playbooks')
  .addCommand(
    new Command('run')
      .description('Execute a playbook by name')
      .argument('<name>', 'Playbook name (e.g. trace-funds)')
      .option('--case <id>', 'Case ID to attach evidence to (auto-created if omitted)')
      .option('--from <n>', 'Resume from step N', '1')
      .option('--dry-run', 'Show steps without executing')
      .option('-p, --param <kv...>', 'Parameters as key=value (repeatable)')
      .action(async (name: string, opts: {...}) => { ... })
  )
  .addCommand(
    new Command('list')
      .description('List available playbooks')
      .action(async () => { ... })
  )
  .addCommand(
    new Command('show')
      .description('Show steps for a playbook')
      .argument('<name>', 'Playbook name')
      .action(async (name: string) => { ... })
  )
```

---

## Environment Availability

Step 2.6: Skipped — this phase adds no external dependencies. All runtime dependencies (MCP SDK, x402, DuckDB, Vitest) were introduced in Phases 1-4.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.x |
| Config file | `vitest.config.ts` (root — projects: unit + integration) |
| Quick run command | `npx vitest run tests/playbooks.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLAY-01 | PlaybookParser extracts steps from markdown | unit | `npx vitest run tests/playbook-parser.test.ts` | No — Wave 0 |
| PLAY-01 | `{{param}}` template substitution | unit | `npx vitest run tests/playbook-parser.test.ts` | No — Wave 0 |
| PLAY-01 | Runner creates quick case when no `--case` given | unit (mocked MCP) | `npx vitest run tests/playbook-runner.test.ts` | No — Wave 0 |
| PLAY-01 | Runner stores evidence after each step | unit (mocked MCP) | `npx vitest run tests/playbook-runner.test.ts` | No — Wave 0 |
| PLAY-01 | `--dry-run` prints steps, makes no MCP calls | unit (mocked MCP) | `npx vitest run tests/playbook-runner.test.ts` | No — Wave 0 |
| PLAY-01 | `--from N` skips steps before N | unit (mocked MCP) | `npx vitest run tests/playbook-runner.test.ts` | No — Wave 0 |
| PLAY-01 | Name resolver: user dir before built-in | unit | `npx vitest run tests/playbook-resolver.test.ts` | No — Wave 0 |
| PLAY-02 | trace-funds built-in parses without error | unit | `npx vitest run tests/playbook-builtins.test.ts` | No — Wave 0 |
| PLAY-02 | risk-check built-in parses without error | unit | `npx vitest run tests/playbook-builtins.test.ts` | No — Wave 0 |
| PLAY-02 | entity-profile built-in parses without error | unit | `npx vitest run tests/playbook-builtins.test.ts` | No — Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/playbook-parser.test.ts tests/playbook-runner.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/playbook-parser.test.ts` — covers PLAY-01 parser + template substitution
- [ ] `tests/playbook-runner.test.ts` — covers PLAY-01 runner (mock MCP client)
- [ ] `tests/playbook-resolver.test.ts` — covers name resolution (user dir vs built-in)
- [ ] `tests/playbook-builtins.test.ts` — covers PLAY-02 (parse all three built-in files)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | Zod schemas for PlaybookSchema, StepSchema; sanitize `tool` name before callTool |
| V6 Cryptography | no | wallet key usage is unchanged (existing wallet module) |

### Known Threat Patterns for Playbook Engine

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal in playbook name (`../../etc/passwd`) | Tampering | Sanitize name before fs.access: `name.replace(/[^a-z0-9_-]/gi, '')` before constructing file path |
| Template injection via `{{param}}` with shell-special chars | Tampering | Parameters are passed as JSON to MCP tool arguments, never interpolated into shell commands — no shell injection risk. Sanitize for display only. |
| Playbook tool name injection (tool: `; rm -rf`) | Tampering | Validate tool name against known MCP schema (`loadSchema()` returns allowed tools); reject unknown tool names before calling callTool |
| Unbounded evidence growth from automated playbooks | Denial of Service | Inherits existing evidence store limits; no additional mitigation needed at this scope |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `{{param}}` substitution is applied at parse time (after CLI params resolved), not at step-execution time | Architecture Patterns - Pattern 3 | Low — alternative is apply at execution time; either works. Template injection risk is identical. |
| A2 | Embedding built-in playbooks as TypeScript string constants is simpler than tsdown asset copy | Pitfall 5, Pattern 8 | Low — if tsdown has native copy support, using files is cleaner. Recommend confirming in tsdown.config.ts before committing to approach. |
| A3 | The MCP remote endpoint supports all three playbook tool names (trace_funds, get_transaction_graph, check_risk_exposure, etc.) | Code Examples (built-in playbooks) | HIGH — if MCP tools have different names, built-in playbook step tool names will be wrong. Must verify actual MCP tool names via `chain-insights mcp tools` before writing playbook files. |
| A4 | readline interactive prompt is viable for x402 retry (not piped/non-interactive) | Pattern 7 | Medium — if stdout/stdin is piped (agent-driven), readline prompt hangs. Should detect `process.stdin.isTTY` and fall back to non-interactive abort when false. |

---

## Open Questions

1. **Actual MCP tool names for built-in playbooks**
   - What we know: trace-funds, risk-check, entity-profile playbooks need real MCP tool names
   - What's unclear: The MCP schema is not queryable without a live wallet + funded account. Tool names are unknown.
   - Recommendation: Planner should make tool names a discretionary placeholder (e.g., `trace_funds`, `check_risk`, `get_entity`) with a comment in the built-in playbook files noting they must match `chain-insights mcp tools` output. The runner validates tool names against schema before execution.

2. **params: array in frontmatter — flat string vs multi-line YAML**
   - What we know: `parseFrontmatter()` only handles flat `key: value`
   - What's unclear: Whether to extend `parseFrontmatter()` or use an encoded single-line format
   - Recommendation: Discretionary. Extending `parseFrontmatter()` with an array-parse path (lines starting with `  - `) is ~10 lines and keeps playbook files human-readable. Single-line encoding is simpler but less ergonomic for investigators who write custom playbooks.

---

## Sources

### Primary (HIGH confidence)
- `src/cli.ts` — MCP call pattern (lines 173-191), Commander subcommand pattern, case lifecycle pattern
- `src/cases/evidence.ts` — EvidenceStore.append() API, evidence file format
- `src/cases/store.ts` — CaseStore.create() API, generateCaseId(), initSchema() requirement
- `src/cases/frontmatter.ts` — parser limitations (flat-key only)
- `src/cases/schema.ts` — CaseID regex, CaseStatus enum
- `src/viz/index.ts` — generateVisualization() API, error throw on empty data
- `src/mcp/proxy.ts` — SSE fallback pattern, single-connection-for-multi-call pattern

### Secondary (MEDIUM confidence)
- `.planning/phases/05-playbooks/05-CONTEXT.md` — All locked decisions, playbook format spec

### Tertiary (LOW confidence — see Assumptions Log)
- A3: MCP tool names in built-in playbooks are assumed/placeholder until verified against live MCP

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all APIs verified from source
- Architecture: HIGH — parser/runner decomposition follows established codebase patterns
- Pitfalls: HIGH — derived from direct code reading (frontmatter.ts, store.ts, viz/index.ts)
- MCP tool names in built-ins: LOW — not verifiable without live funded wallet

**Research date:** 2026-05-11
**Valid until:** 2026-06-10 (stable codebase, 30-day window)
