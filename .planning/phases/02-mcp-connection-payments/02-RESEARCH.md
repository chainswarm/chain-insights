# Phase 02: MCP Connection & Payments - Research

**Researched:** 2026-05-11
**Domain:** MCP proxy (stdio), x402 payment integration, viem wallet, AES-256-GCM encryption
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Wallet Configuration & Key Management**
- Wallet configured via `chain-insights config set walletPrivateKey <key>`, stored encrypted in `.chain-insights/wallet.json`
- Encryption: AES-256-GCM with machine-derived key (hostname + user) — zero password prompt, revocable by deleting file
- Base chain only for x402 payments (primary x402 chain, lowest fees, Coinbase ecosystem)
- Missing wallet: graceful degradation — attempt call, show clear error "Wallet not configured. Run `chain-insights config set walletPrivateKey <key>` to enable paid MCP calls"

**x402 Payment UX & MCP Connection**
- x402 only — all MCP calls go through public x402-gated endpoint. Bearer token auth is M2M, out of scope for this toolkit. Wallet must be configured for any MCP calls.
- Payment logging via Pino (structured JSON) — silent by default, visible with `--verbose` or in logs
- No spending limits in v1 — x402 amounts are micro (< $0.01 per call). Spending controls deferred to v2 (MCPOPT-02)
- Per-request with `@x402/fetch` wrapper — stateless, simple, matches REST MCP pattern

**MCP Schema Discovery**
- Fetch MCP tool list via standard MCP `tools/list` endpoint at connection time, cache in memory
- Tool listing: structured table (name, description, required params, cost) for CLI; schema passed through for agent
- Cache schema in `.chain-insights/mcp-schema.json` with 24h TTL. Refresh via `chain-insights mcp tools --refresh`
- Unreachable MCP: clear error with endpoint URL, non-zero exit code, no retry loop

**Agent Interface**
- Primary interface: local MCP proxy server registered in Claude Code config by the installer. Agent calls MCP tools natively via stdio MCP protocol.
- No NL translation needed — Claude Code maps natural language to MCP tools via schema descriptions. The tool schema IS the interface.
- CLI commands (`chain-insights mcp tools`, `chain-insights mcp call`) are secondary debugging tools, not the main interface.
- MCP proxy surfaces x402 payment errors and query errors as MCP error responses to the agent.

### Claude's Discretion
- MCP proxy implementation details (stdio transport, tool forwarding, schema caching internals)
- Error message formatting and verbosity levels
- Test strategy for x402 payment flow (mock vs integration)

### Deferred Ideas (OUT OF SCOPE)
- Query caching / cache-before-pay pattern (v2 — MCPOPT-01)
- Cost tracking per case (v2 — MCPOPT-02)
- Multi-chain x402 support beyond Base (v2)
- Spending limits and confirmation dialogs (v2)
- Bearer token auth mode for M2M use cases (out of scope — handled by other agents)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MCP-01 | x402 payment gateway integration (viem wallet + `@x402/fetch` for automatic 402 handling) | `wrapFetchWithPaymentFromConfig` with `ExactEvmScheme` on `eip155:8453` (Base). AES-256-GCM wallet storage via `node:crypto`. |
| MCP-02 | MCP schema discovery — agent can introspect available tools/endpoints from the Chain Insights MCP | Client calls remote HTTP MCP's `tools/list` via `StreamableHTTPClientTransport` + `@x402/fetch`. Schema cached as JSON with 24h TTL. Proxy re-registers tools via `server.registerTool()`. |
| MCP-03 | Free-form MCP query execution — user describes investigation intent in natural language, agent interprets into MCP calls | Achieved by the proxy exposing the remote tools natively to Claude Code via stdio. Claude Code maps NL intent to tool calls without any NL translation layer needed. |
</phase_requirements>

---

## Summary

Phase 2 introduces three tightly-coupled capabilities: wallet-backed x402 payment, remote MCP tool discovery, and a local stdio MCP proxy that bridges Claude Code to the remote Chain Insights HTTP MCP endpoint. These are distinct implementation modules but work as a single pipeline: (1) the proxy starts, (2) fetches the remote MCP schema via an x402-authenticated client, (3) re-registers each discovered tool locally, and (4) forwards each tool call to the remote HTTP endpoint with automatic payment handling.

The x402 integration uses `@x402/fetch` v2.11.0's `wrapFetchWithPaymentFromConfig` convenience API with `ExactEvmScheme` pinned to `eip155:8453` (Base Mainnet). The private key is stored encrypted in `~/.chain-insights/wallet.json` using `node:crypto`'s AES-256-GCM with a machine-derived key — no external dependency required. The MCP SDK (`@modelcontextprotocol/sdk` v1.29.0) provides `McpServer` + `StdioServerTransport` for the local proxy and `Client` + `StreamableHTTPClientTransport` for connecting to the remote HTTP MCP.

The installer must be extended to register the local proxy in Claude Code's `~/.claude.json` `mcpServers` config, which the `claude mcp add` CLI can do with `--scope user`. The new `mcp proxy` entry point must be added to `tsdown.config.ts` as a separate binary so the proxy runs as a standalone process that Claude Code can spawn.

**Primary recommendation:** Implement three focused modules — `src/wallet/` (AES-256-GCM encryption), `src/mcp/client.ts` (x402-wrapped HTTP MCP client), and `src/mcp/proxy.ts` (stdio MCP server) — then wire together in the installer and new `mcp` CLI subcommand.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| x402 payment signing | API / Backend (local proxy process) | — | Private key must never be exposed to the agent; payment must happen in the trusted local process |
| Wallet encryption/decryption | Local File System | — | AES-256-GCM in `node:crypto`; wallet.json stored at `~/.chain-insights/wallet.json` with 0o600 permissions |
| MCP tool discovery (tools/list) | API / Backend (proxy startup) | CLI (debug) | Remote HTTP call via x402-authenticated fetch, cached locally as mcp-schema.json |
| MCP tool forwarding (call) | API / Backend (local proxy) | — | Proxy translates Claude Code's stdio MCP calls to remote HTTP MCP calls with payment |
| Claude Code MCP registration | OS / Config | — | Written to `~/.claude.json` by installer via `claude mcp add --scope user` |
| Schema cache management | Local File System | — | `~/.chain-insights/mcp-schema.json` with 24h TTL |
| CLI debugging tools (mcp tools, mcp call) | CLI | — | Secondary surface only; same client module used by proxy |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | 1.29.0 | stdio proxy server + HTTP client for remote MCP | Official SDK; provides `McpServer`, `StdioServerTransport`, `Client`, `StreamableHTTPClientTransport` |
| `@x402/fetch` | 2.11.0 | Wrap fetch with automatic 402 payment handling | `wrapFetchWithPaymentFromConfig` convenience API; EVM-chain-aware; depends on `@x402/core` |
| `@x402/evm` | 2.11.0 | EVM payment scheme for x402 (`ExactEvmScheme`) | Provides `ExactEvmScheme` for USDC transfers on Base; import from `@x402/evm` (root) |
| `viem` | 2.48.11 | EVM wallet — derive account from private key | `privateKeyToAccount` from `viem/accounts`; required by `ExactEvmScheme` constructor |
| `node:crypto` | built-in | AES-256-GCM encryption for private key storage | Zero dependencies; `scryptSync` for key derivation, `randomBytes` for IV |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@x402/core` | 2.11.0 | Transitive dependency of `@x402/fetch` | Do not import directly; `@x402/fetch` depends on it |
| `node:os` | built-in | Hostname + username for machine-derived key | Used only in wallet key derivation |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `wrapFetchWithPaymentFromConfig` | `wrapFetchWithPayment` + manual `x402Client` | Lower-level API; same outcome; `FromConfig` is cleaner for single-chain use |
| `ExactEvmScheme` import from `@x402/evm` | `@x402/evm/exact/client` subpath | Both work; root export is simpler and equivalent per README |
| `StreamableHTTPClientTransport` | `SSEClientTransport` | Use SSE fallback only if remote doesn't support streamable HTTP |
| `node:crypto` AES-256-GCM | `libsodium`, `keytar` | `node:crypto` is sufficient; no extra dependencies; keytar requires native module |

**Installation** (new dependencies to add to package.json):
```bash
npm install @modelcontextprotocol/sdk @x402/fetch @x402/evm viem
```

**Version verification** (confirmed against npm registry 2026-05-11):
- `@modelcontextprotocol/sdk`: 1.29.0 [VERIFIED: npm registry]
- `@x402/fetch`: 2.11.0 [VERIFIED: npm registry]
- `@x402/evm`: 2.11.0 [VERIFIED: npm registry]
- `viem`: 2.48.11 [VERIFIED: npm registry]

---

## Architecture Patterns

### System Architecture Diagram

```
Claude Code (agent)
      |
      | stdio (MCP protocol)
      v
 [chain-insights MCP proxy — local process]
      |-- startup: fetch tools/list from remote ---> [Chain Insights HTTP MCP]
      |                                                        ^ 402 gate
      |-- per tool call: forward + pay -------------------->  |
      |     wrapFetchWithPaymentFromConfig                     |
      |     ExactEvmScheme (Base/USDC)                         |
      |     privateKeyToAccount (viem)  <-- decrypt key        |
      |                                    wallet.json         |
      |                                    AES-256-GCM         |
      |                                    (node:crypto)       |
      |
      |-- schema cache (.chain-insights/mcp-schema.json, 24h TTL)
      |
      v
 [error/result] returned as MCP response content to Claude Code
```

### Recommended Project Structure

```
src/
├── wallet/
│   ├── index.ts          # encryptKey(), decryptKey(), isWalletConfigured()
│   └── index.test.ts     # (in tests/ by project convention)
├── mcp/
│   ├── client.ts         # createMcpHttpClient(endpoint, account) → x402-wrapped fetch client
│   ├── proxy.ts          # stdio MCP proxy entry point
│   ├── schema-cache.ts   # loadSchema(), saveSchema() with 24h TTL logic
│   └── format.ts         # formatToolsTable() for CLI output
├── cli.ts                # extend with `mcp` subcommand group
└── index.ts              # extend exports

bin/
├── cli.js                # existing
├── install.cjs           # extend to register MCP proxy in Claude Code
└── mcp-proxy.cjs         # new: CJS shim for stdio proxy entry point

tsdown.config.ts          # add 'mcp-proxy': 'src/mcp/proxy.ts' entry

tests/
├── wallet.test.ts        # MCP-01: encrypt/decrypt round-trip, missing wallet error
├── mcp-schema-cache.test.ts  # MCP-02: TTL logic, cache write/read
├── mcp-proxy.test.ts     # MCP-03: proxy forwarding with mocked remote (integration)
└── installer.test.ts     # extend: verify mcp-proxy registered in claude.json
```

### Pattern 1: x402 Payment-Wrapped Fetch Client

**What:** Create a fetch function that auto-pays 402 responses via USDC on Base.
**When to use:** Every HTTP call to the remote MCP endpoint.

```typescript
// Source: @x402/fetch README (VERIFIED: npm package download 2026-05-11)
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

export function createMcpFetchClient(privateKey: `0x${string}`) {
  const account = privateKeyToAccount(privateKey);
  return wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [
      {
        network: "eip155:8453", // Base Mainnet
        client: new ExactEvmScheme(account),
      },
    ],
  });
}
```

### Pattern 2: stdio MCP Proxy with Dynamic Tool Registration

**What:** A local `McpServer` that discovers tools from the remote HTTP MCP on startup, then forwards each call through the x402-wrapped fetch client.
**When to use:** Main `bin/mcp-proxy.cjs` entry point, spawned by Claude Code.

```typescript
// Source: @modelcontextprotocol/sdk README (VERIFIED: Context7 /modelcontextprotocol/typescript-sdk)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import * as z from "zod";

const server = new McpServer(
  { name: "chain-insights-proxy", version: "0.1.0" },
  { instructions: "Chain Insights AML investigation tools. Pay-per-call via x402." }
);

// Connect to remote MCP using x402-wrapped fetch
const remoteClient = new Client({ name: "chain-insights-proxy-client", version: "0.1.0" });
await remoteClient.connect(new StreamableHTTPClientTransport(new URL(endpoint)));

// Discover and re-register tools
const { tools } = await remoteClient.listTools();
for (const tool of tools) {
  server.registerTool(
    tool.name,
    {
      description: tool.description ?? "",
      // Pass raw JSON schema through — no Zod required for proxy pattern
      inputSchema: z.object({}).passthrough(),
    },
    async (args) => {
      const result = await remoteClient.callTool({ name: tool.name, arguments: args });
      if (result.isError) {
        return { content: result.content, isError: true };
      }
      return { content: result.content };
    }
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Note on Zod passthrough:** The remote MCP returns JSON Schema, not Zod schemas. For a transparent proxy, accept any input and let the remote endpoint validate. The planner should decide between: (a) passing `z.object({}).passthrough()`, (b) converting JSON Schema to Zod via `zod-from-json-schema`, or (c) using the lower-level `Server` class with `setRequestHandler` for full schema pass-through. Option (a) is simplest and sufficient for v1.

### Pattern 3: AES-256-GCM Wallet Encryption

**What:** Encrypt the private key on disk using a machine-derived key (no password required).
**When to use:** `chain-insights config set walletPrivateKey <key>` command.

```typescript
// Source: Node.js built-in crypto module (VERIFIED: local test 2026-05-11)
import crypto from "node:crypto";
import os from "node:os";

function deriveKey(): Buffer {
  const passphrase = `${os.hostname()}:${os.userInfo().username}`;
  return crypto.scryptSync(passphrase, "chain-insights-wallet-v1", 32);
}

export function encryptKey(privateKey: string): { iv: string; tag: string; data: string } {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    data: encrypted.toString("hex"),
  };
}

export function decryptKey(stored: { iv: string; tag: string; data: string }): string {
  const key = deriveKey();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm", key,
    Buffer.from(stored.iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(stored.tag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(stored.data, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
```

**Security notes:**
- `wallet.json` must be written with `0o600` permissions (same as `config.json`).
- `scryptSync` is CPU-intensive by design. `N=16384, r=8, p=1` is the default — acceptable for single-call, not in a hot path.
- AES-256-GCM provides both confidentiality and authentication (tag verifies ciphertext not tampered).
- Machine-derived key means the encrypted file is not portable between machines — an investigator who changes hostname/username loses access. This is by design (revocable by deleting wallet.json).

### Pattern 4: Claude Code MCP Registration via Installer

**What:** Register the local proxy in Claude Code's user-scoped MCP config during `npx chain-insights --claude`.
**When to use:** `bin/install.cjs` — extend existing installer.

```javascript
// Source: claude mcp add --help (VERIFIED: local CLI 2026-05-11)
// Claude Code stores user-scoped MCP servers in ~/.claude.json under projects/<path>/mcpServers

// Option A: Use claude CLI (recommended — future-proof against config format changes)
const { execSync } = require('child_process');
execSync(
  `claude mcp add chain-insights-proxy --scope user -- node ${proxyBinPath}`,
  { stdio: 'pipe' }
);

// Option B: Direct JSON edit of ~/.claude.json (fallback if claude CLI not found)
// Structure in ~/.claude.json:
// { "projects": { "/path/to/project": { "mcpServers": { "chain-insights-proxy": { "command": "node", "args": [proxyBinPath] } } } } }
// OR user-scoped (not project-scoped):
// In the root mcpServers key (not per-project).
```

**Critical implementation detail:** Inspection of `~/.claude.json` shows `mcpServers` at the project level (`projects["<path>"]["mcpServers"]`). User-scoped servers (available across all projects) are registered by `claude mcp add --scope user`. The installer should prefer `claude mcp add --scope user` via the CLI (Option A) so the proxy works from any working directory. The CJS installer must detect if the `claude` CLI is on PATH and gracefully skip this step with a printed instruction if not.

### Pattern 5: tsdown Entry Point Extension

**What:** Add `mcp-proxy` as a separate bundle entry so it can be invoked as a standalone process.
**When to use:** `tsdown.config.ts` extension.

```typescript
// Source: existing tsdown.config.ts (VERIFIED: codebase)
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    index: 'src/index.ts',
    'mcp-proxy': 'src/mcp/proxy.ts',  // new — stdio proxy entry point
  },
  format: ['esm', 'cjs'],
  platform: 'node',
  dts: true,
  clean: true,
  shims: true,
})
```

### Anti-Patterns to Avoid

- **Importing `@x402/core` directly:** Use `@x402/fetch` APIs only. `@x402/core` is a transitive dependency and its internals may change.
- **Storing raw private keys in `config.json`:** Private keys go in `wallet.json` (encrypted, separate from config). `config.json` stores `walletAddress` only.
- **Adding the remote MCP endpoint as a bearer-auth dependency:** The CONTEXT.md decision explicitly removes bearer token auth — all access is x402-only.
- **Making stdio proxy process long-lived beyond the Claude Code session:** Claude Code spawns and manages the proxy process via stdio; no daemonization needed.
- **Blocking the proxy startup on schema cache miss:** Startup fetch should have a timeout. If the remote is unreachable, exit with a clear error to stderr (Claude Code will surface this to the user).
- **Using `z.object({}).passthrough()` with `strict()` enabled globally:** Zod 4 with strict mode will reject unknown keys. The proxy must use `z.object({}).passthrough()` or `.loose()` to avoid discarding valid tool arguments.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP 402 detection + payment retry | Manual fetch wrapper with 402 check | `wrapFetchWithPaymentFromConfig` from `@x402/fetch` | Handles payment header format, EIP-3009 signing, retry logic, network selection |
| EIP-3009 USDC transfer authorization | Custom EVM signing | `ExactEvmScheme` from `@x402/evm` | EIP-3009 has domain separator, nonce, validity window — complex to get right |
| MCP protocol framing (JSON-RPC over stdio) | Raw stdin/stdout | `StdioServerTransport` + `McpServer` | MCP has initialization handshake, capability negotiation, error codes |
| Private key to EVM account | Custom secp256k1 | `privateKeyToAccount` from `viem/accounts` | Uses audited `@noble/curves` secp256k1 |
| Symmetric encryption | Custom XOR/RC4 | `crypto.createCipheriv('aes-256-gcm', ...)` from `node:crypto` | AES-256-GCM is authenticated — detects tampering. Manual crypto is dangerous. |

**Key insight:** Every item in this list involves cryptographic operations or protocol framing with non-obvious edge cases. The ecosystem provides well-audited implementations for all of them.

---

## Common Pitfalls

### Pitfall 1: stdio Proxy Writes to stdout and Breaks MCP Protocol
**What goes wrong:** Any `console.log()` in the proxy process writes to stdout, corrupting the JSON-RPC framing that Claude Code reads.
**Why it happens:** MCP stdio transport uses stdout exclusively for protocol messages.
**How to avoid:** Use `console.error()` for all debug output in proxy code. Set up logging to stderr only. The MCP SDK itself writes errors to stderr.
**Warning signs:** Claude Code reports "malformed MCP response" or proxy disconnects immediately.

### Pitfall 2: AES-256-GCM Auth Tag Not Stored or Verified
**What goes wrong:** `cipher.getAuthTag()` must be called AFTER `cipher.final()` and stored alongside the ciphertext. If not verified on decrypt, tampering is undetected.
**Why it happens:** Developers unfamiliar with AEAD modes forget the auth tag step.
**How to avoid:** Always store `{ iv, tag, data }` and always call `decipher.setAuthTag(tag)` before `decipher.update()`.
**Warning signs:** Decryption succeeds even when the ciphertext is modified (means tag verification is missing).

### Pitfall 3: `tools/list` Returns JSON Schema but Proxy Tries Zod Parsing
**What goes wrong:** Remote MCP returns `inputSchema` as a JSON Schema object. Trying to reconstruct Zod from it fails or strips the schema.
**Why it happens:** `McpServer.registerTool()` expects a Zod schema for `inputSchema`, but the remote provides raw JSON Schema.
**How to avoid:** Use `z.object({}).passthrough()` in the proxy — this accepts any input and passes it through to the remote endpoint, which does the real validation.
**Warning signs:** Tool calls fail with "unexpected keys" errors in Zod validation.

### Pitfall 4: `@x402/fetch` zod Version Mismatch
**What goes wrong:** `@x402/fetch` depends on `zod: "^3.24.2"` (Zod 3), but the project uses Zod 4 (`"^4.4.3"`). npm may install both versions, causing type incompatibilities.
**Why it happens:** Zod 4 is a breaking major version — `@x402/fetch` has not migrated yet.
**How to avoid:** Check for dual Zod versions after install (`npm ls zod`). The packages will both work at runtime (they use Zod internally for their own validation only). Type-level conflicts only appear if sharing Zod schemas across the boundary, which the proxy pattern avoids.
**Warning signs:** `npm install` warnings about peer dependency conflicts; TypeScript errors involving `ZodSchema` from `@x402/fetch` types.

### Pitfall 5: Machine-Derived Key Changes Break Wallet Access
**What goes wrong:** After hostname or username changes (e.g., VM rename, new machine), the derived key is different and decryption fails.
**Why it happens:** `scryptSync(hostname + username, ...)` is deterministic per machine identity.
**How to avoid:** Document this limitation clearly in error messages: "Wallet decryption failed. If you changed your hostname or username, re-configure with `chain-insights config set walletPrivateKey <key>`."
**Warning signs:** `Error: Unsupported state or unable to authenticate data` from Node.js crypto (GCM auth tag failure).

### Pitfall 6: Claude Code mcpServers Registration Scope
**What goes wrong:** Registering the proxy with `--scope local` (the default) makes it available only in the current project directory. The proxy should be `--scope user` so it works in any case directory.
**Why it happens:** `claude mcp add` defaults to `--scope local`.
**How to avoid:** Always use `claude mcp add chain-insights-proxy --scope user -- node <path>`.
**Warning signs:** Proxy works in chain-insights directory but not in investigation case directories.

### Pitfall 7: Proxy Binary Path Hardcodes Development Path
**What goes wrong:** Installer writes the development path (e.g., `/home/user/work/chain-insights/dist/mcp-proxy.mjs`) which breaks for other users.
**Why it happens:** Using `process.cwd()` or relative paths in the installer.
**How to avoid:** Use `require.resolve` or the npm-global install path. When installed globally via `npx`, the proxy lives at the npm global package path. Use `node.execPath` and the resolved dist path relative to the installer's `__dirname`.
**Warning signs:** Proxy "command not found" errors in Claude Code after install on a different machine.

---

## Code Examples

### Verified: Full x402 Fetch Client Setup (Base Mainnet)

```typescript
// Source: @x402/fetch README (VERIFIED: npm package contents 2026-05-11)
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

export function createPaymentFetch(privateKey: `0x${string}`) {
  const account = privateKeyToAccount(privateKey);
  return wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [
      {
        network: "eip155:8453", // Base Mainnet
        client: new ExactEvmScheme(account),
      },
    ],
  });
}
```

### Verified: McpServer Tool Registration with Error Response

```typescript
// Source: @modelcontextprotocol/sdk docs (VERIFIED: Context7 /modelcontextprotocol/typescript-sdk)
server.registerTool(
  tool.name,
  { description: tool.description ?? tool.name, inputSchema: z.object({}).passthrough() },
  async (args) => {
    try {
      const result = await remoteClient.callTool({ name: tool.name, arguments: args as Record<string, unknown> });
      return { content: result.content as Array<{ type: 'text'; text: string }>, isError: result.isError };
    } catch (err) {
      // Surface payment failures and network errors as MCP error responses
      return {
        content: [{ type: 'text' as const, text: `MCP call failed: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);
```

### Verified: StdioServerTransport Connection

```typescript
// Source: @modelcontextprotocol/sdk server quickstart (VERIFIED: Context7)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "chain-insights-proxy", version: "0.1.0" });
// ... register tools ...
const transport = new StdioServerTransport();
await server.connect(transport);
// Note: after connect(), do not write to stdout
```

### Verified: StreamableHTTPClientTransport to Remote MCP

```typescript
// Source: @modelcontextprotocol/sdk docs (VERIFIED: Context7)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "chain-insights-http-client", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(mcpEndpoint)));
const { tools } = await client.listTools();
```

### Verified: Claude Code MCP Registration (CLI method)

```bash
# Source: claude mcp add --help (VERIFIED: local CLI 2026-05-11)
# Register stdio proxy as user-scoped MCP server
claude mcp add chain-insights-proxy --scope user -- node /path/to/dist/mcp-proxy.mjs

# Result in ~/.claude.json projects[<user-scope>].mcpServers:
# {
#   "chain-insights-proxy": {
#     "command": "node",
#     "args": ["/path/to/dist/mcp-proxy.mjs"]
#   }
# }
```

### Verified: node:crypto AES-256-GCM Round-Trip

```typescript
// Source: Node.js built-in (VERIFIED: local execution 2026-05-11)
import crypto from "node:crypto";
import os from "node:os";

const SALT = "chain-insights-wallet-v1";

function deriveKey(): Buffer {
  return crypto.scryptSync(`${os.hostname()}:${os.userInfo().username}`, SALT, 32);
}

// Encrypt: returns { iv, tag, data } — all hex-encoded
// Decrypt: pass the stored object back, returns original string
// File: ~/.chain-insights/wallet.json, permissions 0o600
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@x402/fetch` `wrapFetchWithPayment` + manual `x402Client` | `wrapFetchWithPaymentFromConfig` convenience API | v2.x | Simpler setup; handles multi-scheme registration |
| `ExactEvmScheme` from `@x402/evm/exact/client` | `ExactEvmScheme` from `@x402/evm` (root) | v2.x | Root re-exports exact client; both paths work |
| `server.tool()` (McpServer) | `server.registerTool()` | SDK v2 migration | `server.tool()` removed; `registerTool` requires config object with `inputSchema` |
| `McpServer` from `@modelcontextprotocol/sdk` | `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js` | Current | Subpath import is more explicit and tree-shakable |

**Deprecated/outdated:**
- `server.tool()` variadic overload: removed in SDK v2, replaced by `server.registerTool(name, config, handler)`.
- `@x402/fetch` `x402Client` + `registerExactEvmScheme` pattern: still works but `wrapFetchWithPaymentFromConfig` is the simpler idiomatic API per current README.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The Chain Insights HTTP MCP endpoint supports `StreamableHTTPClientTransport` (not SSE-only) | Architecture Patterns | If SSE-only, use `SSEClientTransport` from `@modelcontextprotocol/sdk/client/sse.js` instead |
| A2 | The remote MCP endpoint follows the standard `tools/list` MCP protocol | Architecture Patterns | If proprietary HTTP API (not MCP), the proxy pattern changes entirely — may need direct HTTP client |
| A3 | Claude Code registers user-scoped MCP servers under the root `mcpServers` key (not per-project) | Pattern 4 | If user-scoped storage differs, installer must adjust JSON path |
| A4 | `npm ls zod` will show both zod 3 and zod 4 after install; this does not cause runtime failures | Pitfall 4 | If npm deduplication causes conflict, may need `overrides` in package.json |

---

## Open Questions

1. **Remote MCP transport type**
   - What we know: The Chain Insights MCP is described as "an HTTP API." Streamable HTTP is the modern MCP transport.
   - What's unclear: Whether it exposes MCP's streamable HTTP endpoint or only SSE.
   - Recommendation: Default to `StreamableHTTPClientTransport` with a fallback to `SSEClientTransport` if the connection fails. This matches the SDK's own recommendation pattern.

2. **Proxy binary path when globally installed via npx**
   - What we know: The installer writes the proxy path into `~/.claude.json`. The path must be absolute and stable after global install.
   - What's unclear: The exact npm global bin path layout when installed via `npx chain-insights --claude`.
   - Recommendation: In `install.cjs`, resolve the proxy path as `path.resolve(__dirname, '..', 'dist', 'mcp-proxy.mjs')`. When globally installed, `__dirname` resolves to the npm global package directory. Test this during Wave 0.

3. **Schema cache invalidation on MCP version bump**
   - What we know: The 24h TTL handles staleness. There is no explicit versioning in the cache format.
   - What's unclear: Whether the remote MCP will return a version field that could force invalidation.
   - Recommendation: Cache structure should include a `cachedAt` timestamp and optionally a `serverVersion` field. Keep it simple for v1.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | v24.13.1 | — |
| npm | Package install | Yes | 11.13.0 | — |
| claude CLI | Installer MCP registration | Yes | 2.1.138 | Print manual instruction to user |
| viem (npm) | x402 payment signing | Not installed yet | 2.48.11 (latest) | — install step |
| @x402/fetch (npm) | Payment wrapper | Not installed yet | 2.11.0 (latest) | — install step |
| @x402/evm (npm) | EVM payment scheme | Not installed yet | 2.11.0 (latest) | — install step |
| @modelcontextprotocol/sdk (npm) | MCP proxy + client | Not installed yet | 1.29.0 (latest) | — install step |
| node:crypto | AES-256-GCM encryption | Yes (built-in) | Node built-in | — |
| Chain Insights HTTP MCP | Remote tool execution | Unknown (private endpoint) | — | Dev: mock server in tests |

**Missing dependencies with no fallback:**
- viem, @x402/fetch, @x402/evm, @modelcontextprotocol/sdk — must be installed in Wave 0.

**Missing dependencies with fallback:**
- Chain Insights HTTP MCP: tests must use a mock MCP server (Vitest mock or local test fixture). The proxy's unit tests do not require the real endpoint.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 |
| Config file | `vitest.config.ts` (exists) |
| Quick run command | `npx vitest run` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MCP-01 | `encryptKey()` / `decryptKey()` round-trip | unit | `npx vitest run tests/wallet.test.ts` | No — Wave 0 |
| MCP-01 | `decryptKey()` with wrong machine key throws | unit | `npx vitest run tests/wallet.test.ts` | No — Wave 0 |
| MCP-01 | `wallet.json` written with 0o600 permissions | unit | `npx vitest run tests/wallet.test.ts` | No — Wave 0 |
| MCP-01 | Missing wallet: `createPaymentFetch()` throws with clear message | unit | `npx vitest run tests/wallet.test.ts` | No — Wave 0 |
| MCP-02 | `loadSchema()` returns cached schema within 24h | unit | `npx vitest run tests/mcp-schema-cache.test.ts` | No — Wave 0 |
| MCP-02 | `loadSchema()` refetches after TTL expiry | unit | `npx vitest run tests/mcp-schema-cache.test.ts` | No — Wave 0 |
| MCP-02 | `chain-insights mcp tools` formats tool table | unit | `npx vitest run tests/cli.test.ts` | Partial — extend |
| MCP-02 | Installer registers MCP proxy in `~/.claude.json` | unit | `npx vitest run tests/installer.test.ts` | Partial — extend |
| MCP-03 | Proxy registers discovered tools from mock remote | integration | `npx vitest run tests/mcp-proxy.test.ts` | No — Wave 0 |
| MCP-03 | Proxy forwards tool call with correct args | integration | `npx vitest run tests/mcp-proxy.test.ts` | No — Wave 0 |
| MCP-03 | Proxy surfaces remote errors as MCP error responses | integration | `npx vitest run tests/mcp-proxy.test.ts` | No — Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- `tests/wallet.test.ts` — covers MCP-01 (encrypt/decrypt, permissions, missing wallet error)
- `tests/mcp-schema-cache.test.ts` — covers MCP-02 TTL logic
- `tests/mcp-proxy.test.ts` — covers MCP-03 proxy forwarding (integration, uses in-process mock MCP server)
- Extend `tests/installer.test.ts` — verify MCP proxy registered in claude.json

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | — (x402 handles payment auth, no user auth) |
| V3 Session Management | No | — (stateless per-request) |
| V4 Access Control | No | — (local tool, single user) |
| V5 Input Validation | Yes | `z.object({}).passthrough()` for proxy pass-through; remote validates |
| V6 Cryptography | Yes | `node:crypto` AES-256-GCM — never hand-roll |
| V7 Error Handling | Yes | Never expose raw private key in error messages or logs |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Private key in plaintext config | Information Disclosure | AES-256-GCM in separate `wallet.json` at 0o600; never in `config.json` |
| Private key in logs | Information Disclosure | Never log the key; log `walletAddress` only |
| Stdout poisoning of MCP channel | Tampering | All debug output to `console.error()` (stderr) only |
| Authentication tag not verified | Tampering | Always call `decipher.setAuthTag()` before decryption |
| x402 payment replay | Repudiation | `ExactEvmScheme` uses nonce + validity window — handled by library |
| Unvalidated remote MCP response | Tampering | Accept tool results as opaque content; do not eval or exec |

---

## Project Constraints (from CLAUDE.md)

- **Distribution:** npm package, global install via npx — no Docker, no Python, no system deps beyond Node.js 22+
- **Storage:** DuckDB + flat markdown/JSON for case state
- **Payment:** x402 protocol — requires local EVM wallet
- **Privacy:** No telemetry, no cloud sync. Investigation data stays local.
- **Language:** TypeScript 6.0, Node.js >= 22
- **Server:** Hono (not Fastify — see REQUIREMENTS.md "Out of Scope")
- **CLI:** Commander.js
- **Build:** tsdown (not tsup)
- **Test:** Vitest 4.x
- **Config store:** `.chain-insights/` directory (not `.env`)
- **GSD Workflow:** Always enter through `/gsd-execute-phase` before making code changes

---

## Sources

### Primary (HIGH confidence)

- `@x402/fetch` v2.11.0 README — extracted from npm pack; `wrapFetchWithPaymentFromConfig`, `ExactEvmScheme` from `@x402/evm`, import paths [VERIFIED: npm registry + package download 2026-05-11]
- `@x402/evm` v2.11.0 package exports — `ExactEvmScheme` available at `@x402/evm` root and `@x402/evm/exact/client` [VERIFIED: npm registry + package download 2026-05-11]
- `@modelcontextprotocol/sdk` v1.29.0 — `McpServer` from `./server/mcp.js`, `StdioServerTransport` from `./server/stdio.js`, `Client` from `./client/index.js`, `StreamableHTTPClientTransport` from `./client/streamableHttp.js` [VERIFIED: npm pack + Context7 /modelcontextprotocol/typescript-sdk]
- `viem` v2.48.11 — `privateKeyToAccount` from `viem/accounts` [VERIFIED: Context7 /wevm/viem]
- `node:crypto` AES-256-GCM — `createCipheriv`, `scryptSync`, `randomBytes` [VERIFIED: local execution 2026-05-11]
- `claude mcp add` CLI — `--scope user`, stdio registration format [VERIFIED: local claude CLI 2.1.138]

### Secondary (MEDIUM confidence)

- x402 Coinbase docs (docs.cdp.coinbase.com/x402) — confirmed `eip155:8453` for Base Mainnet, `eip155:*` wildcard for all EVM [CITED: docs.cdp.coinbase.com/x402/quickstart-for-buyers]
- GitHub coinbase/x402 examples — confirmed `x402Client` + `wrapFetchWithPayment` + `registerExactEvmScheme` pattern also valid (lower-level API) [CITED: github.com/coinbase/x402/examples/typescript/clients/fetch]

### Tertiary (LOW confidence)

- None.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified from npm registry, package contents inspected
- Architecture: HIGH — MCP SDK, x402 package, and claude CLI all verified locally
- Pitfalls: HIGH — derived from package inspection, MCP SDK source, and local testing
- Security: HIGH — node:crypto verified working locally; AES-256-GCM is industry standard

**Research date:** 2026-05-11
**Valid until:** 2026-06-11 (30 days — stable libraries; x402 is moving fast, reverify version if delayed)
