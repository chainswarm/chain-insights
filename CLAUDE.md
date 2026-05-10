<!-- GSD:project-start source:PROJECT.md -->
## Project

**Chain Insights AML Toolkit**

An open-source agent framework for blockchain AML investigations. Like GSD is for software development, Chain Insights is for crypto compliance — it gives AI coding agents (Claude Code, Codex, Open Claw) the skills, state management, and tooling to run professional AML investigations. Investigators open cases, build dossiers, monitor wallets, run playbooks, and visualize money flows — all through their AI agent of choice, powered by the Chain Insights MCP via x402 micropayments.

**Core Value:** An investigator can install the toolkit, connect to the Chain Insights MCP, and run a complete investigation — from querying on-chain data to producing a money flow visualization — entirely through their AI agent.

### Constraints

- **Distribution**: npm package, global install via npx — no Docker, no Python, no system deps beyond Node.js 22+
- **Storage**: DuckDB (embedded, analytical, Parquet-native) + flat markdown/JSON files for case state
- **Payment**: x402 protocol for MCP micropayments — requires local EVM wallet
- **Privacy**: Framework code is public, but investigation data stays local. No telemetry, no cloud sync.
- **MCP access**: Currently private/localhost MCP; will transition to public x402-gated endpoint
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Language & Runtime
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| TypeScript | 6.0.x | Primary language | Type safety for complex investigation data models, npm distribution alignment, x402/viem ecosystem is TypeScript-first, GSD reference architecture uses TS. v6.0 is the current stable (final JS-based compiler before Go-native 7.0). | HIGH |
| Node.js | >= 22.0.0 | Runtime | Required by GSD reference (engines field), LTS support, native ESM, required by Commander 14.x. | HIGH |
### Distribution & CLI
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| npm | (bundled) | Package distribution | GSD-style `npx chain-insights` global install. Proven model from GSD reference. npm bin entry points for CLI commands. | HIGH |
| Commander.js | 14.0.x | CLI framework | 132K+ dependents, complete CLI solution (subcommands, options, help generation). GSD uses a custom CLI but for a new project Commander is the pragmatic choice -- less custom code, faster to ship. Requires Node >= 20. | HIGH |
### Build & Tooling
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| tsdown | 0.20.x | Library bundler | Successor to tsup (which is no longer actively maintained). Powered by Rolldown (Rust-based, Vite's bundler). 3-5x faster than tsup. Outputs ESM + CJS + `.d.ts` in one pass. tsup is deprecated -- new projects should use tsdown. | MEDIUM |
| tsx | 4.21.x | Dev-time TS execution | Run TypeScript directly without compile step during development. Zero-config, esbuild-powered, drop-in `node` replacement. | HIGH |
| Vitest | 4.1.x | Test runner | Jest-compatible API, native ESM/TS support, fast watch mode. GSD reference uses Vitest. The built-in Node test runner lacks snapshot testing and DX polish needed for a project of this complexity. | HIGH |
### Local Server
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Fastify | 5.8.x | HTTP server | Serves D3 visualizations from local server, handles x402 payment middleware. Fastify over Express because: (1) @x402/fastify middleware exists and is officially supported, (2) built-in schema validation via JSON Schema, (3) built-in Pino logging, (4) 2-3x faster than Express, (5) plugin architecture aligns with modular toolkit design. | HIGH |
| Pino | 10.3.x | Logging | Ships with Fastify (built-in). Structured JSON logging, zero-overhead in production. No additional dependency needed -- Fastify({ logger: true }) enables it. | HIGH |
### Embedded Database
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| @duckdb/node-api | 1.5.x | Analytical database | The "Neo" client is the current DuckDB Node.js API (replaces old `duckdb` package). Embedded, no server process, Parquet-native, columnar storage optimized for analytical queries (transaction tracing, aggregations over money flows). 20-50x faster than SQLite for analytical workloads. Aligns with PROJECT.md constraint: "no Docker, no system deps beyond Node.js." | HIGH |
### Graph Visualization
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| D3.js | 7.9.0 | Money flow visualization | Force-directed and tree graphs for transaction flows. Existing rbmk viz code uses D3 -- reuse, not rebuild. D3 v7 is the current stable. | HIGH |
| d3-force | 3.x | Force layout engine | Submodule of D3 for force-directed graph layouts (money flow networks). | HIGH |
| d3-hierarchy | 3.1.x | Tree layout engine | Submodule of D3 for tree/hierarchy layouts (transaction trees). | HIGH |
| jsdom | 29.1.x | Server-side DOM | Required to render D3 SVG on the server side (Node.js has no DOM). Creates a virtual document for D3 to render into, then serializes SVG. Known limitation: incomplete SVG spec support, but sufficient for force/tree graphs. | MEDIUM |
| open | 11.0.x | Browser launcher | Opens rendered HTML/SVG visualizations in the user's default browser. Cross-platform (macOS, Linux, Windows). | HIGH |
### Blockchain / EVM / Payments
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| viem | 2.x | EVM interaction | TypeScript-first Ethereum library. Required by x402 -- `privateKeyToAccount` from `viem/accounts` is used for wallet signing. 35kB tree-shakable bundle vs ethers.js monolith. Full type safety for ABI encoding. Used for local wallet management (signing x402 payment authorizations). | HIGH |
| @x402/fetch | 2.1.x | Payment client | Wraps native `fetch` to auto-handle HTTP 402 responses. When the Chain Insights MCP returns 402, this transparently signs a USDC payment and retries. Zero manual payment logic in application code. | HIGH |
| @x402/evm | 2.9.x | EVM payment scheme | Registers EVM signer with x402 client. Supports Base, Polygon, Arbitrum, World chains. Required by @x402/fetch for EVM payment flow. | HIGH |
| @x402/core | 2.x | Payment protocol core | Transport-agnostic x402 client/server/facilitator components. Dependency of @x402/fetch. | HIGH |
| @x402/fastify | 2.x | Server-side paywall | Optional -- only needed if this toolkit itself wants to expose x402-gated endpoints (future: expose local investigation results as paid API). Provides `paymentMiddleware` for Fastify routes. | MEDIUM |
### Schema Validation
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Zod | 4.4.x | Runtime validation | Validates investigation data models (case schemas, dossier structures, playbook definitions). TypeScript-first with static type inference -- define schema once, get both runtime validation and compile-time types. Zod 4 is a major rewrite with better performance. | HIGH |
### Agent Integration
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| @modelcontextprotocol/sdk | 1.29.x | MCP client/server | Official TypeScript MCP SDK. Used for: (1) consuming the Chain Insights MCP (query endpoints, probes), (2) potentially exposing toolkit capabilities as MCP tools for agents. 47K+ dependents, actively maintained. | HIGH |
### File-Based State (No Additional Dependencies)
| Component | Format | Purpose | Why |
|-----------|--------|---------|-----|
| Case state | Markdown + YAML frontmatter | Investigation tracking | Human-readable, AI-agent-friendly, git-trackable. Same pattern as GSD's `.planning/`. No dependency needed -- Node.js fs. |
| Dossiers | Markdown | Entity evidence files | Flat files investigators can read/edit directly. Agents can parse markdown natively. |
| Config | JSON or TOML | Toolkit configuration | `.chain-insights/config.json` -- wallet address, MCP endpoints, preferences. |
| Playbooks | Markdown + code blocks | Reusable workflows | Investigation recipes. Parsed at runtime, no template engine needed. |
## Alternatives Considered
| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Language | TypeScript | Python | npm distribution model, GSD architecture alignment, x402/viem/MCP SDKs are TypeScript-first. Python would mean pip distribution headaches and lose the GSD reference value. |
| Server | Fastify | Express | Express lacks built-in validation, logging, and TypeScript support. @x402/fastify exists as official middleware. Fastify's plugin architecture matches the modular toolkit design. |
| Server | Fastify | Hono | Hono is excellent but optimized for edge/Cloudflare Workers. This is a local-only server where Fastify's Node.js optimization and plugin ecosystem matter more. |
| Database | DuckDB | SQLite/better-sqlite3 | SQLite is row-oriented -- terrible for analytical queries (aggregations, window functions over transaction histories). DuckDB's columnar engine is built for this workload. |
| Database | DuckDB | PostgreSQL | Requires a separate server process. Violates the "no Docker, no system deps" constraint. |
| EVM Library | viem | ethers.js | ethers.js is mature but monolithic (larger bundle), weaker TypeScript support, and x402 SDK depends on viem's `privateKeyToAccount`. Using ethers alongside would mean two EVM libraries. |
| Bundler | tsdown | tsup | tsup is unmaintained (authors recommend tsdown). tsdown is 3-5x faster, same DX, actively developed by the Rolldown team. |
| Bundler | tsdown | tsc only | tsc alone does not bundle, does not produce CJS+ESM dual output, and does not handle path aliases. A bundler is needed for npm distribution. |
| Test Runner | Vitest | Jest | Jest has poor native ESM support, requires transforms for TypeScript, slower startup. Vitest is Jest-compatible but modern. GSD uses Vitest. |
| Test Runner | Vitest | node:test | Node built-in runner lacks snapshot testing, watch mode DX, and mocking quality needed for complex integration tests. Good for simple libs, insufficient here. |
| CLI Framework | Commander | Custom (GSD-style) | GSD rolls its own CLI via bin scripts. For a new project, Commander provides subcommands, help generation, and option parsing out of the box. Less custom code = faster to ship. |
| Validation | Zod | Ajv/JSON Schema | Zod provides both runtime validation and TypeScript type inference from a single schema definition. Ajv requires separate type definitions. Fastify uses JSON Schema internally, but Zod is better for application-level validation with `zod-to-json-schema` bridging if needed. |
| Viz Library | D3.js | vis.js / Cytoscape | Existing rbmk code uses D3. Cytoscape is heavier and optimized for graph databases. vis.js is less maintained. D3 gives maximum control over the visualization, which matters for custom AML-specific layouts. |
| Payment | x402 v2 | Custom payment | x402 is the Coinbase-backed standard, already adopted by 15M+ transactions. Rolling custom payment flow would be reinventing the wheel and losing ecosystem compatibility. |
## Installation
# Core dependencies
# Dev dependencies
### package.json Key Fields
## Version Pinning Strategy
- `"fastify": "^5.8.0"` -- Fastify 5.x is stable, semver-safe
- `"@duckdb/node-api": "^1.5.0"` -- DuckDB tracks engine releases, minor bumps are safe
- `"viem": "^2.0.0"` -- viem 2.x is stable, required by x402
- `"@x402/fetch": "^2.1.0"` -- x402 v2 is the current protocol version
- `"d3": "^7.9.0"` -- D3 v7 is mature, no v8 planned
- `"zod": "^4.4.0"` -- Zod 4 is a fresh major, pin to 4.x
## Architecture Alignment with GSD Reference
| GSD Pattern | Chain Insights Equivalent | Implementation |
|-------------|---------------------------|----------------|
| `bin/install.js` (CJS, runs with `node`) | `bin/cli.js` | Commander-based CLI entry point. CJS for universal `node` compat in bin scripts. |
| `sdk/` (TypeScript, ESM, built with tsc) | `src/` (TypeScript, ESM, built with tsdown) | Core framework logic. tsdown instead of tsc for dual CJS/ESM output. |
| `get-shit-done/` (prompts, agents, skills) | `playbooks/`, `skills/`, `hooks/` | Investigation workflows, Claude Code skills, pre/post hooks. |
| `.planning/` (state directory) | `.chain-insights/` (state directory) | Case files, dossiers, config, watch definitions. |
| `ws` dependency (WebSocket for Agent SDK) | `@modelcontextprotocol/sdk` | MCP client for consuming Chain Insights MCP. |
## Sources
- DuckDB Node Neo Client: https://duckdb.org/docs/current/clients/node_neo/overview (Context7 verified)
- Fastify v5: https://fastify.dev/ (Context7 verified, v5.8.5 current)
- viem: https://viem.sh/ (Context7 verified, v2.x current)
- x402 Protocol: https://docs.x402.org/getting-started/quickstart-for-sellers
- x402 Foundation: https://www.x402.org/
- @x402/fetch v2.1.0: https://www.npmjs.com/package/@x402/fetch
- @x402/evm v2.9.0: https://www.npmjs.com/package/@x402/evm
- @x402/fastify: https://docs.x402.org/getting-started/quickstart-for-sellers (Fastify example confirmed)
- D3.js v7.9.0: https://d3js.org/ (Context7 verified)
- jsdom v29.1.1: https://github.com/jsdom/jsdom
- Commander v14.0.3: https://github.com/tj/commander.js
- Zod v4.4.3: https://zod.dev/v4
- TypeScript 6.0: https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/
- tsdown v0.20.3: https://tsdown.dev/ (successor to tsup)
- tsx v4.21.0: https://tsx.is/
- Vitest v4.1.5: https://vitest.dev/
- @modelcontextprotocol/sdk v1.29.0: https://github.com/modelcontextprotocol/typescript-sdk
- GSD Reference: /home/aphex5/work/chain-insights/references/get-shit-done/package.json (local)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
