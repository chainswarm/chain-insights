---
phase: 04-money-flow-visualization
verified: 2026-05-11T11:47:00Z
status: gaps_found
score: 2/3 must-haves verified
overrides_applied: 0
gaps:
  - truth: "User can run `chain-insights viz --data <file.json>` and a browser tab opens showing a D3 force-directed graph"
    status: failed
    reason: "Built CLI (node bin/cli.js) fails at runtime with ENOENT: dist/templates/graph.html not found. The build script (tsdown) has no copy step to place src/viz/templates/graph.html into dist/templates/. The package.json 'files' field lists 'dist' only — the template is excluded from distribution. dev-mode (npx tsx src/cli.ts) works but that is not the installed CLI."
    artifacts:
      - path: "dist/templates/graph.html"
        issue: "File does not exist — tsdown build produces no templates/ directory in dist/"
      - path: "tsdown.config.ts"
        issue: "No copy hook or asset inclusion for src/viz/templates/graph.html"
      - path: "package.json"
        issue: "scripts.build is 'tsdown' with no postbuild copy step; 'files' field does not include src/viz/templates/"
    missing:
      - "Add postbuild copy step to package.json: `\"postbuild\": \"cp -r src/viz/templates dist/templates\"`"
      - "Or configure tsdown to include the HTML file as a static asset"
      - "Verify dist/templates/graph.html exists after build before shipping"
human_verification:
  - test: "Visual rendering — nodes, edges, layout toggle, tooltips"
    expected: "Canvas renders force-directed graph with role-colored nodes, risk borders, edge thickness scaling by usd_amount, Force/Tree layout toggle, zoom/pan, node drag, node click shows info"
    why_human: "graph.html is a 544KB canvas renderer — behavioral correctness (node hit-testing, layout transitions, legend panel, interactive features) requires browser observation"
  - test: "Auto-open browser behavior"
    expected: "After running `chain-insights viz --data file.json`, browser opens automatically showing the visualization URL"
    why_human: "Cannot test browser launch and rendering programmatically in this environment"
---

# Phase 4: Money Flow Visualization Verification Report

**Phase Goal:** Investigator can generate interactive money flow graphs from on-chain data and view them in the browser -- making fund flows visually traceable
**Verified:** 2026-05-11T11:47:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | D3.js renders force-directed and tree layout money flow graphs from transaction data | ? UNCERTAIN | D3 is inlined in graph.html (confirmed: `d3.forceSimulation`, `d3.tree()`, `d3.zoom()`, `d3.drag()` all present). Canvas renderer uses role-based coloring and risk borders. Template is 544KB self-contained file. Cannot confirm rendering without browser. The template works in dev mode (`npx tsx src/cli.ts viz --data file.json` produces valid output). |
| 2  | Visualization is a self-contained HTML file served from the local Hono server (no external dependencies) | ✓ VERIFIED | `generateHtml()` injects `INLINE_DATA` into graph.html template. No `src="https://"` or `href="https://"` attributes in template (grep confirmed 0 matches). Hono `GET /viz/:id` route wired with `findVizHtml()` searching both central and per-case dirs. Tests confirm 200/404/400 behavior. `generateHtml` output is > 100KB with D3 inlined. |
| 3  | Generated visualization auto-opens in the user's default browser | ✗ FAILED (BLOCKER) | `src/cli.ts` calls `open(url)` after `startServer()` — wiring exists in source. BUT `node bin/cli.js viz --data file.json` fails immediately with `ENOENT: .../dist/templates/graph.html`. The `html-generator.ts` reads `graph.html` at module load time via `readFileSync`. tsdown does not copy `src/viz/templates/` to `dist/templates/`. The installed CLI is broken for viz generation. Confirmed via live test: `ENOENT: no such file or directory, open '/home/aphex5/work/chain-insights/dist/templates/graph.html'` |

**Score:** 1 definitively verified, 1 uncertain (needs human visual check), 1 FAILED (blocker)

### Deferred Items

None.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/viz/graph-model.ts` | Zod schemas: GraphData, GraphNode, GraphEdge, truncateGraph | ✓ VERIFIED | All schemas match plan spec exactly. truncateGraph caps at 100 nodes by (totalIn+totalOut). |
| `src/viz/html-generator.ts` | generateHtml, writeVizHtml, transformToGraphHtml | ✓ VERIFIED | All three functions present and substantive. transformToGraphHtml maps Zod schema to graph.html address-based format. writeVizHtml dual-path storage implemented. |
| `src/viz/templates/graph.html` | Canvas D3 renderer template | ✓ VERIFIED (source) / ✗ MISSING (dist) | Present at src/viz/templates/graph.html (544KB). Missing from dist/templates/ — not copied by build. |
| `src/viz/index.ts` | generateVisualization orchestrator | ✓ VERIFIED | Wired to extractGraphFromJson (dataFile path) and extractGraphFromCase (caseId path). Stub replaced. |
| `src/server/app.ts` | GET /viz/:id route with findVizHtml | ✓ VERIFIED | Route present with regex path-traversal protection. findVizHtml searches central and per-case dirs. |
| `src/viz/data-extractor.ts` | extractGraphFromCase, extractGraphFromJson, parseEvidenceJson | ✓ VERIFIED | All three functions implemented with dossier enrichment, node dedup, edge aggregation. |
| `tests/viz-graph-model.test.ts` | Schema validation tests | ✓ VERIFIED | 13 tests, all pass. |
| `tests/viz-html-generator.test.ts` | HTML generation tests | ✓ VERIFIED | 15 tests, all pass. |
| `tests/viz-server.test.ts` | Server route tests | ✓ VERIFIED | 5 tests, all pass. |
| `tests/viz-data-extractor.test.ts` | Data extractor tests (VIZ-01) | ✓ VERIFIED | 14 tests, all pass. VIZ-01 referenced in describe blocks. |
| `tests/viz-cli.test.ts` | CLI integration test (VIZ-03) | ✓ VERIFIED | 4 tests pass. Confirms viz command visible in --help, --data option present, error on missing args/file. |
| `src/viz/theme.ts` | CSS variables (plan-01 artifact) | ✗ MISSING (deviation) | Not created — replaced by graph.html's built-in CSS. Documented deviation in SUMMARY. |
| `src/viz/templates/viz-logic.ts` | Client-side D3 JS template (plan-01 artifact) | ✗ MISSING (deviation) | Not created — replaced by graph.html canvas renderer. Documented deviation in SUMMARY. |

**Note on deviations:** `theme.ts` and `viz-logic.ts` are plan-01 implementation artifacts, not ROADMAP success criteria. The executor ported rbmk's `graph.html` canvas renderer instead of building from scratch. The ROADMAP SCs do not require SVG rendering or specific CSS files — they require D3 graphs, self-contained HTML, and browser auto-open. The deviations are acceptable for SC-1 and SC-2. SC-3 is blocked by the missing dist copy step.

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/cli.ts` | `src/viz/index.ts` | `import('./viz/index.js')` in viz command action | ✓ WIRED | `generateVisualization` dynamically imported and called at line 463 |
| `src/viz/index.ts` | `src/viz/html-generator.ts` | `generateHtml(data, title)` call | ✓ WIRED | Called at line 47 |
| `src/viz/html-generator.ts` | `src/viz/templates/graph.html` | `readFileSync(templatePath)` at module load | ✓ WIRED (source) / ✗ BROKEN (dist) | Path resolves to `__dirname/templates/graph.html`. Works in dev mode. Fails in built CLI since dist/templates/ is absent. |
| `src/server/app.ts` | `~/.chain-insights/viz/` and `~/.chain-insights/cases/<id>/viz/` | `findVizHtml()` | ✓ WIRED | findVizHtml searches both paths. Tests verify 200 from both locations. |
| `src/cli.ts` | `open` (npm package) | `(await import('open')).default` | ✓ WIRED | `open` in dependencies at ^11.0.0. Called with viz URL after startServer. |
| `src/viz/index.ts` | `src/viz/data-extractor.ts` | `extractGraphFromCase` / `extractGraphFromJson` | ✓ WIRED | Both branches call extractor functions. Stub removed. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `src/viz/html-generator.ts::generateHtml` | `graphHtmlData` | `transformToGraphHtml(data)` maps GraphData → GraphHtmlData | Yes — data flows from Zod-validated GraphData through field mapping | ✓ FLOWING |
| `src/viz/templates/graph.html` | `INLINE_DATA` | Injected by `generateHtml()` via `template.replace('</body>', inlineScript)` | Yes — `INLINE_DATA` consumed by `boot()` → `loadGraph(INLINE_DATA)` at line 1345-1347 | ✓ FLOWING |
| `src/viz/data-extractor.ts::extractGraphFromCase` | `allNodes`, `allEdges` | Reads `~/.chain-insights/cases/<id>/evidence/*.md`, parses JSON blocks | Yes — real file reads with dossier enrichment from DossierStore.listSummaries | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| CLI viz --help shows command | `node bin/cli.js --help` | Contains 'viz' and 'Generate money flow visualization' | ✓ PASS |
| CLI viz --help shows --data | `node bin/cli.js viz --help` | Contains '--data' and 'Raw transaction JSON file' | ✓ PASS |
| CLI viz without args exits non-zero | `node bin/cli.js viz` (captured) | Exit code 1 | ✓ PASS |
| CLI viz --data generates via dist | `node bin/cli.js viz --data /tmp/test.json` | `ENOENT: .../dist/templates/graph.html` | ✗ FAIL |
| CLI viz generates via tsx (dev) | `npx tsx src/cli.ts viz --data /tmp/test.json` | Server starts, URL printed, adhoc_* written to ~/.chain-insights/viz/ | ✓ PASS |
| Full unit test suite | `npx vitest run --project unit` | 20 files, 144 tests passed | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| VIZ-01 | 04-01, 04-02 | D3.js money flow graphs with force-directed and tree layouts, reusing existing rbmk viz code | ✓ SATISFIED | graph.html contains d3.forceSimulation, d3.tree(), force/tree layout toggle buttons, canvas rendering with role colors and risk borders. rbmk viz ported as directed. Data model (GraphData Zod schema) fully implemented. extractGraphFromCase wired for case-based data. |
| VIZ-02 | 04-01, 04-02 | Self-contained HTML output served from local Hono server | ✓ SATISFIED | generateHtml injects D3 + data inline (no CDN). Hono GET /viz/:id serves from disk. No external src/href in template. Tests verify. |
| VIZ-03 | 04-01, 04-02 | Auto-open visualization in user's default browser when generated | ✗ BLOCKED | `open` package wired in CLI. BUT `node bin/cli.js viz` fails before reaching `open()` due to missing dist/templates/graph.html. The auto-open never executes in the installed CLI. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `tsdown.config.ts` | whole file | No asset copy step for `src/viz/templates/graph.html` | BLOCKER | Built CLI (node bin/cli.js) fails immediately with ENOENT when attempting any visualization |
| `package.json` | scripts | `"build": "tsdown"` with no postbuild step | BLOCKER | Distribution (npm package) missing the template file that powers all viz generation |

### Human Verification Required

#### 1. Visual rendering of graph in browser

**Test:** Fix the BLOCKER (add postbuild copy step). Then run: `chain-insights viz --data /tmp/test-flow.json` with the 5-node test data from the plan's Task 3 checkpoint.
**Expected:** Browser opens showing dark-background canvas with 5 nodes colored by role, risk borders visible (red for critical/Tornado Cash, orange for high, yellow for medium, green for low, gray for unknown), edge thickness varies by usd_amount. Force/Tree toggle buttons in top-left. Zoom/pan with mouse. Node drag. Node click shows info popup.
**Why human:** Canvas rendering, hit-testing correctness, visual color accuracy, and interactive features cannot be verified programmatically.

#### 2. Auto-open browser

**Test:** After fixing BLOCKER, run `chain-insights viz --data /tmp/test-flow.json`.
**Expected:** Browser tab opens automatically to `http://127.0.0.1:4321/viz/adhoc_<timestamp>`.
**Why human:** Cannot test browser launch in this environment.

### Gaps Summary

**One blocker prevents the phase goal:**

The `src/viz/templates/graph.html` template (544KB canvas renderer) is NOT copied to `dist/templates/` during the build. The `html-generator.ts` reads it at module load time via `readFileSync(__dirname + '/templates/graph.html')`. When the built CLI runs from `dist/`, this path resolves to `dist/templates/graph.html` which does not exist.

**Root cause:** `tsdown.config.ts` has no asset inclusion for the HTML template. `package.json` has no `postbuild` copy step.

**Fix:** Add to `package.json`:
```json
"postbuild": "cp -r src/viz/templates dist/templates"
```
Or configure tsdown to include the asset. Then rebuild and verify `dist/templates/graph.html` exists.

**Impact:** Every viz operation through the installed CLI (`node bin/cli.js viz`) fails before generating any HTML or calling `open()`. The phase goal "investigator can generate interactive money flow graphs and view them in the browser" is not achievable through the distribution path.

**Dev-mode works:** `npx tsx src/cli.ts viz --data file.json` succeeds and produces output, confirming all logic is correct — only the build/distribution packaging step is missing.

---

_Verified: 2026-05-11T11:47:00Z_
_Verifier: Claude (gsd-verifier)_
