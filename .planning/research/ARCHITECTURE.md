# Architecture Patterns

**Domain:** Local-first agent framework for blockchain AML investigations
**Researched:** 2026-05-10

## Recommended Architecture

Chain Insights is an npm-distributed TypeScript framework that gives AI coding agents (Claude Code, Codex, Open Claw) the skills, state management, and tooling to run professional AML investigations. The architecture has six major components connected by well-defined boundaries.

```
                        +---------------------------+
                        |     AI Agent Runtimes      |
                        |  (Claude Code, Codex, etc) |
                        +----------+----------------+
                                   |
                          slash commands / skills
                                   |
                        +----------v----------------+
                        |   Command Layer            |
                        |   (skills + hooks +        |
                        |    playbook runner)         |
                        +----------+----------------+
                                   |
                    +--------------+--------------+
                    |              |              |
           +-------v---+  +------v------+ +-----v------+
           | Case       |  | Evidence    | | Playbook   |
           | Manager    |  | & Dossier   | | Engine     |
           | (state)    |  | Store       | | (workflows)|
           +-------+---+  +------+------+ +-----+------+
                   |              |              |
                   +------+------+------+-------+
                          |             |
                  +-------v---+  +-----v---------+
                  | DuckDB    |  | Flat Files     |
                  | (analytics|  | (.chain-insights/|
                  |  + cache) |  |  markdown/JSON) |
                  +-----------+  +----------------+
                          |
                  +-------v---+         +------------------+
                  | Local HTTP |-------->| D3.js Viz Server |
                  | Server     |         | (graph render)   |
                  | (Fastify)  |         +------------------+
                  +-------+---+
                          |
                  +-------v---+
                  | x402 MCP   |
                  | Client     |
                  | (paid API) |
                  +------------+
```

### Component Boundaries

| Component | Responsibility | Communicates With | Data Owned |
|-----------|---------------|-------------------|------------|
| **Command Layer** | Slash commands, skills, hooks wired to AI agent runtimes. Entry point for all investigator actions. | Case Manager, Playbook Engine, Local Server | Command definitions (`.claude/skills/`, `.claude/commands/`) |
| **Case Manager** | Open/close/tag cases, track investigation state, maintain case timeline | Flat Files, DuckDB, Dossier Store | Case metadata, state transitions |
| **Evidence & Dossier Store** | Accumulate evidence, notes, findings per entity/case. Human-readable flat files. | Flat Files, Case Manager | Evidence artifacts, dossier entries |
| **Playbook Engine** | Reusable investigation workflows (trace funds, risk check, entity profiling). Executes multi-step playbooks. | Case Manager, x402 MCP Client, DuckDB | Playbook definitions, execution state |
| **DuckDB Analytical Store** | Analytical queries over cached MCP responses, transaction data, monitoring results | Flat Files (Parquet export), Local Server | Query cache, aggregated analytics, watcher results |
| **Local HTTP Server (Fastify)** | Serves D3.js visualizations, provides API for state queries, handles watcher polling | DuckDB, Flat Files, x402 MCP Client, D3.js Viz | Server state, active connections |
| **x402 MCP Client** | Wraps fetch with x402 payment handling, manages wallet, calls Chain Insights MCP | External MCP Server | Wallet config, payment receipts |
| **D3.js Visualization** | Force/tree graph rendering for money flow visualization, served as static HTML with live data injection | Local Server (via API), DuckDB | Rendered HTML/SVG assets |

## Detailed Component Design

### 1. Command Layer (Skills + Hooks)

**Pattern:** Borrow directly from GSD's architecture. Commands are markdown files with YAML frontmatter + XML process blocks. Skills are directories with `SKILL.md` files.

```
.claude/
  skills/
    ci-open-case/
      SKILL.md           # Open a new investigation case
    ci-trace-funds/
      SKILL.md           # Run fund-tracing playbook
    ci-risk-check/
      SKILL.md           # Risk-score an entity
    ci-visualize/
      SKILL.md           # Generate money flow graph
    ci-watch/
      SKILL.md           # Set up address watcher
    ci-dossier/
      SKILL.md           # View/add to entity dossier
    ci-mcp-schema/
      SKILL.md           # Show available MCP tools
    ci-fast/
      SKILL.md           # Quick MCP query (like GSD's /gsd-fast)
  commands/
    ci/
      status.md          # Case status overview
      evidence.md        # Evidence management
      playbook.md        # List/run playbooks
```

**Frontmatter pattern (adapted from GSD):**
```yaml
---
name: ci:open-case
description: Open a new AML investigation case
argument-hint: "[case-name] [entity-or-address]"
allowed-tools:
  - Read
  - Write
  - Bash
---
```

**Installation model:** `npx chain-insights --claude` installs skills + hooks to `~/.claude/skills/ci-*` and `.claude/skills/ci-*` (project-level). Same symlink/copy pattern as GSD's `bin/install.js`.

**Confidence:** HIGH -- directly observed in GSD reference implementation and confirmed against current Claude Code skills documentation.

### 2. Case Manager

**Pattern:** Flat-file state machine with frontmatter metadata, inspired by GSD's STATE.md / phase system.

```
.chain-insights/
  cases/
    case-2024-001-tornado-trace/
      CASE.md              # Case metadata (frontmatter YAML + body)
      timeline.md          # Chronological investigation log
      evidence/
        tx-0xabc.md        # Evidence artifact
        risk-report-entity-x.json
      dossiers/
        entity-x.md        # Entity dossier (accumulated context)
        wallet-0x123.md    # Wallet profile
      watches/
        watch-0x123.json   # Active watcher config
      playbook-runs/
        trace-funds-001.md # Playbook execution record
    case-2024-002-mixer-analysis/
      CASE.md
      ...
  config.json              # Framework config (wallet, MCP endpoint, etc.)
  active-case              # Pointer to current active case (like GSD's active-workstream)
```

**CASE.md format:**
```yaml
---
id: case-2024-001
name: Tornado Cash Trace
status: open           # open | active | suspended | closed
created: 2024-01-15
updated: 2024-02-01
tags: [tornado-cash, mixer, eth]
entities: [0x123..., 0xabc...]
risk_level: high
evidence_count: 12
playbook_runs: 3
---

## Summary
Investigation into fund flows through Tornado Cash from address 0x123...

## Key Findings
- ...
```

**State transitions:** open -> active -> suspended -> closed. Transitions logged to `timeline.md` automatically.

**Confidence:** HIGH -- this directly mirrors GSD's STATE.md pattern with domain-specific vocabulary applied.

### 3. Evidence & Dossier Store

**Pattern:** Flat markdown files for human readability and AI-agent friendliness. Each evidence artifact and dossier entry is a standalone file.

**Evidence artifacts** are MCP query results, screenshots, transaction traces, and manual notes saved as markdown or JSON. They include provenance metadata:

```yaml
---
type: mcp-query-result
source: chain-insights-mcp
tool: trace_funds
query_time: 2024-01-15T10:30:00Z
cost: $0.002
case: case-2024-001
---

## Fund Trace: 0x123 -> Tornado Cash

[structured result data]
```

**Dossiers** are living documents per entity/address that accumulate findings across playbook runs:

```yaml
---
entity: 0x123...
type: wallet
first_seen: 2024-01-15
risk_score: 0.87
tags: [high-risk, mixer-user, sanctioned-contact]
related_cases: [case-2024-001]
---

## Profile
...

## Transaction History
...

## Risk Indicators
...
```

**Why flat files over pure DB:** Investigation data must be human-readable, git-trackable, and portable. An investigator should be able to open a case folder and read everything without running software. DuckDB provides the analytical layer on top.

**Confidence:** HIGH -- validated by GSD's `.planning/` pattern success and AML domain requirements for auditability.

### 4. Playbook Engine

**Pattern:** Declarative workflow definitions (markdown) executed by the AI agent, similar to GSD's workflow system but domain-specific.

```
chain-insights/
  playbooks/
    trace-funds.md         # Fund tracing workflow
    risk-check.md          # Entity risk assessment
    entity-profile.md      # Build entity dossier
    mixer-analysis.md      # Mixer/tumbler investigation
    sanctions-screen.md    # OFAC/sanctions check
    custom/                # User-defined playbooks
```

**Playbook format:**
```yaml
---
name: trace-funds
description: Trace fund flows from a source address through N hops
arguments: [source_address, hops]
mcp_tools_required: [trace_funds, get_transactions, risk_score]
estimated_cost: $0.01-0.05
---

<steps>
<step name="validate-input">
Validate the source address format and check if it exists on-chain.
Call MCP tool: validate_address with $source_address
</step>

<step name="initial-trace">
Query the MCP for direct fund flows from the source address.
Call MCP tool: trace_funds with source=$source_address, depth=$hops
Save result as evidence: trace-{source_address}-{timestamp}.md
</step>

<step name="risk-assessment">
For each counterparty found, check risk scores.
Call MCP tool: risk_score for each unique address in the trace.
Update dossier for each entity with new risk data.
</step>

<step name="summarize">
Write a summary of findings to the case timeline.
Generate a visualization request for the money flow graph.
</step>
</steps>
```

**Execution model:** The playbook is loaded into the AI agent's context as a skill. The agent executes steps sequentially, making MCP calls through the x402 client, saving evidence to flat files, and updating case state. This is NOT a rigid state machine -- the AI agent has discretion within each step, just as GSD's executor has discretion within plan tasks.

**Confidence:** MEDIUM -- pattern is validated by GSD's workflow system, but the MCP-call-per-step cost model is novel and needs phase-specific validation.

### 5. DuckDB Analytical Store

**Pattern:** Embedded analytical database for caching, querying, and aggregating investigation data. No separate server process.

**Technology:** `@duckdb/node-api` (Neo client) -- the modern TypeScript-native API for DuckDB with Promise-based async, not the older callback-style `duckdb` npm package.

```typescript
import { DuckDBInstance } from '@duckdb/node-api';

// File-based database in project directory
const instance = await DuckDBInstance.create(
  '.chain-insights/analytics.duckdb'
);
const connection = await instance.connect();
```

**Schema design:**

```sql
-- Cached MCP query results (avoids re-paying for identical queries)
CREATE TABLE query_cache (
  id UUID PRIMARY KEY,
  tool_name VARCHAR NOT NULL,
  params_hash VARCHAR NOT NULL,       -- SHA256 of sorted params JSON
  params JSON NOT NULL,
  result JSON NOT NULL,
  cost_usd DECIMAL(10, 6),
  queried_at TIMESTAMP DEFAULT current_timestamp,
  ttl_seconds INTEGER DEFAULT 3600,
  case_id VARCHAR
);

-- Transaction data (denormalized for analytical queries)
CREATE TABLE transactions (
  tx_hash VARCHAR PRIMARY KEY,
  chain VARCHAR NOT NULL,
  from_address VARCHAR,
  to_address VARCHAR,
  value_wei HUGEINT,
  value_usd DECIMAL(18, 2),
  block_number BIGINT,
  timestamp TIMESTAMP,
  case_id VARCHAR,
  risk_flags VARCHAR[]
);

-- Entity risk scores (time-series for trend analysis)
CREATE TABLE entity_risk (
  address VARCHAR,
  score DECIMAL(5, 4),
  scoring_method VARCHAR,
  scored_at TIMESTAMP DEFAULT current_timestamp,
  factors JSON,
  case_id VARCHAR
);

-- Watcher results (polling history)
CREATE TABLE watcher_events (
  watcher_id VARCHAR,
  address VARCHAR,
  event_type VARCHAR,
  event_data JSON,
  detected_at TIMESTAMP DEFAULT current_timestamp,
  notified BOOLEAN DEFAULT false
);
```

**Why DuckDB:**
- Embedded: no Docker, no server process, zero dependency beyond Node.js
- Analytical: columnar storage, vectorized execution for aggregation queries over transaction sets
- Parquet-native: can export/import Parquet files for data sharing between investigators
- SQL: AI agents already know SQL -- no custom query language needed

**Cache-before-pay pattern:** Before making an x402 MCP call, check `query_cache` for a matching `params_hash` within TTL. Cache hits avoid payment. This is critical for cost control.

**Confidence:** HIGH -- DuckDB Node.js Neo API is well-documented and production-ready. Schema design follows standard AML data patterns.

### 6. Local HTTP Server (Fastify)

**Pattern:** Lightweight local-only server for visualization serving, state API, and watcher management.

**Technology:** Fastify with `@fastify/static` for serving generated HTML visualizations. Fastify chosen over Express for built-in TypeScript support, schema validation, and better performance.

```typescript
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'path';

const server = Fastify({ logger: true });

// Serve generated visualizations
server.register(fastifyStatic, {
  root: path.join(process.cwd(), '.chain-insights', 'viz'),
  prefix: '/viz/',
});

// API: Get case state
server.get('/api/cases/:id', async (request) => {
  // Read case state from flat files + DuckDB
});

// API: Query analytics
server.get('/api/analytics/query', async (request) => {
  // Execute DuckDB query and return results
});

// API: Money flow graph data
server.get('/api/graph/:caseId', async (request) => {
  // Return graph data for D3.js visualization
});

await server.listen({ port: 3847, host: '127.0.0.1' });
```

**Key design decisions:**
- **localhost-only**: Bind to `127.0.0.1`, never `0.0.0.0`. Investigation data must not leak.
- **Port selection**: Use a memorable port (e.g., `3847` = "EAML" on phone keypad) with automatic fallback if occupied.
- **Lifecycle**: Server starts on-demand when visualization or API is needed. Can be started by a skill (`/ci-visualize`) or the CLI (`chain-insights server`). Auto-shuts down after idle timeout.
- **No authentication**: Local-only server with no auth. Same trust model as local dev servers.

**Confidence:** HIGH -- Fastify with @fastify/static is well-established for this use case. The pattern is straightforward.

### 7. x402 MCP Client

**Pattern:** Wrapped fetch that automatically handles 402 Payment Required responses with EVM wallet signatures.

```typescript
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';

export async function createMCPClient(config: ChainInsightsConfig) {
  const signer = privateKeyToAccount(config.evmPrivateKey as `0x${string}`);

  const client = new x402Client();
  registerExactEvmScheme(client, { signer });

  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  return {
    async callTool(toolName: string, params: Record<string, unknown>) {
      // Check cache first
      const cached = await queryCache.get(toolName, params);
      if (cached) return cached;

      // Make paid MCP call
      const response = await fetchWithPayment(
        `${config.mcpEndpoint}/tools/${toolName}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        }
      );

      const result = await response.json();

      // Cache result
      await queryCache.set(toolName, params, result, response.headers);

      return result;
    },
  };
}
```

**Wallet management:**
- Private key stored in `.chain-insights/config.json` (gitignored)
- Support for environment variable `CI_EVM_PRIVATE_KEY` as override
- Future: CDP Server Wallet integration for managed key custody

**Cost tracking:**
- Every MCP call logs cost to DuckDB `query_cache` table
- Skills can show running cost: `/ci-status` includes "MCP spend this session: $0.23"
- Budget limits configurable in `config.json` with warnings at thresholds

**Confidence:** HIGH -- x402 client SDK is well-documented with clear TypeScript patterns. The cache-before-pay pattern is straightforward.

### 8. D3.js Visualization

**Pattern:** Server-generated HTML files with embedded D3.js that render money flow graphs in the browser.

**Approach:** Reuse existing rbmk viz code (force-directed and tree graphs). The visualization component generates self-contained HTML files with data inlined as JSON, served by the Fastify server.

```typescript
// Visualization generator
export function generateMoneyFlowViz(
  graphData: GraphData,
  outputPath: string
): string {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <script src="https://d3js.org/d3.v7.min.js"></script>
      <style>/* graph styles */</style>
    </head>
    <body>
      <div id="graph"></div>
      <script>
        const data = ${JSON.stringify(graphData)};
        // D3 force-directed graph rendering
        const simulation = d3.forceSimulation(data.nodes)
          .force("link", d3.forceLink(data.links).id(d => d.id))
          .force("charge", d3.forceManyBody().strength(-300))
          .force("center", d3.forceCenter(width/2, height/2));
        // ... rendering code
      </script>
    </body>
    </html>
  `;

  fs.writeFileSync(outputPath, html);
  return outputPath;
}
```

**Graph data model:**
```typescript
interface GraphData {
  nodes: Array<{
    id: string;            // Address or entity ID
    label: string;         // Display name
    type: 'wallet' | 'contract' | 'exchange' | 'mixer' | 'unknown';
    risk_score?: number;   // 0.0 - 1.0
    value_usd?: number;    // Total value through this node
  }>;
  links: Array<{
    source: string;
    target: string;
    value_usd: number;
    tx_count: number;
    tx_hashes: string[];
    timestamp_range: [string, string];
  }>;
}
```

**Confidence:** MEDIUM -- D3.js force-directed graphs are well-established, but the specific rbmk viz code reuse needs validation during implementation. The self-contained HTML generation pattern is proven.

## Data Flow

### Investigation Flow (Primary Path)

```
1. Investigator invokes /ci-open-case "tornado-trace" "0x123..."
   |
   v
2. Command Layer creates case directory structure in .chain-insights/cases/
   |
   v
3. Investigator runs /ci-trace-funds "0x123..." 3
   |
   v
4. Playbook Engine loads trace-funds.md playbook
   |
   v
5. For each step:
   a. Check DuckDB query_cache for existing results
   b. If cache miss: x402 MCP Client makes paid call to Chain Insights MCP
   c. Result saved as evidence file + cached in DuckDB
   d. Dossier updated for entities encountered
   |
   v
6. Case timeline updated with playbook run summary
   |
   v
7. /ci-visualize generates D3.js money flow graph
   |
   v
8. Fastify server starts (if not running), serves viz at localhost:3847/viz/...
   |
   v
9. Browser opens with interactive graph
```

### Watcher Flow (Background Path)

```
1. /ci-watch "0x123..." --interval 5m
   |
   v
2. Watcher config saved to .chain-insights/cases/{case}/watches/watch-0x123.json
   |
   v
3. CLI daemon (chain-insights watch-daemon) polls on interval:
   a. x402 MCP call to check for new activity
   b. New events saved to DuckDB watcher_events table
   c. If activity detected: create evidence file, update case timeline
   |
   v
4. Next time investigator opens case, new evidence is visible
```

### Data Storage Dual-Write Pattern

Every piece of investigation data lives in two places:

| Data Type | Flat File (Source of Truth) | DuckDB (Analytical Layer) |
|-----------|---------------------------|--------------------------|
| Case state | `CASE.md` frontmatter | Denormalized view for queries |
| Evidence | `evidence/*.md` or `*.json` | `query_cache` table |
| Dossiers | `dossiers/*.md` | Entity index for cross-case search |
| Watch results | (derived from DuckDB) | `watcher_events` table (source of truth for events) |
| Transactions | (derived from DuckDB) | `transactions` table (source of truth for tx data) |

**Flat files are source of truth for investigator-facing data** (case state, evidence, dossiers). DuckDB is source of truth for **machine-generated data** (cached queries, watcher events, transaction analytics). This split avoids the complexity of two-way sync while giving each storage system the data it handles best.

## Patterns to Follow

### Pattern 1: Cache-Before-Pay

**What:** Before every MCP call, check DuckDB for a cached result with matching parameters within TTL.
**When:** Every x402 MCP interaction.
**Why:** MCP calls cost real money via x402 micropayments. Redundant calls waste investigator funds.

```typescript
async function callToolWithCache(
  tool: string,
  params: Record<string, unknown>,
  ttlSeconds = 3600
): Promise<unknown> {
  const paramsHash = hashParams(tool, params);

  const cached = await db.run(`
    SELECT result FROM query_cache
    WHERE tool_name = $1 AND params_hash = $2
    AND queried_at > current_timestamp - INTERVAL '${ttlSeconds} seconds'
    ORDER BY queried_at DESC LIMIT 1
  `, { 1: tool, 2: paramsHash });

  if (cached.rowCount > 0) {
    return JSON.parse(cached.rows[0].result);
  }

  const result = await mcpClient.callTool(tool, params);

  await db.run(`
    INSERT INTO query_cache (id, tool_name, params_hash, params, result, cost_usd)
    VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
  `, { 1: tool, 2: paramsHash, 3: JSON.stringify(params),
       4: JSON.stringify(result), 5: result.cost });

  return result;
}
```

### Pattern 2: Flat-File-First State

**What:** Case state, evidence, and dossiers are always written to flat files first. DuckDB indexes are derived.
**When:** Any data write operation.
**Why:** Flat files are auditable, human-readable, portable, and survive DB corruption.

```typescript
// CORRECT: write flat file first, then index
async function saveEvidence(caseId: string, evidence: Evidence) {
  const filePath = `.chain-insights/cases/${caseId}/evidence/${evidence.filename}`;
  await fs.writeFile(filePath, renderEvidenceMarkdown(evidence));
  await db.run('INSERT INTO evidence_index ...', indexFromEvidence(evidence));
}

// WRONG: write to DB without flat file
// async function saveEvidence(caseId: string, evidence: Evidence) {
//   await db.run('INSERT INTO evidence ...', evidence); // No flat file!
// }
```

### Pattern 3: Skill-Per-Action

**What:** Each investigation action is a separate skill with clear boundaries. No monolithic skill.
**When:** Designing the command layer.
**Why:** Skills load only when invoked. A monolithic investigation skill would consume context budget even for simple queries.

### Pattern 4: Domain Vocabulary Enforcement

**What:** Use AML domain terms consistently: cases (not tasks), playbooks (not skills internally), evidence (not artifacts), dossiers (not memory), watches (not crons).
**When:** All code, documentation, and command naming.
**Why:** Prevents collision with GSD terminology. Investigators speak this language.

## Anti-Patterns to Avoid

### Anti-Pattern 1: DB-as-Source-of-Truth for Investigation Data

**What:** Storing case state, evidence, or dossiers only in DuckDB.
**Why bad:** Investigation data must be auditable by humans, portable between machines, and recoverable without running software. A corrupt DuckDB file would destroy an investigation.
**Instead:** Flat files first, DuckDB as derived index.

### Anti-Pattern 2: Global Server Process

**What:** Running the Fastify server as a persistent daemon that starts at boot.
**Why bad:** Local-first means zero background processes when not investigating. A persistent server consumes resources and creates attack surface.
**Instead:** On-demand server that starts when visualization is requested and auto-stops after idle timeout.

### Anti-Pattern 3: Direct MCP Calls Without Caching

**What:** Calling the x402 MCP endpoint directly from playbook steps without checking cache.
**Why bad:** Identical queries in the same investigation pay twice. A fund trace that re-checks risk scores for previously scored addresses wastes money.
**Instead:** Cache-before-pay pattern with configurable TTL per tool.

### Anti-Pattern 4: Monolithic Installer

**What:** A single install command that sets up everything for all runtimes simultaneously.
**Why bad:** Users start with one runtime (Claude Code). Installing Codex/Open Claw support they do not need creates confusion and file clutter.
**Instead:** `npx chain-insights --claude` (default), `--codex`, `--all` flags like GSD.

### Anti-Pattern 5: Embedding Wallet Private Keys in Skills

**What:** Having skills reference wallet keys directly or pass them as arguments.
**Why bad:** Skills are markdown files that may be committed to version control. Private keys in skills = leaked funds.
**Instead:** Config file (gitignored) or environment variable. Skills reference the MCP client abstraction, never the wallet.

## Package Structure

```
chain-insights/
  package.json               # npm package, bin: { "chain-insights": "bin/cli.js" }
  bin/
    cli.js                   # Main CLI entry point (install, server, watch-daemon)
    install.js               # Runtime installer (skills, hooks, config)
  src/
    core/
      case-manager.ts        # Case state machine
      evidence-store.ts      # Evidence file management
      dossier-store.ts       # Dossier management
      config.ts              # Configuration loading/validation
    db/
      connection.ts          # DuckDB instance management
      schema.ts              # Table creation / migration
      query-cache.ts         # Cache-before-pay implementation
    mcp/
      client.ts              # x402 MCP client wrapper
      tools.ts               # MCP tool type definitions
      cost-tracker.ts        # Payment tracking
    server/
      index.ts               # Fastify server setup
      routes/
        cases.ts             # Case API routes
        analytics.ts         # DuckDB query routes
        graph.ts             # Graph data routes
    viz/
      money-flow.ts          # D3.js graph generator
      templates/
        force-graph.html     # Force-directed graph template
        tree-graph.html      # Tree graph template
    playbooks/
      runner.ts              # Playbook execution engine
      parser.ts              # Playbook markdown parser
    watchers/
      daemon.ts              # Watch polling daemon
      scheduler.ts           # Interval management
  skills/                    # Claude Code skills (installed to ~/.claude/skills/)
    ci-open-case/
      SKILL.md
    ci-trace-funds/
      SKILL.md
    ci-risk-check/
      SKILL.md
    ci-visualize/
      SKILL.md
    ci-watch/
      SKILL.md
    ci-dossier/
      SKILL.md
    ci-mcp-schema/
      SKILL.md
    ci-fast/
      SKILL.md
    ci-status/
      SKILL.md
  playbooks/                 # Built-in playbook definitions
    trace-funds.md
    risk-check.md
    entity-profile.md
    sanctions-screen.md
  hooks/                     # Claude Code hooks
    ci-evidence-guard.js     # Prevent accidental evidence deletion
    ci-cost-warning.js       # Warn when MCP spend exceeds threshold
  tests/
    ...
```

## Suggested Build Order (Dependencies)

The components have clear dependency relationships that dictate build order:

```
Phase 1: Foundation
  src/core/config.ts           (everything depends on config)
  src/db/connection.ts         (DuckDB setup)
  src/db/schema.ts             (table creation)
  bin/cli.js                   (minimal CLI scaffold)
  bin/install.js               (skill installation)
  package.json                 (npm distribution)

Phase 2: Case Management
  src/core/case-manager.ts     (depends on: config, db)
  src/core/evidence-store.ts   (depends on: config, case-manager)
  src/core/dossier-store.ts    (depends on: config, case-manager)
  skills/ci-open-case/         (depends on: case-manager)
  skills/ci-status/            (depends on: case-manager)

Phase 3: MCP Integration
  src/mcp/client.ts            (depends on: config, db/query-cache)
  src/db/query-cache.ts        (depends on: db/connection)
  src/mcp/cost-tracker.ts      (depends on: db, mcp/client)
  skills/ci-fast/              (depends on: mcp/client)
  skills/ci-mcp-schema/        (depends on: mcp/client)

Phase 4: Playbooks + Evidence
  src/playbooks/parser.ts      (depends on: nothing, pure parsing)
  src/playbooks/runner.ts      (depends on: mcp/client, case-manager, evidence-store)
  skills/ci-trace-funds/       (depends on: playbook-runner)
  skills/ci-risk-check/        (depends on: playbook-runner)

Phase 5: Visualization
  src/server/index.ts          (depends on: config, db)
  src/viz/money-flow.ts        (depends on: db, D3.js templates)
  src/server/routes/graph.ts   (depends on: server, viz)
  skills/ci-visualize/         (depends on: server, viz)

Phase 6: Watchers
  src/watchers/scheduler.ts    (depends on: config)
  src/watchers/daemon.ts       (depends on: mcp/client, db, case-manager)
  skills/ci-watch/             (depends on: watcher daemon)

Phase 7: Multi-Runtime + Polish
  bin/install.js               (Codex, Open Claw runtime support)
  hooks/                       (evidence guard, cost warning)
  Additional playbooks
```

**Why this order:**
1. **Foundation first:** Config and DB are universal dependencies. Without them, nothing runs.
2. **Case management before MCP:** Investigators need to set up case structure before querying. This can be tested without a live MCP connection.
3. **MCP after case management:** x402 integration requires wallet setup and a running MCP server. Deferring this keeps early phases testable without external dependencies.
4. **Playbooks after MCP:** Playbooks orchestrate MCP calls within case context. Both must exist first.
5. **Visualization after playbooks:** Visualizations render data from playbook results. The data pipeline must exist.
6. **Watchers last:** Watchers are background processes that depend on everything else. They are a differentiator, not table stakes for initial release.
7. **Multi-runtime last:** Claude Code is the primary runtime. Other runtimes add installer complexity but no core functionality.

## Scalability Considerations

| Concern | Single Investigator | Team (5-10) | Enterprise |
|---------|-------------------|-------------|------------|
| Data storage | Single DuckDB file + flat files | Git-tracked flat files, separate DuckDB per investigator | Out of scope (would need shared DB) |
| MCP costs | Per-investigator wallet | Per-investigator wallet, shared cache potential | Cost allocation, budget management |
| Visualization | Single-page HTML | Same (each opens own browser) | Would need shared server |
| Case collaboration | Git branching on case directory | Same, with merge conventions | Case locking, RBAC |

Chain Insights v1 targets single investigator use. Team collaboration is achievable through git (flat files are git-trackable by design). Enterprise features (shared DB, RBAC, cost allocation) are explicitly out of scope.

## Sources

- GSD reference implementation: `/home/aphex5/work/chain-insights/references/get-shit-done/` (directly inspected) -- HIGH confidence
- Claude Code Skills documentation: https://code.claude.com/docs/en/skills -- HIGH confidence
- DuckDB Node.js Neo API: https://duckdb.org/docs/current/clients/node_neo/overview.html -- HIGH confidence
- x402 Protocol: https://github.com/coinbase/x402 and https://docs.cdp.coinbase.com/x402/quickstart-for-buyers -- HIGH confidence
- x402 npm packages: `@x402/fetch`, `@x402/evm`, `@x402/core` -- HIGH confidence
- Fastify with @fastify/static: https://github.com/fastify/fastify-static -- HIGH confidence
- D3.js force-directed graphs: https://d3js.org/d3-force -- MEDIUM confidence (rbmk viz code reuse unverified)
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk -- HIGH confidence
