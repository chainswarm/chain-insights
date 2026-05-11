# Phase 4: Money Flow Visualization - Research

**Researched:** 2026-05-11
**Domain:** D3.js client-side graph visualization, HTML template generation, Hono route serving, CLI integration
**Confidence:** HIGH

## Summary

Phase 4 delivers an interactive money flow visualization system. The architecture is client-side rendering: Node.js generates a self-contained HTML file with D3.js v7 minified (~240KB UMD) inlined as a `<script>` tag, transaction graph data embedded as a JSON literal, and all visualization logic as inline JavaScript. The Hono server serves these HTML files via `GET /viz/:id`, and the `open` package launches the user's default browser.

The key architectural insight is that D3 interactivity (drag, zoom, pan, layout toggle) requires browser-side execution -- server-side rendering via jsdom would produce static SVG without interaction. The CLAUDE.md technology stack lists jsdom as a dependency for "server-side DOM", but the locked decisions and UI-SPEC both specify self-contained HTML with inline client-side D3 scripts. jsdom is NOT needed for this phase. The D3 UMD bundle at `node_modules/d3/dist/d3.min.js` is read at HTML generation time and embedded inline.

**Primary recommendation:** Build an HTML template generator module (`src/viz/`) that accepts a typed graph data model, embeds D3.min.js + data + visualization logic into a single HTML file, and wire it to both CLI (`chain-insights viz`) and Hono route (`GET /viz/:id`).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Toggle button in rendered HTML switches between force-directed and tree layouts (re-renders D3 in-place)
- Pan, zoom (D3 zoom behavior), and node hover tooltips with entity details and transaction amounts
- Large transaction sets (>100 nodes) truncated to top N by value with "X more hidden" indicator
- Force-directed layout nodes are draggable -- investigators can rearrange to highlight fund paths
- Entity types encoded with distinct shapes + colors: circles for EOAs, diamonds for contracts, hexagons for exchanges, triangles for mixers
- Edge thickness proportional to transaction value + human-readable amount labels on hover
- Risk levels use green-yellow-orange-red gradient as node border color
- Collapsible legend panel with shape/color mappings
- CLI command: `chain-insights viz <case-id>` generates visualization, serves HTML, opens browser
- Generated HTML stored at `~/.chain-insights/cases/<case-id>/viz/`
- Hono server route: `GET /viz/:id` serves each visualization as self-contained HTML with unique ID
- Standalone mode: `chain-insights viz --data <file.json>` accepts raw transaction JSON
- All visual styling uses consistent Chain Insights theme/CSS (dark background, brand colors)

### Claude's Discretion
- D3 force simulation parameters (charge, link distance, collision radius)
- HTML template structure and inline CSS organization
- Tooltip positioning and formatting details
- Node size scaling algorithm
- Animation/transition timing for layout switches

### Deferred Ideas (OUT OF SCOPE)
- Real-time graph updates via WebSocket
- Graph export to PNG/PDF
- Multi-case overlay
- Time-based animation showing fund flow chronologically
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VIZ-01 | D3.js money flow graphs with force-directed and tree layouts | D3 v7.9.0 `d3-force` for force-directed, `d3-hierarchy` + `d3.tree()` for tree layout; layout toggle via re-rendering in-place; all code examples and API patterns documented below |
| VIZ-02 | Self-contained HTML output served from local Hono server | HTML template generator embeds D3 UMD min (~240KB), graph data as JSON literal, and viz logic inline; Hono `c.html()` serves it via `GET /viz/:id` route |
| VIZ-03 | Auto-open visualization in user's default browser when generated | `open` v11.0.0 package: `await open('http://127.0.0.1:4321/viz/<id>')` after HTML generation and server start |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Graph rendering (force/tree) | Browser / Client | -- | D3.js interactivity (drag, zoom, pan) requires live DOM and event listeners; cannot be pre-rendered server-side |
| HTML template generation | API / Backend (Node.js) | -- | Reads D3 bundle from disk, serializes graph data to JSON, assembles HTML string -- pure string templating |
| Graph data extraction from case | API / Backend (Node.js) | -- | CaseStore + EvidenceStore read case files and parse evidence into graph model |
| Serving visualization HTML | API / Backend (Node.js) | -- | Hono route reads stored HTML from `~/.chain-insights/cases/<id>/viz/` and returns via `c.html()` |
| File storage of generated HTML | Database / Storage | -- | Flat files at `~/.chain-insights/cases/<case-id>/viz/<viz-id>.html` |
| Browser launch | API / Backend (Node.js) | -- | `open` package invokes OS-level browser opener from Node.js process |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| d3 | 7.9.0 | Graph visualization (full bundle, UMD min for inline embedding) | Industry standard for data visualization; locked decision in CLAUDE.md [VERIFIED: npm registry] |
| hono | 4.12.x | HTTP server for serving viz HTML | Already installed, locked project decision [VERIFIED: package.json] |
| @hono/node-server | 2.0.x | Node.js adapter for Hono | Already installed [VERIFIED: package.json] |
| open | 11.0.0 | Cross-platform browser launcher | ESM-only, zero dependencies, opens URLs/files in default browser [VERIFIED: npm registry] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | 4.4.x | Validate input graph data schema | Already installed; validate transaction JSON input from `--data` flag and case evidence extraction [VERIFIED: package.json] |
| commander | 14.0.x | CLI framework | Already installed; register `viz` subcommand [VERIFIED: package.json] |

### NOT Needed (Clarification)
| Library | Listed In | Why Not Needed |
|---------|-----------|---------------|
| jsdom | CLAUDE.md tech stack | UI-SPEC specifies client-side D3 rendering (inline scripts execute in browser). jsdom would produce static SVG without interactivity. The HTML template generator is pure string concatenation -- no DOM needed server-side. |

**Installation:**
```bash
npm install d3 open
npm install --save-dev @types/d3
```

**Version verification:**
- d3: 7.9.0 (current stable) [VERIFIED: npm registry 2026-05-11]
- open: 11.0.0 (current stable) [VERIFIED: npm registry 2026-05-11]
- @types/d3: check latest at install time [ASSUMED]

## Architecture Patterns

### System Architecture Diagram

```
CLI Input                          Browser Output
  |                                     ^
  v                                     |
[chain-insights viz <case-id>]    [User's default browser]
  |                                     ^
  v                                     |
[Graph Data Extractor]             [open('http://127.0.0.1:4321/viz/<id>')]
  |  reads case evidence                ^
  |  + dossier entity types             |
  v                                     |
[Transaction Graph Model]          [Hono Server]
  |  typed nodes + edges                ^
  v                                     |
[HTML Template Generator]  ------> [~/.chain-insights/cases/<id>/viz/<viz-id>.html]
  |  reads d3.min.js from               |
  |  node_modules/d3/dist/         [GET /viz/:id route reads file, returns c.html()]
  |  embeds data as JSON literal
  |  embeds viz logic as inline JS
  v
[Self-Contained HTML File]
  - <style>: CSS variables + theme
  - <script>: D3 v7 UMD minified (~240KB)
  - <script>: Graph data as JSON literal
  - <script>: Viz logic (force sim, tree layout, zoom, drag, tooltips)
```

### Recommended Project Structure
```
src/
├── viz/
│   ├── index.ts              # Public API: generateVisualization(), VizConfig type
│   ├── graph-model.ts        # TypeScript types + Zod schemas for graph nodes/edges
│   ├── data-extractor.ts     # Extract graph data from case evidence + dossiers
│   ├── html-generator.ts     # Assembles self-contained HTML string
│   ├── templates/
│   │   └── viz-logic.ts      # Client-side D3 JS as template literal (force sim, tree, zoom, drag, tooltips)
│   └── theme.ts              # CSS variables, entity colors, risk colors (from UI-SPEC)
├── server/
│   ├── app.ts                # Add GET /viz/:id route (existing file)
│   └── index.ts              # Existing server start (unchanged)
├── cli.ts                    # Add viz subcommand (existing file)
└── ...existing modules
```

### Pattern 1: HTML Template Generator (String Concatenation)
**What:** Build complete HTML documents by string concatenation in Node.js -- no template engine, no DOM library.
**When to use:** When generating self-contained HTML files with embedded assets (CSS, JS, data).
**Example:**
```typescript
// Source: project pattern, aligned with UI-SPEC HTML structure
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Read D3 UMD bundle once at module load (cached by Node.js module system)
const d3Script = readFileSync(
  resolve(import.meta.dirname, '../../node_modules/d3/dist/d3.min.js'),
  'utf-8'
);

export function generateHtml(data: GraphData, title: string): string {
  const cssVars = buildCssVariables(); // from theme.ts
  const graphJson = JSON.stringify(data);
  const vizLogic = buildVizLogic(); // from viz-logic.ts

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>${cssVars}\n${layoutCss}</style>
</head>
<body>
  <div id="viz-root">
    <div id="control-bar"><!-- layout toggle, zoom reset --></div>
    <svg id="graph"></svg>
    <div id="legend-panel"></div>
    <div id="tooltip"></div>
  </div>
  <script>${d3Script}</script>
  <script>const GRAPH_DATA = ${graphJson};</script>
  <script>${vizLogic}</script>
</body>
</html>`;
}
```

### Pattern 2: D3 Force-Directed Graph (Client-Side)
**What:** D3 force simulation with charge, link, center, and collision forces.
**When to use:** Default layout for money flow visualization.
**Example:**
```typescript
// Source: https://d3js.org/d3-force/simulation [CITED: d3js.org]
// This code runs in the BROWSER (embedded in HTML as inline script)

const simulation = d3.forceSimulation(nodes)
  .force('charge', d3.forceManyBody().strength(-300))
  .force('link', d3.forceLink(links).id(d => d.id).distance(120))
  .force('center', d3.forceCenter(width / 2, height / 2))
  .force('collision', d3.forceCollide().radius(d => d.radius + 8))
  .alphaDecay(0.02)
  .velocityDecay(0.4)
  .on('tick', () => {
    linkElements.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    nodeElements.attr('transform', d => `translate(${d.x},${d.y})`);
  });
```

### Pattern 3: D3 Tree Layout (Client-Side)
**What:** Hierarchical tree layout for directed fund flow from source to destinations.
**When to use:** When user toggles to "Tree" mode.
**Example:**
```typescript
// Source: https://d3js.org/d3-hierarchy/tree [CITED: d3js.org]
// Runs in browser. Transaction data must be converted to hierarchy first.

function switchToTree(data) {
  simulation.stop(); // stop force simulation
  const root = d3.hierarchy(buildHierarchy(data));
  const treeLayout = d3.tree()
    .size([width, height - 100])
    .separation((a, b) => 1.5);
  treeLayout(root);

  // Animate nodes to tree positions
  nodeElements.transition().duration(500)
    .attr('transform', d => `translate(${d.treeX},${d.treeY})`);
  // Redraw links as curves
  linkElements.transition().duration(500)
    .attr('d', d3.link(d3.curveBumpY).x(d => d.x).y(d => d.y));
}
```

### Pattern 4: D3 Zoom + Pan (Client-Side)
**What:** D3 zoom behavior for pan and zoom on the SVG canvas.
**Example:**
```typescript
// Source: https://d3js.org/d3-zoom [CITED: d3js.org]
const zoom = d3.zoom()
  .scaleExtent([0.1, 8])
  .on('zoom', (event) => {
    svgGroup.attr('transform', event.transform);
  });
svg.call(zoom);

// Auto-fit all nodes on load
function fitToView() {
  const bounds = svgGroup.node().getBBox();
  const fullWidth = svg.node().clientWidth;
  const fullHeight = svg.node().clientHeight;
  const scale = Math.min(
    (fullWidth - 64) / bounds.width,
    (fullHeight - 64) / bounds.height
  );
  const transform = d3.zoomIdentity
    .translate(fullWidth / 2, fullHeight / 2)
    .scale(scale)
    .translate(-bounds.x - bounds.width / 2, -bounds.y - bounds.height / 2);
  svg.transition().duration(250).call(zoom.transform, transform);
}
```

### Pattern 5: D3 Drag (Client-Side, Force Layout Only)
**What:** Enable node dragging in force-directed layout.
**Example:**
```typescript
// Source: https://d3js.org/d3-drag [CITED: d3js.org]
const drag = d3.drag()
  .on('start', (event, d) => {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  })
  .on('drag', (event, d) => {
    d.fx = event.x;
    d.fy = event.y;
  })
  .on('end', (event, d) => {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  });

nodeElements.call(drag);
```

### Pattern 6: Hono Route for Serving Viz HTML
**What:** Dynamic route that reads stored HTML files and returns them.
**Example:**
```typescript
// Source: https://hono.dev/docs/api/context [CITED: hono.dev]
// Added to src/server/app.ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

app.get('/viz/:id', async (c) => {
  const vizId = c.req.param('id');
  // Validate vizId format to prevent path traversal
  if (!/^[a-zA-Z0-9_-]+$/.test(vizId)) {
    return c.json({ error: 'Invalid visualization ID' }, 400);
  }
  // Find HTML file — search across all cases
  const html = await findVizHtml(vizId);
  if (!html) {
    return c.json({ error: 'Visualization not found' }, 404);
  }
  return c.html(html);
});
```

### Anti-Patterns to Avoid
- **Server-side D3 rendering with jsdom:** Produces static SVG, loses all interactivity (drag, zoom, pan, tooltips). The browser MUST run D3 for interactive features.
- **CDN references in self-contained HTML:** Violates the "no external dependencies" requirement. Inline everything.
- **Template engines (Handlebars, EJS):** Unnecessary complexity for string concatenation. Template literals are sufficient.
- **Storing D3.min.js as a project file:** Read from `node_modules/d3/dist/d3.min.js` at generation time. This ensures the version stays in sync with `package.json`.
- **Dynamic `import()` for D3 in Node.js:** D3 v7 is ESM-only in its main entry. The UMD bundle at `dist/d3.min.js` is what gets inlined into HTML; Node.js never imports D3 as a module.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Force-directed graph layout | Custom force simulation | `d3-force` (`d3.forceSimulation`) | Velocity Verlet integrator handles charge, link, center, collision forces with tuned numerical stability |
| Tree/hierarchy layout | Custom tree positioning | `d3-hierarchy` (`d3.tree()`) | Correct Reingold-Tilford algorithm with configurable separation |
| Pan/zoom behavior | Custom mouse/touch event handlers | `d3-zoom` | Handles wheel, touch, pinch, double-click, with smooth transitions and scale/translate composition |
| Drag behavior | Custom mousedown/mousemove/mouseup | `d3-drag` | Correctly integrates with force simulation (fx/fy, alphaTarget), handles touch events |
| SVG shapes (hexagon, diamond) | SVG path strings by hand | Compute from parametric formulas | Use `d3.pointRadial()` or precomputed path strings for consistent shapes |
| Browser launch | Custom `child_process.exec('open')` | `open` npm package | Cross-platform (macOS, Linux, Windows), handles WSL, correct escaping |
| HTML escaping | Custom regex | Utility function | Only needed for title and labels -- small helper, but must handle `<>&"'` |

**Key insight:** D3's sub-modules are battle-tested for exactly the interactions specified (force simulation + drag, tree layout, zoom/pan). Reimplementing any of these would be months of work to match D3's correctness and cross-browser compatibility.

## Common Pitfalls

### Pitfall 1: D3 UMD Bundle Path Resolution
**What goes wrong:** `readFileSync` with relative path fails when CLI is run from a different working directory, or when the package is installed globally via npx.
**Why it happens:** `node_modules/d3/dist/d3.min.js` is relative to the project root, but the CLI may execute from any directory.
**How to avoid:** Use `import.meta.dirname` (or `fileURLToPath(import.meta.url)`) to resolve the path relative to the source file location, then traverse up to find `node_modules`. Alternatively, use `createRequire(import.meta.url).resolve('d3/dist/d3.min.js')`.
**Warning signs:** "ENOENT: no such file or directory" errors when running `chain-insights viz` outside the project directory.

### Pitfall 2: Force-to-Tree Layout Transition
**What goes wrong:** Switching from force to tree layout causes nodes to jump abruptly or disappear because position data models differ.
**Why it happens:** Force layout stores positions on `node.x/y/fx/fy`; tree layout computes `node.x/y` via `d3.tree()` which overwrites them. If you don't store both sets of coordinates, you lose the force positions.
**How to avoid:** Store force positions separately (e.g., `node.forceX/forceY`) before computing tree layout. On toggle back to force, restore from saved positions and restart simulation.
**Warning signs:** Layout toggle button causes visual glitches or nodes stuck at (0,0).

### Pitfall 3: Transaction Data to Hierarchy Conversion
**What goes wrong:** `d3.hierarchy()` requires a tree structure (single root, no cycles), but money flow graphs are directed graphs with potential cycles (addresses sending funds back and forth).
**Why it happens:** Real blockchain transaction data is a graph, not a tree.
**How to avoid:** Build a "virtual root" node that connects to all source addresses. Break cycles by keeping only the first occurrence of each edge in a DFS traversal. Document that tree layout is an approximation -- some edges may be hidden. Show a warning when cycles are detected.
**Warning signs:** "Maximum call stack size exceeded" from recursive hierarchy construction.

### Pitfall 4: HTML File Size with Full D3 Bundle
**What goes wrong:** Full `d3.min.js` is ~240KB minified. Combined with visualization logic, CSS, and data, HTML files can be 500KB+.
**Why it happens:** D3 v7 includes 30+ submodules; we only need ~6 (selection, force, hierarchy, zoom, drag, scale).
**How to avoid:** For MVP, use the full bundle (~240KB) -- it works and is simple. If size becomes an issue, create a custom D3 bundle with only required modules using Rollup (can reduce to ~60-80KB). This is an optimization, not a blocker.
**Warning signs:** Slow page loads on older machines.

### Pitfall 5: Path Traversal in Viz ID Route
**What goes wrong:** An attacker crafts a viz ID like `../../etc/passwd` to read arbitrary files.
**Why it happens:** The Hono route `GET /viz/:id` uses the ID to construct a file path.
**How to avoid:** Validate viz ID format with regex `/^[a-zA-Z0-9_-]+$/` before using it in path construction. This matches the existing case ID validation pattern in `schema.ts`.
**Warning signs:** Files outside `~/.chain-insights/` being readable through the viz route.

### Pitfall 6: SVG Namespace in Inline HTML
**What goes wrong:** D3 SVG elements don't render correctly because the SVG namespace isn't set.
**Why it happens:** When creating SVG elements with D3 in an HTML document, the `xmlns` attribute must be present on the root `<svg>` element.
**How to avoid:** Ensure the `<svg>` element in the HTML template includes `xmlns="http://www.w3.org/2000/svg"`. D3's `d3.create("svg")` handles this automatically in the browser, but the initial `<svg>` tag in the HTML template must have it.
**Warning signs:** Shapes render as rectangles or don't appear at all.

### Pitfall 7: Graph Data from Evidence Files
**What goes wrong:** Evidence files contain free-form markdown text, not structured transaction data. Extracting graph nodes/edges from unstructured content is unreliable.
**Why it happens:** Evidence is stored as markdown with frontmatter (see `EvidenceStore.append`). The content field is free-form text from MCP query results.
**How to avoid:** The data extractor should look for structured JSON blocks within evidence content (e.g., code blocks with transaction arrays). Also support the `--data <file.json>` standalone mode as the primary reliable path. For case-based extraction, define a clear JSON format that agents are expected to produce.
**Warning signs:** `chain-insights viz <case-id>` produces empty graphs because evidence doesn't contain parseable transaction data.

## Code Examples

### Graph Data Model (Zod Schema)
```typescript
// Source: project pattern (Zod 4.x) + UI-SPEC entity/risk definitions
import * as z from 'zod';

export const EntityType = z.enum(['eoa', 'contract', 'exchange', 'mixer', 'unknown']);
export const RiskLevel = z.enum(['low', 'medium', 'high', 'critical', 'unknown']);

export const GraphNode = z.object({
  id: z.string().min(1),           // address or entity identifier
  label: z.string().optional(),     // display label (truncated address)
  entityType: EntityType.default('unknown'),
  riskLevel: RiskLevel.default('unknown'),
  totalIn: z.number().default(0),   // total incoming value
  totalOut: z.number().default(0),  // total outgoing value
  txCount: z.number().int().default(0),
  firstSeen: z.string().optional(),
  lastSeen: z.string().optional(),
});

export const GraphEdge = z.object({
  source: z.string().min(1),        // source node ID
  target: z.string().min(1),        // target node ID
  value: z.number(),                // transaction value
  txHash: z.string().optional(),
  blockNumber: z.number().int().optional(),
  timestamp: z.string().optional(),
});

export const GraphData = z.object({
  nodes: z.array(GraphNode),
  edges: z.array(GraphEdge),
  metadata: z.object({
    caseId: z.string().optional(),
    title: z.string().default('Money Flow'),
    generatedAt: z.string(),
    truncated: z.boolean().default(false),
    totalNodes: z.number().int().optional(),
    hiddenNodes: z.number().int().optional(),
  }),
});

export type GraphData = z.infer<typeof GraphData>;
export type GraphNode = z.infer<typeof GraphNode>;
export type GraphEdge = z.infer<typeof GraphEdge>;
```

### D3 Entity Shapes (Client-Side SVG Paths)
```typescript
// Source: UI-SPEC entity shape specification
// These run in the browser as part of the inline viz logic

function entityShape(type, radius) {
  switch (type) {
    case 'eoa':
      return null; // Use <circle r={radius}>
    case 'contract': // Diamond
      return `M0,${-radius} L${radius},0 L0,${radius} L${-radius},0 Z`;
    case 'exchange': { // Hexagon
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 2;
        pts.push(`${radius * Math.cos(angle)},${radius * Math.sin(angle)}`);
      }
      return `M${pts.join('L')}Z`;
    }
    case 'mixer': // Triangle
      return `M0,${-radius} L${radius * 0.866},${radius * 0.5} L${-radius * 0.866},${radius * 0.5} Z`;
    default:
      return null; // fallback to circle
  }
}
```

### Node Size Scaling (from UI-SPEC)
```typescript
// Source: UI-SPEC "Node size scaling" section
function nodeRadius(volume, medianVolume) {
  return Math.max(16, Math.min(36, 20 + Math.log2(volume / medianVolume) * 4));
}
```

### Edge Thickness Scaling
```typescript
// Source: UI-SPEC edge specification
function edgeWidth(value, minValue, maxValue) {
  if (maxValue === minValue) return 2;
  return 1 + ((value - minValue) / (maxValue - minValue)) * 5; // 1px to 6px
}
```

### CLI Viz Subcommand Registration
```typescript
// Source: existing CLI pattern in src/cli.ts
program
  .command('viz')
  .description('Generate money flow visualization')
  .argument('[case-id]', 'Case ID to visualize')
  .option('--data <file>', 'Raw transaction JSON file for ad-hoc visualization')
  .option('-p, --port <number>', 'Server port (default: 4321)', '4321')
  .action(async (caseId: string | undefined, opts: { data?: string; port: string }) => {
    try {
      const { generateVisualization } = await import('./viz/index.js');
      const { startServer } = await import('./server/index.js');
      const open = (await import('open')).default;

      const result = await generateVisualization({ caseId, dataFile: opts.data });
      const port = parseInt(opts.port, 10);
      const stop = startServer(port);
      const url = `http://127.0.0.1:${port}/viz/${result.vizId}`;
      console.log(`Visualization: ${url}`);
      await open(url);
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });
```

### Hono Route Integration
```typescript
// Source: Hono docs c.html() [CITED: hono.dev/docs/api/context]
// Added to createApp() in src/server/app.ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

app.get('/viz/:id', async (c) => {
  const id = c.req.param('id');
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return c.json({ error: 'Invalid visualization ID' }, 400);
  }
  const vizDir = path.join(os.homedir(), '.chain-insights', 'viz');
  const filePath = path.join(vizDir, `${id}.html`);
  try {
    const html = await readFile(filePath, 'utf-8');
    return c.html(html);
  } catch {
    return c.json({ error: 'Visualization not found' }, 404);
  }
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| D3 v3/v4 global `d3.layout.force()` | D3 v7 modular `d3.forceSimulation()` | D3 v4 (2016) | Force API completely changed; examples using `d3.layout.force()` are outdated |
| jsdom for server-side D3 rendering | Client-side D3 in self-contained HTML | N/A (architectural decision) | jsdom approach loses interactivity; inlining D3 in HTML preserves drag/zoom/pan |
| D3 v3 `d3.svg.line` | D3 v7 `d3.line()` | D3 v4 (2016) | All shape generators moved to `d3-shape` module |
| D3 v3 enter/update/exit pattern | D3 v7 `selection.join()` | D3 v5 (2018) | Simplified DOM diffing; use `.join()` instead of manual enter/exit |

**Deprecated/outdated:**
- `d3.layout.force()`: Replaced by `d3.forceSimulation()` in D3 v4+. Any code using the old API will not work.
- `d3.svg.diagonal()`: Replaced by `d3.linkVertical()` / `d3.linkHorizontal()` in D3 v4+.
- jsdom `env()` method: Replaced by `new JSDOM()` constructor. Old examples using `jsdom.env({...})` are outdated.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@types/d3` is current and compatible with d3@7.9.0 | Standard Stack | Type errors during development; fallback is `declare module 'd3'` |
| A2 | D3 UMD min bundle lives at `node_modules/d3/dist/d3.min.js` | Architecture Patterns | HTML generator cannot find D3 bundle; fix by checking actual dist path after `npm install` |
| A3 | Evidence files from case store contain parseable transaction data in JSON code blocks | Pitfall 7 | Case-based viz produces empty graphs; standalone `--data` mode still works |
| A4 | Full D3 bundle (~240KB min) is acceptable for self-contained HTML | Pitfall 4 | Large file size; mitigate with custom bundle later |

## Open Questions

1. **Evidence-to-Graph Data Extraction Format**
   - What we know: Evidence files are free-form markdown. The `--data <file.json>` standalone mode accepts structured JSON.
   - What's unclear: What format should agents produce when saving transaction evidence? Do we need a convention for embedding structured transaction data in evidence files?
   - Recommendation: Define a JSON schema for transaction data and document it. For MVP, prioritize `--data <file.json>` and attempt best-effort extraction from evidence. The agent (Claude) can be instructed to save evidence in the expected format.

2. **Viz File Storage Location**
   - What we know: CONTEXT.md says `~/.chain-insights/cases/<case-id>/viz/`. But the Hono route needs to look up by viz ID across all cases.
   - What's unclear: Should viz files live per-case or in a central `~/.chain-insights/viz/` directory with case ID in the filename?
   - Recommendation: Store HTML files in `~/.chain-insights/viz/<viz-id>.html` (central directory) with case ID embedded in the viz ID (e.g., `<case-id>_<timestamp>`). The case directory gets a symlink or reference. This simplifies the Hono route lookup.

3. **Server Lifecycle for Single-Use Viz**
   - What we know: The CLI starts a server, opens the browser, but the server keeps running (blocking the terminal).
   - What's unclear: Should the server auto-shutdown after some timeout, or stay running until Ctrl+C?
   - Recommendation: Keep the server running (same behavior as `chain-insights serve`). The user already has Ctrl+C. A "press any key to stop" prompt would be a nice touch.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | v24.13.1 | -- |
| npm | Package install | Yes | 11.13.0 | -- |
| d3 | Graph rendering | No (not installed yet) | 7.9.0 (npm) | Install via `npm install d3` |
| open | Browser launch | No (not installed yet) | 11.0.0 (npm) | Install via `npm install open` |
| Default browser | Viewing viz | Yes (system) | -- | User can manually open URL |

**Missing dependencies with no fallback:**
- None (all dependencies are installable via npm)

**Missing dependencies with fallback:**
- d3, open: Not yet installed but available in npm registry. Installation is a Wave 0 task.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 |
| Config file | `vitest.config.ts` (existing, with unit + integration projects) |
| Quick run command | `npx vitest run --project unit` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VIZ-01 | Graph data model validates correctly | unit | `npx vitest run tests/viz-graph-model.test.ts -x` | No -- Wave 0 |
| VIZ-01 | HTML generator produces valid HTML with D3 inline | unit | `npx vitest run tests/viz-html-generator.test.ts -x` | No -- Wave 0 |
| VIZ-01 | Data extractor parses JSON transaction files | unit | `npx vitest run tests/viz-data-extractor.test.ts -x` | No -- Wave 0 |
| VIZ-01 | Truncation logic keeps top N nodes by value | unit | `npx vitest run tests/viz-data-extractor.test.ts -x` | No -- Wave 0 |
| VIZ-02 | Hono /viz/:id route serves HTML with correct content-type | unit | `npx vitest run tests/viz-server.test.ts -x` | No -- Wave 0 |
| VIZ-02 | Viz ID path traversal rejected | unit | `npx vitest run tests/viz-server.test.ts -x` | No -- Wave 0 |
| VIZ-03 | CLI viz command registers and parses args | unit | `npx vitest run tests/viz-cli.test.ts -x` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --project unit`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/viz-graph-model.test.ts` -- covers VIZ-01 (schema validation)
- [ ] `tests/viz-html-generator.test.ts` -- covers VIZ-01 (HTML generation)
- [ ] `tests/viz-data-extractor.test.ts` -- covers VIZ-01 (data extraction + truncation)
- [ ] `tests/viz-server.test.ts` -- covers VIZ-02 (Hono route)
- [ ] `tests/viz-cli.test.ts` -- covers VIZ-03 (CLI integration)
- [ ] Package install: `npm install d3 open && npm install --save-dev @types/d3`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Localhost-only server, no auth needed |
| V3 Session Management | No | Stateless HTML serving |
| V4 Access Control | No | Local filesystem only |
| V5 Input Validation | Yes | Zod for graph data schema; regex for viz ID; HTML escaping for embedded strings |
| V6 Cryptography | No | No secrets in visualization |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via viz ID | Tampering | Regex validation `/^[a-zA-Z0-9_-]+$/` on viz ID before path construction |
| XSS via embedded graph data | Tampering | Graph data is serialized as JSON literal (not HTML); node labels and addresses must be escaped if rendered as HTML text content |
| Prototype pollution via JSON.parse | Tampering | Zod validation strips unexpected fields; use `JSON.parse` on trusted input only |
| Server binding to 0.0.0.0 | Information Disclosure | Already mitigated: server binds to `127.0.0.1` only (see existing `src/server/index.ts`) |

## Sources

### Primary (HIGH confidence)
- [Context7 /d3/d3-force] - force simulation API, forceLink, forceManyBody, forceCenter, forceCollide
- [Context7 /websites/d3js] - d3-hierarchy tree layout, d3-zoom, d3-drag, d3-shape link generators
- [Context7 /jsdom/jsdom] - JSDOM constructor, pretendToBeVisual, serialize methods (confirmed NOT needed)
- [Context7 /llmstxt/hono_dev_llms_txt] - serveStatic, c.html(), route patterns
- [npm registry] - d3@7.9.0, open@11.0.0, jsdom@29.1.1 versions verified
- [Existing codebase] - src/server/app.ts, src/cli.ts, src/cases/ patterns

### Secondary (MEDIUM confidence)
- [d3js.org/getting-started](https://d3js.org/getting-started) - UMD bundle distribution, inline embedding approach
- [bundlephobia.com](https://bundlephobia.com/package/d3) - D3 bundle size (~240KB minified)
- [github.com/sindresorhus/open](https://github.com/sindresorhus/open) - open v11 API, ESM-only, cross-platform

### Tertiary (LOW confidence)
- [gist: ThisIsTian/7133871](https://gist.github.com/ThisIsTian/7133871136fd96bd465cc7e5169bd5c0) - Server-side D3 rendering pattern (useful for understanding what NOT to do)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries verified against npm registry; existing project already uses Hono, Zod, Commander
- Architecture: HIGH - Client-side D3 rendering is the standard pattern for interactive visualizations; confirmed by UI-SPEC and D3 documentation
- Pitfalls: HIGH - Force/tree layout transitions and graph-to-hierarchy conversion are well-documented D3 challenges
- Data extraction: MEDIUM - Evidence file format for structured transaction data is not yet defined

**Research date:** 2026-05-11
**Valid until:** 2026-06-11 (D3 v7 and Hono are stable; no breaking changes expected)
