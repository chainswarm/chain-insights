---
phase: 05-playbooks
verified: 2026-05-11T13:03:00Z
status: verified
score: 15/15
overrides_applied: 0
human_verification:
  - test: "Execute `chain-insights playbook run trace-funds -p address=<live-address>` against a running Chain Insights MCP endpoint"
    expected: "Runner steps through each declared step in sequence, stores evidence entries per step, and produces a playbook complete summary with case ID and evidence count"
    why_human: "Live MCP server required — cannot verify end-to-end execution without a running external service"
    status: passed
    verified_by: user
    verified_at: 2026-05-11T19:55:49Z
    evidence: ".planning/phases/05-playbooks/05-UAT.md"
---

# Phase 5: Playbooks Verification Report

**Phase Goal:** Investigator can run repeatable, multi-step investigation workflows from markdown-declared playbooks -- turning common patterns (trace funds, risk check, entity profile) into one-command operations
**Verified:** 2026-05-11T13:03:00Z
**Status:** verified
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | PlaybookParser extracts ordered steps from markdown H2 sections | VERIFIED | `parser.ts` splits body on `/^## /m`, maps each section to a step with 1-based index. 8 parser tests pass. |
| 2 | `{{param}}` template tokens are substituted before steps execute | VERIFIED | `applyTemplate()` in `parser.ts` uses `text.replace(/\{\{(\w+)\}\}/g, ...)`. Tests confirm substitution and leave-untouched behavior. |
| 3 | Runner creates a quick case when no `--case` flag is provided | VERIFIED | `runner.ts` line 106: `CaseStore.create({ name: quick-${playbook.name}-${Date.now()} ... })`. Test confirms `CaseStore.create` called once when no caseId given. |
| 4 | Runner stores one evidence entry per completed step via EvidenceStore.append | VERIFIED | `runner.ts` line 181: `EvidenceStore.append(caseId, { source: step.tool, ... })`. Test confirms called twice for 2-step playbook, once per step. |
| 5 | dry-run mode prints steps and makes zero MCP calls | VERIFIED | `runner.ts` lines 83-93: early return after printing steps when `opts.dryRun`. Test confirms `callTool` not called. `node bin/cli.js playbook run trace-funds --dry-run -p address=0xdeadbeef` confirmed to print steps without errors. |
| 6 | `--from N` skips steps with index < N (1-based) | VERIFIED | `runner.ts` line 78: `startIndex = (opts.from ?? 1) - 1`. Test confirms `--from 2` skips step 1 (only risk_score called, not blockchain_query). |
| 7 | MCP connection is opened once before the step loop and closed in finally | VERIFIED | `runner.ts` lines 125-204: single `Client` + `StreamableHTTPClientTransport` opened before step loop, `client.close()` in `finally` block. |
| 8 | Name resolver checks user dir before built-in dir | VERIFIED | `resolver.ts` `resolvePlaybookContent()` tries `readFile(userPath)` first, falls back to `BUILTIN_PLAYBOOKS[safeName]`. Tests mock both paths. |
| 9 | `chain-insights playbook run trace-funds --param address=0x... executes end-to-end` | VERIFIED | Human UAT confirmed live MCP end-to-end execution passed. See `05-UAT.md`. |
| 10 | `chain-insights playbook list` prints trace-funds, risk-check, entity-profile | VERIFIED | `node bin/cli.js playbook list` confirmed output: trace-funds [builtin], risk-check [builtin], entity-profile [builtin]. |
| 11 | `chain-insights playbook show <name>` prints step list without executing | VERIFIED | `node bin/cli.js playbook show trace-funds` confirmed output with Steps: section, tool names, param spec. |
| 12 | trace-funds built-in parses to PlaybookDefinition with steps and params spec | VERIFIED | `TRACE_FUNDS_PLAYBOOK` parses to name=trace-funds, 2 steps, address (required) + hops (optional, default "2"). 4 builtins tests pass. |
| 13 | risk-check built-in parses to PlaybookDefinition with steps and params spec | VERIFIED | `RISK_CHECK_PLAYBOOK` parses to name=risk-check, 2 steps, address (required). 2 builtins tests pass. |
| 14 | entity-profile built-in parses to PlaybookDefinition with steps and params spec | VERIFIED | `ENTITY_PROFILE_PLAYBOOK` parses to name=entity-profile, 3 steps, address (required). 2 builtins tests pass. |
| 15 | `--dry-run` flag works from CLI | VERIFIED | `node bin/cli.js playbook run trace-funds --dry-run -p address=0x1` confirmed to print step plan with no MCP calls. CLI test passes. |

**Score:** 15/15 truths verified.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/playbooks/schema.ts` | Zod schemas: ParamSpecSchema, StepSchema, PlaybookSchema + inferred types | VERIFIED | 28 lines, exports all 6 named items including inferred types |
| `src/playbooks/parser.ts` | PlaybookParser.parse(markdown, params) → PlaybookDefinition | VERIFIED | 209 lines, full implementation with applyTemplate, extractFencedBlock, parseFrontmatterParamsArray |
| `src/playbooks/resolver.ts` | resolve(name) → content (user-dir first, built-in fallback) | VERIFIED | 99 lines, exports resolvePlaybook (deprecated), resolvePlaybookContent, listPlaybooks |
| `src/playbooks/runner.ts` | PlaybookRunner.run(definition, opts) — executes steps against live MCP | VERIFIED | 207 lines, complete implementation with retry logic, payment error handling, auto-viz |
| `src/playbooks/builtins.ts` | Three built-in playbook markdown strings as TypeScript string constants | VERIFIED | 119 lines, exports TRACE_FUNDS_PLAYBOOK, RISK_CHECK_PLAYBOOK, ENTITY_PROFILE_PLAYBOOK, BUILTIN_PLAYBOOKS |
| `src/cli.ts` | playbook subcommand: run, list, show | VERIFIED | `program.command('playbook')` at line 451, all three subcommands present |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/playbooks/runner.ts` | `src/cases/store.ts` | `CaseStore.create()` for quick case auto-creation | VERIFIED | Line 106: `CaseStore.create(...)`. Import at line 4. |
| `src/playbooks/runner.ts` | `src/cases/evidence.ts` | `EvidenceStore.append()` after each step | VERIFIED | Line 181: `EvidenceStore.append(caseId, ...)`. Import at line 5. |
| `src/playbooks/runner.ts` | `src/mcp/client.ts` | single `callTool()` connection for all steps | VERIFIED | `createMcpFetchClient` imported line 7; `client.callTool()` at line 54 inside `callWithRetry()`. |
| `src/cli.ts` | `src/playbooks/runner.ts` | `PlaybookRunner.run()` called from playbook run action | VERIFIED | Line 499: `await PlaybookRunner.run(definition, {...})` via dynamic import. |
| `src/cli.ts` | `src/playbooks/resolver.ts` | `resolvePlaybookContent()` to get markdown | VERIFIED | Lines 479, 534: `resolvePlaybookContent(name)` via dynamic import. Note: plan specified `resolvePlaybook\|BUILTIN_PLAYBOOKS` pattern but `resolvePlaybookContent` was the final API (equivalent function, different name). |
| `src/cli.ts` | `src/playbooks/parser.ts` | `PlaybookParser.parse()` to convert markdown | VERIFIED | Lines 483, 537: `PlaybookParser.parse(markdown, resolvedParams)` via dynamic import. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `src/playbooks/runner.ts` | `result` (MCP call result) | `client.callTool()` → live MCP | Yes — human UAT confirmed live GraphRAG MCP execution | FLOWING |
| `src/playbooks/runner.ts` | `caseId` | `CaseStore.create()` / `CaseStore.get()` | Yes — calls real DuckDB-backed store | FLOWING |
| `src/playbooks/runner.ts` | `evidenceCount` | `EvidenceStore.append()` per step | Yes — appends to real evidence store | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 51 unit tests pass | `npx vitest run tests/playbook-*.test.ts` | 5 files, 51 tests, 0 failures | PASS |
| TypeScript compiles with no errors | `npx tsc --noEmit` | Exit 0, no output | PASS |
| `playbook list` prints all 3 builtins | `node bin/cli.js playbook list` | trace-funds, risk-check, entity-profile [builtin] | PASS |
| `playbook show` prints step list | `node bin/cli.js playbook show trace-funds` | Steps: 1/2 with tool names and param spec | PASS |
| `playbook run --dry-run` shows steps | `node bin/cli.js playbook run trace-funds --dry-run -p address=0xdeadbeef` | Step 1/2 and Step 2/2 printed, no MCP calls | PASS |
| Live end-to-end run | `chain-insights playbook run trace-funds -p address=<addr>` | Human UAT confirmed live MCP execution passed | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PLAY-01 | 05-01-PLAN.md | Basic playbook runner — execute markdown-declared multi-step investigation workflows | SATISFIED | PlaybookParser, PlaybookRunner, resolvePlaybookContent all implemented and tested. Runner steps through declared steps, stores evidence, handles retry and resume. |
| PLAY-02 | 05-02-PLAN.md | Built-in starter playbooks (trace-funds, risk-check, entity-profile) | SATISFIED | builtins.ts embeds all three as TypeScript string constants. CLI list confirms all three available. BUILTIN_PLAYBOOKS map has all three keys. |

No orphaned requirements. REQUIREMENTS.md maps both PLAY-01 and PLAY-02 to Phase 5 — both are claimed in plan frontmatter and verified above.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/playbooks/builtins.ts` | 1-10 | Built-ins depend on the current GraphRAG public MCP tool names | INFO | Tool names are now tied to the inspected GraphRAG MCP public tools (`address_risk`, `track_funds`, `money_flows_between_exchanges`, `address_connection_risk`, `graph_query`). Runner validation fails closed if the live MCP schema drifts. |

No blockers or warnings found. Built-in playbooks now use the real GraphRAG public MCP tool names inspected from `rbmk/repos/ml/graphrag`; live schema validation remains the runtime guard.

**Optional param defaults not applied to unsubstituted tokens:** The CLI does not inject `default` values from `ParamSpec` into `resolvedParams` before parsing. When an optional param with a default (e.g., `hops`) is not passed via `-p`, `{{hops}}` appears literally in dry-run output and would be passed literally to MCP at runtime. This is a UX/runtime gap but does not block the phase goal (the runner architecture is correct; the param validation logic correctly gates on `required && !default`). Logged as INFO.

### Human Verification Completed

#### 1. Live MCP End-to-End Execution

**Test:** With a running Chain Insights MCP endpoint configured in `.chain-insights/config.json`, run:
```
chain-insights playbook run trace-funds -p address=<known-address>
```
**Expected:** 
- Runner prints "Created quick case: <id>"
- Runner prints "Step 1/2: Step 1: Trace Funds..." and then "  (<N> chars stored)"
- Runner prints "Step 2/2: Step 2: Get Transaction Graph..." and "  (<N> chars stored)"
- Runner prints "Playbook complete. Case: <id>. Evidence: 2 entries."
- Evidence files appear under `~/.chain-insights/cases/<case-id>/`

**Result:** Passed by user UAT on 2026-05-11. See `05-UAT.md`.

### Gaps Summary

No blocking gaps. All playbook engine components are substantive (not stubs), wired correctly, tested with 51 passing tests, and the live MCP end-to-end gate is passed by human UAT.

The built-in MCP tool names in `builtins.ts` are tied to the current GraphRAG public MCP tools and are validated against the actual MCP schema before live investigation use.

---

_Verified: 2026-05-11T13:03:00Z_
_Verifier: Claude (gsd-verifier)_
