---
phase: 04-money-flow-visualization
plan: "01"
subsystem: viz
tags: [d3, visualization, hono, cli, money-flow]
dependency_graph:
  requires: []
  provides: [viz-pipeline, viz-server-route, viz-cli-command]
  affects: [src/server/app.ts, src/cli.ts, src/index.ts]
tech_stack:
  added: [d3@7.x, open@11.x, "@types/d3"]
  patterns: [inline-d3-bundle, dual-path-viz-storage, hono-route, commander-subcommand]
key_files:
  created:
    - src/viz/graph-model.ts
    - src/viz/theme.ts
    - src/viz/templates/viz-logic.ts
    - src/viz/html-generator.ts
    - src/viz/index.ts
    - tests/viz-graph-model.test.ts
    - tests/viz-html-generator.test.ts
    - tests/viz-server.test.ts
  modified:
    - src/server/app.ts
    - src/cli.ts
    - src/index.ts
    - package.json
    - package-lock.json
decisions:
  - d3 bundle resolved via direct path to node_modules/d3/dist/d3.min.js (d3 exports map blocks require.resolve)
  - CDN reference test updated to check for external script/link src attributes (d3 bundle comment contains https:// URL)
metrics:
  duration: "5m 54s"
  completed_date: "2026-05-11"
  tasks_completed: 2
  tasks_pending_checkpoint: 1
  files_created: 8
  files_modified: 5
  tests_added: 31
---

# Phase 4 Plan 01: Money Flow Visualization — Core Pipeline Summary

Self-contained D3.js force-directed money flow visualization pipeline from JSON input to browser-rendered HTML via Hono server and CLI command.

## What Was Built

### Task 1: Graph data model, theme, HTML generator (TDD)

**src/viz/graph-model.ts** — Zod schemas for the full visualization data model:
- `EntityType` enum (eoa, contract, exchange, mixer, unknown)
- `RiskLevel` enum (low, medium, high, critical, unknown)
- `GraphNode` with defaults for entityType/riskLevel/totalIn/totalOut/txCount
- `GraphEdge` with required source/target/value, optional txHash/blockNumber/timestamp
- `GraphData` with nodes/edges/metadata including truncation fields
- `truncateGraph()` — keeps top 100 nodes by totalIn+totalOut volume, sets metadata.truncated=true

**src/viz/theme.ts** — UI-SPEC CSS constants:
- `buildCssVariables()` — full `:root {}` block with surface, text, entity, risk, edge tokens from UI-SPEC
- `buildLayoutCss()` — layout CSS for body, viz-root, graph SVG, control-bar, legend-panel, tooltip, truncation-banner
- `ENTITY_COLORS` and `RISK_COLORS` typed Record exports

**src/viz/templates/viz-logic.ts** — Client-side D3 JavaScript as template literal:
- `d3.forceSimulation()` with charge (-300), link distance (120), center, collision, alphaDecay, velocityDecay
- Entity shapes: circle (EOA), diamond path (contract), hexagon path (exchange), triangle path (mixer)
- Node size scaling: `clamp(16, 20 + log2(volume / medianVolume) * 4, 36)`
- Edge width scaling: 1px to 6px linear by value
- 3px risk-level stroke borders on nodes
- `d3.zoom()` with scaleExtent [0.1, 8], auto-fit on load (fitToView), zoom reset button
- `d3.drag()` for node dragging with alphaTarget animation
- `d3.tree()` + `d3.hierarchy()` for tree layout with cycle detection via DFS
- Layout toggle (Force/Tree) with 500ms animated transitions
- Node/edge tooltips with 200ms show delay, 150ms fade-out, viewport flip positioning
- Collapsible legend panel (bottom-right, collapsed by default)
- Truncation banner when metadata.truncated is true
- Empty state rendering when nodes.length === 0

**src/viz/html-generator.ts** — HTML generation and file I/O:
- `generateHtml(data, title)` — produces self-contained HTML with D3 inlined, CSS variables, graph JSON literal
- D3 bundle resolved via `path.resolve(__dirname, '../../node_modules/d3/dist/d3.min.js')` (bypasses exports map restriction)
- `writeVizHtml(vizId, html, caseId?)` — dual-path storage:
  - With caseId: `~/.chain-insights/cases/<caseId>/viz/<vizId>.html` (CONTEXT.md locked decision)
  - Without caseId: `~/.chain-insights/viz/<vizId>.html` (standalone)
- `escapeHtml()` for XSS-safe title injection

**src/viz/index.ts** — Barrel exports + orchestrator:
- `generateVisualization({ caseId?, dataFile? })` — full pipeline: read JSON → parse Zod → truncate → generate HTML → write to disk → return { vizId, htmlPath }
- vizId format: `adhoc_<timestamp>` for standalone, `<caseId>_<timestamp>` for case-based

**src/index.ts** — Added `generateVisualization` and type exports

### Task 2: Hono viz route, CLI viz command, server tests

**src/server/app.ts** — Added `GET /viz/:id` route:
- `findVizHtml(vizId)` helper searches: (1) central `~/.chain-insights/viz/`, (2) per-case dir using caseId prefix extracted from vizId, (3) fallback scan of all case dirs
- Path traversal protection: regex `/^[a-zA-Z0-9_-]+$/` rejects dots, slashes, backslashes
- Returns `c.html(html)` on success, `404` if not found, `400` for invalid IDs

**src/cli.ts** — Added `viz` subcommand:
- `chain-insights viz [case-id] [--data <file>] [-p <port>]`
- Calls `generateVisualization()`, starts server, auto-opens browser via `open` package

## Test Results

All 31 tests pass:
- `tests/viz-graph-model.test.ts` — 13 tests: Zod schema validation, defaults, edge cases, truncateGraph
- `tests/viz-html-generator.test.ts` — 13 tests: HTML structure, D3 inline, CSS variables, no CDN refs, dual-path file storage, generateVisualization integration
- `tests/viz-server.test.ts` — 5 tests: 404 for missing, 400 for invalid ID, 200 from central dir, 200 from per-case dir, /health unaffected

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] d3 package exports field blocks require.resolve('./dist/d3.min.js')**
- **Found during:** Task 1 GREEN phase
- **Issue:** `require.resolve('d3/dist/d3.min.js')` fails because d3's package.json `exports` field doesn't expose the `dist/` subpath
- **Fix:** Compute the path directly: `path.resolve(__dirname, '../../node_modules/d3/dist/d3.min.js')` using `fileURLToPath(import.meta.url)`
- **Files modified:** `src/viz/html-generator.ts`
- **Commit:** b40dbc9

**2. [Rule 1 - Bug] Test for "no CDN references" incorrectly scanned full HTML including inlined D3 bundle**
- **Found during:** Task 1 GREEN phase
- **Issue:** The d3 bundle's header comment contains `// https://d3js.org v7.9.0 Copyright...`, causing the "no https://" test to fail falsely
- **Fix:** Updated test to check for external `<script src="https://...">` or `<link href="https://...">` attributes only, not raw text content
- **Files modified:** `tests/viz-html-generator.test.ts`
- **Commit:** b40dbc9

## Known Stubs

**src/viz/index.ts line ~25**: `generateVisualization({ caseId })` throws `'Case not found. Run \`chain-insights case list\`...'`
- This is an intentional stub for Plan 02 which implements case-based evidence extraction into GraphData format. The stub is correct per plan design ("Case-based extraction -- implemented in Plan 02"). The standalone `--data <file>` path is fully implemented.

## Threat Surface Scan

No new threat surface introduced beyond what is declared in the plan's threat model:
- T-04-01 (Tampering via viz ID): mitigated with regex `/^[a-zA-Z0-9_-]+$/` in `src/server/app.ts`
- T-04-02 (HTML injection via graph data): mitigated with `JSON.stringify()` for data and `escapeHtml()` for title
- T-04-05 (DoS via large graph): mitigated with `truncateGraph()` capping at 100 nodes

## Checkpoint Status

**Tasks 1-2 are complete and committed.** Task 3 is a `checkpoint:human-verify` gate requiring visual confirmation that the D3 visualization renders correctly in the browser. All automation is complete.

## Self-Check

### Created files exist:
- src/viz/graph-model.ts: FOUND
- src/viz/theme.ts: FOUND
- src/viz/templates/viz-logic.ts: FOUND
- src/viz/html-generator.ts: FOUND
- src/viz/index.ts: FOUND
- tests/viz-graph-model.test.ts: FOUND
- tests/viz-html-generator.test.ts: FOUND
- tests/viz-server.test.ts: FOUND

### Commits exist:
- e69cb56: test(04-01): add failing tests for graph data model and HTML generator
- b40dbc9: feat(04-01): implement graph data model, theme, HTML generator, and viz pipeline
- 3578b41: feat(04-01): add Hono GET /viz/:id route, CLI viz command, and server integration tests

## Self-Check: PASSED
