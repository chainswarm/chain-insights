# Phase 2: MCP Connection & Payments - Context

**Gathered:** 2026-05-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Investigator can query the Chain Insights MCP through their AI agent, paying per-call via x402 micropayments, and discover what tools the MCP offers. The primary interface is a local MCP proxy server that Claude Code/Desktop connects to natively — the agent calls MCP tools directly, and the proxy handles x402 payment transparently.

</domain>

<decisions>
## Implementation Decisions

### Wallet Configuration & Key Management
- Wallet configured via `chain-insights config set walletPrivateKey <key>`, stored encrypted in `.chain-insights/wallet.json`
- Encryption: AES-256-GCM with machine-derived key (hostname + user) — zero password prompt, revocable by deleting file
- Base chain only for x402 payments (primary x402 chain, lowest fees, Coinbase ecosystem)
- Missing wallet: graceful degradation — attempt call, show clear error "Wallet not configured. Run `chain-insights config set walletPrivateKey <key>` to enable paid MCP calls"

### x402 Payment UX & MCP Connection
- x402 only — all MCP calls go through public x402-gated endpoint. Bearer token auth is M2M, out of scope for this toolkit. Wallet must be configured for any MCP calls.
- Payment logging via Pino (structured JSON) — silent by default, visible with `--verbose` or in logs
- No spending limits in v1 — x402 amounts are micro (< $0.01 per call). Spending controls deferred to v2 (MCPOPT-02)
- Per-request with `@x402/fetch` wrapper — stateless, simple, matches REST MCP pattern

### MCP Schema Discovery
- Fetch MCP tool list via standard MCP `tools/list` endpoint at connection time, cache in memory
- Tool listing: structured table (name, description, required params, cost) for CLI; schema passed through for agent
- Cache schema in `.chain-insights/mcp-schema.json` with 24h TTL. Refresh via `chain-insights mcp tools --refresh`
- Unreachable MCP: clear error with endpoint URL, non-zero exit code, no retry loop

### Agent Interface
- Primary interface: local MCP proxy server registered in Claude Code config by the installer. Agent calls MCP tools natively via stdio MCP protocol.
- No NL translation needed — Claude Code maps natural language to MCP tools via schema descriptions. The tool schema IS the interface.
- CLI commands (`chain-insights mcp tools`, `chain-insights mcp call`) are secondary debugging tools, not the main interface.
- MCP proxy surfaces x402 payment errors and query errors as MCP error responses to the agent.

### Claude's Discretion
- MCP proxy implementation details (stdio transport, tool forwarding, schema caching internals)
- Error message formatting and verbosity levels
- Test strategy for x402 payment flow (mock vs integration)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/config/schema.ts` — Config schema with `mcpEndpoint`, `mcpAuthToken`, `walletAddress` fields already defined
- `src/config/index.ts` — Config load/save functions
- `src/cli.ts` — Commander CLI with config get/set commands, serve command, status command
- `src/server/` — Hono server with localhost binding
- `src/db/` — DuckDB health check
- `bin/install.cjs` — Installer that registers Claude Code skills

### Established Patterns
- Zod for schema validation (config schema pattern)
- Commander.js for CLI subcommands
- ESM with tsdown build
- Hono for HTTP server (localhost-only)
- Lazy imports in CLI action handlers

### Integration Points
- Config schema needs `walletPrivateKey` field (encrypted storage) — extends existing schema
- Installer needs MCP server config registration (extends existing `--claude` installer)
- CLI needs `mcp` subcommand group (tools, call)
- MCP proxy server as separate entry point (stdio, not HTTP)

### External Dependencies
- MCP uses proxy from rbmk infra repo
- Chain Insights MCP is an HTTP API with x402 payment gate
- `@modelcontextprotocol/sdk` for MCP server implementation
- `@x402/fetch` + `@x402/evm` for payment handling
- `viem` for wallet/signing

</code_context>

<specifics>
## Specific Ideas

- MCP proxy pattern: local stdio MCP server that forwards to remote HTTP MCP with x402 payment handling
- Installer should register MCP proxy in Claude Code's MCP config (not just skills)
- Look at rbmk infra repo for existing MCP proxy code that could be referenced/reused
- The MCP tool schema from the remote endpoint defines the investigation capabilities — no need to duplicate or abstract

</specifics>

<deferred>
## Deferred Ideas

- Query caching / cache-before-pay pattern (v2 — MCPOPT-01)
- Cost tracking per case (v2 — MCPOPT-02)
- Multi-chain x402 support beyond Base (v2)
- Spending limits and confirmation dialogs (v2)
- Bearer token auth mode for M2M use cases (out of scope — handled by other agents)

</deferred>
