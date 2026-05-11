# Phase 4: Money Flow Visualization - Context

**Gathered:** 2026-05-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Investigator can generate interactive money flow graphs from on-chain data and view them in the browser -- making fund flows visually traceable. This phase delivers the D3.js rendering engine, HTML generation, Hono server routes, and CLI command to produce and view visualizations. No new MCP integration -- works with existing case evidence data and accepts raw JSON input for standalone use.

</domain>

<decisions>
## Implementation Decisions

### Graph Layout & Interaction
- Toggle button in the rendered HTML allows switching between force-directed and tree layouts (re-renders D3 in-place)
- Pan, zoom (D3 zoom behavior), and node hover tooltips showing entity details and transaction amounts
- Large transaction sets (>100 nodes) truncated to top N by value with "X more hidden" indicator for performance
- Force-directed layout nodes are draggable -- investigators can rearrange to highlight fund paths

### Visual Design & Data Encoding
- Entity types encoded with distinct shapes + colors: circles for EOAs, diamonds for contracts, hexagons for exchanges, triangles for mixers. Color palette aligned with Chain Insights brand theme
- Edge thickness proportional to transaction value + human-readable amount labels on hover
- Risk levels use green-yellow-orange-red gradient as node border color (low/medium/high/critical)
- Collapsible legend panel shows shape/color mappings, hidden by default with toggle in corner
- All visual styling must use a consistent Chain Insights theme/CSS (dark background, brand colors established in this phase)

### CLI Integration & Server Routing
- CLI command: `chain-insights viz <case-id>` generates visualization from case evidence, serves HTML, opens browser
- Generated HTML stored at `~/.chain-insights/cases/<case-id>/viz/` alongside case data
- Hono server route: `GET /viz/:id` serves each visualization as self-contained HTML with unique ID
- Standalone mode: `chain-insights viz --data <file.json>` accepts raw transaction JSON for ad-hoc graphs without a case

### Claude's Discretion
- D3 force simulation parameters (charge, link distance, collision radius)
- HTML template structure and inline CSS organization
- Tooltip positioning and formatting details
- Node size scaling algorithm
- Animation/transition timing for layout switches

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/server/app.ts` — Hono app factory with health/status routes, extends with new `/viz/:id` route
- `src/server/index.ts` — Server start/stop with localhost binding on port 4321
- `src/cases/store.ts` — CaseStore for loading case data and evidence
- `src/cases/evidence.ts` — EvidenceStore for reading evidence files
- `src/cases/dossier.ts` — DossierStore for entity dossier data
- `src/cli.ts` — Commander-based CLI, add `viz` subcommand here

### Established Patterns
- Dynamic imports for lazy loading (`await import('./server/index.js')`)
- Commander subcommand pattern with `.addCommand(new Command(...))`
- Error handling: try/catch with `console.error` + `process.exit(1)`
- Config via `loadConfig()` from `src/config/index.ts`
- Case data stored in `~/.chain-insights/cases/<case-id>/`

### Integration Points
- `src/cli.ts` — new `viz` command registration
- `src/server/app.ts` — new `/viz/:id` route
- `~/.chain-insights/cases/<case-id>/viz/` — new viz output directory
- `package.json` — new deps: d3, jsdom, open

</code_context>

<specifics>
## Specific Ideas

- Use Chain Insights brand theme and CSS throughout the visualization (dark background, consistent brand colors)
- No rbmk viz reference code available in repo -- build fresh using D3.js v7 patterns
- Self-contained HTML means all CSS, JS, and D3 bundled inline (no external CDN dependencies)

</specifics>

<deferred>
## Deferred Ideas

- Real-time graph updates via WebSocket (future: live monitoring visualizations)
- Graph export to PNG/PDF for compliance reports
- Multi-case overlay (compare fund flows across investigations)
- Time-based animation showing fund flow chronologically

</deferred>
