---
phase: 04-money-flow-visualization
plan: "01"
subsystem: viz
tags: [d3, visualization, hono, cli, money-flow, canvas]
dependency_graph:
  requires: []
  provides: [viz-pipeline, viz-server-route, viz-cli-command]
  affects: [src/server/app.ts, src/cli.ts, src/index.ts]
tech_stack:
  added: [open@11.x]
  removed: [d3@7.x, "@types/d3"]
  patterns: [graph-html-template, inline-d3-bundle, dual-path-viz-storage, hono-route, commander-subcommand, base64-asset-inlining]
key_files:
  created:
    - src/viz/graph-model.ts
    - src/viz/html-generator.ts
    - src/viz/index.ts
    - src/viz/templates/graph.html
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
  - Ported rbmk/graphrag graph.html canvas-based renderer instead of building custom SVG viz from scratch
  - D3 is inlined in the graph.html template (no separate d3 npm dependency needed)
  - bg-pattern.png inlined as base64 data URI for fully self-contained HTML
  - transformToGraphHtml() maps Zod GraphData schema to graph.html's address-based format
  - INLINE_DATA global variable injected before </body> — graph.html boot() checks for it before MCP/data_url fallbacks
metrics:
  completed_date: "2026-05-11"
  tasks_completed: 3
  files_created: 7
  files_modified: 5
  tests_added: 33
---

# Phase 4 Plan 01: Money Flow Visualization — Core Pipeline Summary

Canvas-based D3 money flow visualization ported from rbmk/graphrag, with Zod data model, Hono route, and CLI command.

## What Was Built

### Graph Data Model (src/viz/graph-model.ts)
Zod schemas: EntityType, RiskLevel, GraphNode, GraphEdge, GraphData with truncateGraph() capping at 100 nodes.

### Canvas Visualization (src/viz/templates/graph.html)
Ported from rbmk/graphrag — production-grade canvas renderer with:
- Force-directed and tree layouts with toggle
- Role-based node coloring (neon palette) and risk borders
- Edge aggregation mode (aggregated/individual)
- D3 v7 fully inlined (no CDN dependencies)
- bg-pattern.png inlined as base64 data URI
- Zoom/pan, node drag, hit-testing, tooltips
- INLINE_DATA support for chain-insights CLI mode

### HTML Generator (src/viz/html-generator.ts)
- `transformToGraphHtml()` maps our Zod schema to graph.html's address-based format (id→address, entityType→role, totalIn→flow_in_usd, source/target→from_address/to_address)
- `generateHtml()` injects INLINE_DATA JSON into the template before </body>
- `writeVizHtml()` dual-path storage: per-case or standalone

### Server Route (src/server/app.ts)
GET /viz/:id with findVizHtml() searching central and per-case directories. Path traversal protection via regex.

### CLI Command (src/cli.ts)
`chain-insights viz [case-id] --data <file> -p <port>` — generates viz, starts server, auto-opens browser.

## Test Results

All 126 project tests pass (33 viz-specific):
- viz-graph-model: 13 tests (schema validation, truncation)
- viz-html-generator: 15 tests (template output, data transform, file storage)
- viz-server: 5 tests (404/400/200 routes, per-case lookup)

## Deviations from Plan

1. **Replaced custom SVG renderer with rbmk graph.html canvas renderer** — user directed port of existing production visualization instead of building from scratch. Removed theme.ts and viz-logic.ts. Removed d3 npm dependency (inlined in template).
2. **bg-pattern.png inlined as base64** — user required the marketing background image to be included.

## Self-Check: PASSED
