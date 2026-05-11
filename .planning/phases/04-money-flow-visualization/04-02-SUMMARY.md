---
phase: "04-money-flow-visualization"
plan: "02"
subsystem: "viz"
tags: ["data-extraction", "evidence-parsing", "cli-testing", "TDD", "VIZ-01", "VIZ-03"]
dependency_graph:
  requires: ["04-01"]
  provides: ["extractGraphFromCase", "extractGraphFromJson", "parseEvidenceJson", "viz-cli-tests"]
  affects: ["src/viz/index.ts", "src/viz/data-extractor.ts"]
tech_stack:
  added: []
  patterns:
    - "parseEvidenceJson: regex extraction of JSON code blocks from markdown"
    - "extractGraphFromJson: dual-format parser (GraphData object or simple [{from,to,value}] array)"
    - "extractGraphFromCase: evidence directory traversal + dossier enrichment"
    - "Node dedup by id, edge aggregation by source-target pair"
    - "Dossier entity type enrichment via DossierStore.listSummaries"
key_files:
  created:
    - src/viz/data-extractor.ts
    - tests/viz-data-extractor.test.ts
    - tests/viz-cli.test.ts
  modified:
    - src/viz/index.ts
decisions:
  - "parseEvidenceJson returns empty array (not error) for malformed JSON blocks — graceful degradation per T-04-06"
  - "extractGraphFromCase returns empty graph for missing evidence directory (not an error)"
  - "Edge aggregation uses sum of values for duplicate source-target pairs, keeping last txHash"
  - "Node merging preserves earliest firstSeen and latest lastSeen across files"
metrics:
  duration: "213 seconds"
  completed: "2026-05-11"
  tasks_completed: 2
  files_created: 3
  files_modified: 1
requirements:
  - VIZ-01
  - VIZ-03
---

# Phase 04 Plan 02: Data Extractor and CLI Integration Tests Summary

Case-based evidence extraction wired into viz pipeline: `extractGraphFromCase` reads markdown evidence files, parses embedded JSON transaction blocks, enriches nodes with entity types from dossiers, and merges multiple files into a single deduped GraphData.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing tests for data extractor (VIZ-01) | 0d8198f | tests/viz-data-extractor.test.ts |
| 1 (GREEN) | Data extractor + viz/index.ts wiring | 57dc03d | src/viz/data-extractor.ts, src/viz/index.ts |
| 2 | CLI integration test for viz command (VIZ-03) | 7121674 | tests/viz-cli.test.ts |

## What Was Built

### `src/viz/data-extractor.ts`

Three exported functions:

**`parseEvidenceJson(markdown)`** — Finds all ` ```json ``` ` code blocks in a markdown string using regex, parses each, and returns an array of items. Arrays are spread; GraphData objects are pushed as-is. Malformed JSON silently skipped (T-04-06 compliance).

**`extractGraphFromJson(input)`** — Accepts two formats:
1. Full GraphData object (has `nodes` + `edges`) — validated through Zod
2. `[{from, to, value, ...}]` array — auto-derives nodes from unique addresses, computes totalIn/totalOut/txCount per node, maps to GraphEdge format

Throws `"Invalid transaction data"` for anything else.

**`extractGraphFromCase(caseId)`** — Full pipeline:
1. Reads `~/.chain-insights/cases/<caseId>/evidence/*.md` files
2. Parses frontmatter, extracts JSON blocks from body via `parseEvidenceJson`
3. Merges multiple files: deduplicates nodes by id (summing totals), aggregates edges for same source-target pair
4. Enriches nodes with entity types from dossiers via `DossierStore.listSummaries`
5. Returns empty graph (not error) if evidence directory missing

### `src/viz/index.ts` (modified)

Replaced the `throw new Error('Case not found...')` stub in the `caseId` branch with a proper call to `extractGraphFromCase`. Also updated `dataFile` branch to use `extractGraphFromJson` instead of raw `GraphData.parse`. Added barrel exports for `DataExtractor`, `extractGraphFromCase`, `extractGraphFromJson`.

### `tests/viz-data-extractor.test.ts`

14 tests covering:
- `parseEvidenceJson`: no blocks, array extraction, non-json block ignored
- `extractGraphFromJson`: full GraphData, simple array, txHash mapping, invalid input throws
- `extractGraphFromCase`: missing evidence dir, no JSON blocks, transaction parsing, dossier enrichment, multi-file merge, metadata caseId

### `tests/viz-cli.test.ts`

4 integration tests using `execSync` against the built `bin/cli.js`:
- `--help` includes `viz` and `Generate money flow visualization`
- `viz --help` shows `--data` and `Raw transaction JSON file`
- `viz` without arguments exits non-zero
- `viz --data /tmp/nonexistent.json` exits non-zero

## Test Results

```
Test Files  20 passed (20)
     Tests  144 passed (144)
```

Full unit suite green, no regressions.

## Deviations from Plan

None — plan executed exactly as written.

The build step (`npm run build`) was required before running `tests/viz-cli.test.ts` as expected. The dist did not exist in the worktree, so it was built fresh as part of Task 2 execution.

## TDD Gate Compliance

- RED gate commit: `0d8198f` — `test(04-02): add failing tests for data extractor (VIZ-01)`
- GREEN gate commit: `57dc03d` — `feat(04-02): implement data extractor for case evidence and JSON input`
- All RED tests confirmed failing before GREEN implementation was written

## Known Stubs

None — all functions are fully implemented and wired.

## Threat Flags

No new network endpoints or trust boundaries introduced. The data extractor reads local files from the user's own `.chain-insights` directory — same trust domain as the existing evidence and dossier modules.

## Self-Check: PASSED

Files verified:
- `src/viz/data-extractor.ts` — EXISTS
- `tests/viz-data-extractor.test.ts` — EXISTS
- `tests/viz-cli.test.ts` — EXISTS
- `src/viz/index.ts` (modified) — EXISTS

Commits verified:
- `0d8198f` — test(04-02): add failing tests for data extractor (VIZ-01)
- `57dc03d` — feat(04-02): implement data extractor for case evidence and JSON input
- `7121674` — feat(04-02): add CLI integration test for viz command (VIZ-03)
