# Domain Pitfalls

**Domain:** Open-source agent framework for blockchain AML investigations
**Researched:** 2026-05-10

---

## Critical Pitfalls

Mistakes that cause rewrites, user abandonment, or legal/compliance failures.

---

### Pitfall 1: DuckDB Native Addon Installation Hell

**What goes wrong:** DuckDB's Node.js bindings have a long history of installation failures -- wrong binaries downloaded for the platform (ARM vs x86), 403 errors fetching prebuilt binaries from S3, 7+ minute fallback compilations from source, and ERR_DLOPEN_FAILED errors post-install. The legacy `duckdb` npm package is deprecated; the replacement `@duckdb/node-api` ("Neo") uses a different API surface (Promises instead of callbacks, C API bindings instead of C++). If Chain Insights ships with the wrong DuckDB package or pins the wrong version, first-run installation will fail for a large percentage of users on macOS ARM, older Linux distros, or Windows.

**Why it happens:** DuckDB is an embedded native database. Native addons require platform-specific compiled binaries. The npm ecosystem handles this poorly -- node-pre-gyp, node-gyp, prebuildify, and prebuild-install all have different failure modes. The DuckDB team is actively migrating their packaging strategy.

**Consequences:** Users cannot install the tool. First impression is broken. Support burden explodes with platform-specific bug reports. This is the number one adoption killer for any npm package with native dependencies.

**Prevention:**
- Use `@duckdb/node-api` (the Neo client), not the deprecated `duckdb` package. Neo ships platform-specific prebuilt binaries as optional dependencies -- no source compilation needed.
- Pin to a stable DuckDB release (currently 1.x series). Test installation on macOS ARM, macOS x86, Ubuntu, Debian, Windows, and Alpine Linux (for Docker users who ignore the "no Docker" constraint).
- Add a `postinstall` health check script that verifies DuckDB loads correctly and reports a clear error if it fails.
- Document minimum Node.js version (22+) prominently -- older Node versions are the most common source of binary mismatch.

**Detection:** CI matrix testing across platforms. Track npm install failure rates. Monitor GitHub issues with "install" or "duckdb" tags.

**Confidence:** HIGH -- DuckDB installation issues are extensively documented across 20+ GitHub issues.

**Phase relevance:** Phase 1 (Foundation). Must be solved before anything else ships.

---

### Pitfall 2: DuckDB Single-Writer Concurrency Bottleneck

**What goes wrong:** DuckDB supports multiple concurrent readers but only one writer at a time. If two processes (or two agent sessions) attempt to open the same DuckDB file in read-write mode, the second one gets an immediate error: "Database is already opened by another process." Even within a single process, concurrent write transactions that touch the same rows cause transaction conflict errors (optimistic concurrency control). Investigators running a watcher in the background while also manually investigating will hit this wall.

**Why it happens:** DuckDB is designed as an analytical database for single-process workloads. It is explicitly not a client-server database. The project scope calls for watchers (background polling), case management (writes), and query caching (writes) -- all potentially concurrent.

**Consequences:** Data loss, corrupted investigation state, or silent write failures. Watchers stop recording. Investigators lose work mid-session. The tool feels unreliable at exactly the moment it needs to be trusted (during an investigation).

**Prevention:**
- Architect a single-writer gateway: all DuckDB writes go through one serialized write queue within the local server process. Never open the DuckDB file from multiple processes.
- Use a write queue / in-process mutex for all mutations. Watchers and case management share the same server process and serialize writes.
- Keep case state in flat files (markdown/JSON) for human-readable data that agents read/write independently. Reserve DuckDB for analytical queries, query caching, and aggregated watcher results.
- If future scaling demands multiple processes, the answer is a write-ahead log pattern or switching to SQLite (WAL mode) for the transactional layer -- not trying to make DuckDB do OLTP.

**Detection:** Integration tests that simulate concurrent writes. Load testing with parallel agent sessions. Monitor for "database already opened" errors in logs.

**Confidence:** HIGH -- documented in DuckDB official docs.

**Phase relevance:** Phase 1 (Foundation). The local server architecture must bake in single-writer from day one.

---

### Pitfall 3: x402 Latency Death by a Thousand Micropayments

**What goes wrong:** Each x402 payment adds 4 network steps to an API call: challenge (server returns 402), signing (client constructs payment), confirmation (facilitator verifies), retry (client resubmits with proof). A single AML investigation query might fan out to 10-50 MCP tool calls (trace address, get risk score, check OFAC list, resolve entity, get transaction history...). At 2-4 seconds overhead per x402 handshake, a simple investigation step becomes 20-200 seconds of payment overhead. The economic model also breaks when transaction fees ($0.001) exceed the micro-service value.

**Why it happens:** x402 is designed for individual API calls, not batched investigation workflows. The protocol has no native concept of "sessions," "prepaid credits," or "batch authorization." Every call is a fresh payment cycle.

**Consequences:** Investigations feel impossibly slow. Users burn through funds on payment overhead rather than actual API value. The tool becomes economically unviable for deep investigations that require hundreds of calls. Users abandon the tool for competitors with subscription pricing.

**Prevention:**
- Implement a credit/session system on top of x402: user pre-pays a balance (single x402 transaction), then the MCP server tracks credits internally and deducts per-call without additional blockchain transactions.
- Batch MCP queries where possible: instead of 10 separate tool calls, design MCP endpoints that accept batch requests (e.g., "trace these 10 addresses" as one call).
- Cache aggressively in DuckDB: never re-pay for data already fetched. Address metadata, risk scores, and entity labels change infrequently.
- Expose cost estimates to the user before expensive operations. "This trace will cost approximately $0.15 (30 API calls). Proceed?"
- Design the architecture so x402 is the payment layer, not the execution layer. Settle on-chain periodically, not per-call.

**Detection:** Measure end-to-end latency per investigation step. Track payment overhead as a percentage of total request time. Monitor user drop-off during multi-step operations.

**Confidence:** MEDIUM -- x402 is new (launched 2025), production usage patterns are still emerging. The scalability article describes real architectural concerns but the protocol is evolving.

**Phase relevance:** Phase 2-3 (MCP Integration / Payment). Must be designed before the x402 integration is built, but doesn't block the local-only development in Phase 1.

---

### Pitfall 4: Treating Blockchain Analysis as Ground Truth

**What goes wrong:** The tool presents on-chain data analysis results (address clustering, entity attribution, risk scores) as definitive facts. Investigators act on these "facts" -- filing SARs, freezing accounts, making accusations -- without understanding that blockchain analytics involve heuristic guesses with documented false positive rates. Chainalysis itself documents three critical mistakes: (1) failing to identify mixers (mischaracterizing mixer activity as simple peel chains), (2) attempting to trace funds through exchange/service deposit addresses (impossible because services co-mingle funds), and (3) failing to identify nested services and merchant providers (attributing a merchant processor's address to a single client).

**Why it happens:** Blockchain data looks precise -- addresses, amounts, timestamps are exact. But the layer of interpretation on top (who owns this address? is this entity risky? did these funds come from illicit sources?) is probabilistic. Open-source tools often lack the proprietary attribution databases that commercial tools use, making the problem worse.

**Consequences:** False accusations against legitimate entities. Wasted investigative resources chasing phantom trails. Legal liability if investigation outputs are used in legal proceedings. Regulatory penalties for filing inaccurate SARs. Reputational damage to the tool and its users.

**Prevention:**
- Always display confidence levels alongside analytical results. "Address attributed to Exchange X (confidence: 72%, source: heuristic clustering)" not "Address belongs to Exchange X."
- Build explicit warnings into the UI/agent output when encountering known ambiguous patterns: mixer detection, exchange deposit addresses, nested services.
- Never allow the tool to generate investigation conclusions -- only investigation evidence. The human investigator makes conclusions.
- Document the limitations of each data source in the MCP schema skill so agents can communicate uncertainty to users.
- Include a "methodology" section in all dossier exports that explains what analytical techniques were used and their known limitations.

**Detection:** Review agent output for absolute claims about attribution. Test with known ambiguous cases (mixer transactions, exchange deposits). User feedback on false positives.

**Confidence:** HIGH -- Chainalysis, Merkle Science, and academic sources extensively document these limitations.

**Phase relevance:** Phase 2 (MCP Integration) and Phase 3 (Playbooks). Must be baked into the data model and agent skill prompts from the start.

---

### Pitfall 5: Private Key Exposure in Agent-Accessible Environment

**What goes wrong:** x402 requires a local EVM wallet for signing payment transactions. The wallet's private key must be accessible to the Chain Insights process to sign x402 payments. AI agents (Claude Code, Codex) operate in the same environment. A misconfigured skill, a prompt injection, or a malicious playbook could instruct the agent to read the private key from the filesystem, environment variable, or memory -- then exfiltrate it via MCP calls, include it in dossier output, or log it.

**Why it happens:** Agent frameworks give the AI broad filesystem and tool access. The private key must be accessible to the signing process. There is no standard isolation boundary between "what the agent can see" and "what the payment system needs."

**Consequences:** Total loss of funds in the wallet. If the wallet is funded with significant balance for batch payments, the loss is proportionally larger. User trust in the entire tool is destroyed. Potential chain of liability issues.

**Prevention:**
- Never store private keys in plaintext. Use encrypted keystores (e.g., Hardhat Keystore pattern) with a password prompt at startup.
- Isolate the signing process: the x402 payment module should run in a subprocess or use OS-level keychain APIs. The agent should never have direct access to key material -- only the ability to request a payment via an internal API.
- Implement a spending cap: the signing module enforces a per-session and per-day maximum spend, regardless of what the agent requests.
- Store only minimal funds in the payment wallet. Use a hot wallet pattern with small balance, topped up manually.
- Add the wallet file path to `.gitignore`, agent deny lists, and skill system file access restrictions.
- Audit all playbook and skill definitions for filesystem access patterns that could reach key material.

**Detection:** Security review of all file access patterns in skills. Penetration testing with adversarial prompts. Monitor wallet balance for unexpected decreases.

**Confidence:** HIGH -- wallet security is a well-understood domain; the novel risk is the agent-accessible environment.

**Phase relevance:** Phase 2-3 (Payment Integration). The wallet architecture must be designed before x402 is implemented. Non-negotiable security boundary.

---

### Pitfall 6: Evidence Chain of Custody Breaks in Flat Files

**What goes wrong:** Investigation dossiers stored as flat markdown/JSON files can be silently modified by the AI agent, the user, or filesystem operations without any audit trail. If investigation outputs are ever used in legal proceedings (SAR filings, law enforcement referrals, regulatory examinations), the lack of chain of custody documentation makes the evidence inadmissible or challengeable. Defense attorneys will argue the evidence was tampered with.

**Why it happens:** Flat files are chosen for human readability and agent friendliness (both valid goals). But flat files have no built-in integrity protection, no append-only logging, no tamper detection, and no attribution of who changed what and when.

**Consequences:** Investigation outputs cannot be used in legal/regulatory contexts. The tool is limited to informal research, not professional compliance work. Users who depend on it for formal investigations discover this limitation after they need the evidence.

**Prevention:**
- Implement cryptographic hashing (SHA-256) of all evidence files. Store hashes in a separate integrity manifest that is append-only.
- Use git as an evidence ledger: every evidence collection action auto-commits to a local git repository with timestamp, source, and hash. Git provides tamper-evident history.
- Generate evidence collection logs (who requested what data, when, from which source, what was returned) alongside the evidence itself.
- Add an `evidence export` command that bundles evidence files with their integrity manifest, collection logs, and hash verification report -- suitable for regulatory submission.
- Never allow the agent to silently modify existing evidence. New evidence appends; corrections create new entries referencing the original.

**Detection:** Periodic hash verification of evidence files against the integrity manifest. Alert on any hash mismatch. Review git history for unexplained modifications.

**Confidence:** MEDIUM -- evidence integrity is well-understood in digital forensics; the specific application to AI-agent-generated AML dossiers is novel territory.

**Phase relevance:** Phase 2 (Case/Dossier System). Must be designed into the dossier system from the start, not bolted on later.

---

## Moderate Pitfalls

---

### Pitfall 7: MCP Tool Schema Bloat Eating Agent Context Windows

**What goes wrong:** The MCP server exposes many tools (query endpoints, probes, schema introspection). Every tool call's result gets added to the agent's context window. A typical AML investigation might chain 10-30 MCP calls, each returning JSON payloads of transaction data, risk scores, and entity metadata. The context window fills up, the agent starts losing earlier context (investigation notes, user instructions, case background), and output quality degrades silently.

**Why it happens:** MCP tool results are appended to conversation context. There is no built-in mechanism for summarizing or evicting old tool results. Blockchain data payloads can be large (hundreds of transactions, deep nesting).

**Prevention:**
- Design MCP responses to be concise. Return summaries with drill-down IDs, not full data dumps. "Found 847 transactions. Top 5 by value: [...]  Use probe_detail(id) for full data."
- Implement a result caching layer in the local server. Store full MCP responses in DuckDB; return only summaries to the agent context.
- Build "investigation memory" as a separate, structured document that the agent can reference -- not the raw context window. The agent writes findings to the dossier, then can refer back to it.
- Set maximum response sizes in the MCP schema skill so agents request paginated results.

**Detection:** Monitor context window usage during test investigations. Track cases where agent output quality drops mid-investigation.

**Confidence:** HIGH -- this is a well-documented MCP integration problem across all agent frameworks.

**Phase relevance:** Phase 2 (MCP Integration). The MCP schema skill and response format must be designed with context limits in mind.

---

### Pitfall 8: Conflating Framework Code with Investigation Data Privacy

**What goes wrong:** The framework is open source (MIT license, public repo), but investigation data is highly sensitive (wallet addresses under investigation, suspected illicit actors, unpublished SAR data, law enforcement case details). A common mistake: telemetry, error reporting, crash dumps, or debug logs inadvertently capture and transmit investigation data. Even "anonymous" usage analytics can leak investigation patterns (which addresses were queried, when, how often).

**Why it happens:** Standard npm package practices include error reporting (Sentry), analytics (Mixpanel), and crash reporting. These are appropriate for developer tools but toxic for compliance tools. The open-source codebase will attract contributions from developers who add logging or reporting without understanding the sensitivity.

**Prevention:**
- Zero telemetry, zero analytics, zero crash reporting -- ever. This is not negotiable for a compliance tool. State this in CONTRIBUTING.md and enforce via code review.
- Add a pre-commit hook that scans for common telemetry patterns (fetch to external URLs, Sentry/Datadog/Mixpanel imports).
- All logging must be local-only. Log files stay on the user's machine. No log aggregation services.
- Error messages must never include investigation data (addresses, entity names, case IDs). Sanitize before logging.
- Document this privacy architecture prominently -- it is a selling point, not a limitation.

**Detection:** Static analysis for outbound network calls in non-MCP code. Security audit for data leakage paths. Review all dependency trees for telemetry packages.

**Confidence:** HIGH -- privacy is a table-stakes requirement for compliance tools, and the failure mode is well-documented across the industry.

**Phase relevance:** Phase 1 (Foundation). Privacy architecture must be established before any code is written.

---

### Pitfall 9: Multi-Runtime Support as Premature Abstraction

**What goes wrong:** The architecture calls for supporting Claude Code first, then Codex and Open Claw. Teams often build a generic "runtime adapter" abstraction layer before shipping the first runtime, trying to anticipate what Codex and Open Claw will need. This produces a leaky abstraction that makes the primary runtime (Claude Code) worse while not actually working for the secondary runtimes (which have different skill formats, hook systems, and interaction patterns).

**Why it happens:** Engineers see "multi-runtime" in the requirements and immediately reach for abstraction. But Claude Code skills (.md files + hooks), Codex (different agent protocol), and Open Claw (yet another model) have fundamentally different interaction surfaces. The commonality is smaller than it appears.

**Prevention:**
- Build exclusively for Claude Code in Phase 1. No runtime abstraction layer. Hardcode Claude Code assumptions.
- When adding Codex support later, extract the abstraction from the working Claude Code implementation. Let the abstraction emerge from two concrete implementations, not from speculation.
- Keep the MCP interaction layer (which is runtime-agnostic by design) separate from the skill/hook layer (which is runtime-specific). The MCP layer is the natural abstraction boundary.
- Devin/Cognition explicitly warns against premature multi-agent/multi-runtime abstractions: "running multiple agents in collaboration only results in fragile systems."

**Detection:** Code review for generic "runtime" interfaces with only one implementation. Measure time spent on abstraction vs. features.

**Confidence:** HIGH -- premature abstraction is one of the most documented software engineering pitfalls, with specific evidence from agent framework development.

**Phase relevance:** Phase 1 (Foundation). Resist the temptation. Build for Claude Code. Extract later.

---

### Pitfall 10: x402 Token and Chain Compatibility Assumptions

**What goes wrong:** x402 documentation suggests chain-agnostic, stablecoin-agnostic payment. In reality, only tokens implementing EIP-3009 (transferWithAuthorization) work with x402's gasless authorization scheme. USDC on Base supports it. USDT does not. Solana does not. This means approximately 40% of the stablecoin market is incompatible. If Chain Insights assumes "any stablecoin works," users will try to pay with USDT or USDC on Solana and hit cryptic failures.

**Why it happens:** x402 marketing language ("chain agnostic," "any stablecoin") is aspirational, not factual. The technical spec is narrower than the marketing.

**Prevention:**
- Explicitly support USDC on Base only at launch. Do not claim broader compatibility until it is tested.
- Display the supported payment methods clearly during setup and before any payment operation.
- Build the payment module with a clear interface that can add new tokens/chains later, but do not expose untested options to users.
- Monitor x402 protocol evolution and USDT EIP-3009 adoption; expand support when verified.

**Detection:** Test payment flow with USDT, USDC on multiple chains. Document which combinations work.

**Confidence:** MEDIUM -- x402 is rapidly evolving and compatibility may expand. Current limitations are documented.

**Phase relevance:** Phase 2-3 (Payment Integration). State supported payment methods clearly in documentation.

---

### Pitfall 11: Playbook System Becoming a Footgun

**What goes wrong:** Reusable investigation playbooks (trace funds, risk check, entity profiling) give AI agents sequences of MCP calls to execute. A poorly written or malicious playbook can: (a) run unbounded loops draining x402 credits, (b) query sensitive addresses the user didn't intend to investigate, (c) produce misleading conclusions by skipping verification steps, or (d) create dossier entries that look authoritative but are based on incomplete data.

**Why it happens:** Playbooks are user-extensible by design. The community will contribute playbooks. Some will be well-tested; many will not. AI agents execute playbooks faithfully without judgment about whether the steps make sense.

**Prevention:**
- Implement playbook execution guardrails: maximum step count, maximum cost per execution, mandatory confirmation for destructive or expensive operations.
- Require playbooks to declare their cost estimate, expected runtime, and data sources upfront.
- Add a "dry run" mode that shows what a playbook would do without executing it.
- Curate a set of "official" playbooks with test coverage. Community playbooks get a clear "unverified" label.
- Log all playbook executions with full audit trail for later review.

**Detection:** Monitor playbook execution costs. Alert on playbooks that exceed declared estimates. Review community-submitted playbooks for anti-patterns.

**Confidence:** MEDIUM -- playbook/skill systems in agent frameworks are still maturing; specific risks are extrapolated from agent orchestration failure modes.

**Phase relevance:** Phase 3 (Playbooks). Build guardrails before accepting community contributions.

---

## Minor Pitfalls

---

### Pitfall 12: npm Global Install Permission Conflicts

**What goes wrong:** `npm install -g` requires write access to the global node_modules directory, which on many Linux/macOS systems requires sudo. Users who don't know about `npm config set prefix` or nvm get permission errors. Windows users face different path issues.

**Prevention:**
- Recommend `npx` for first-run (no global install needed).
- Document the `npm config set prefix ~/.npm-global` workaround prominently.
- Support both global install and project-local install.
- Test with nvm, fnm, and system Node.js installations.

**Confidence:** HIGH -- extensively documented across the npm ecosystem.

**Phase relevance:** Phase 1 (Distribution). Include in setup documentation.

---

### Pitfall 13: D3.js Visualization Serving Exposes Local Server

**What goes wrong:** The local server serves D3.js visualizations on a local port. If the server binds to `0.0.0.0` instead of `127.0.0.1`, it is accessible from the network. Investigation visualizations (money flow graphs with addresses, amounts, entity names) become visible to anyone on the same network.

**Prevention:**
- Bind exclusively to `127.0.0.1`. Never `0.0.0.0`.
- Add a random auth token to visualization URLs so they cannot be guessed even on localhost.
- Document that the local server is for local access only.

**Confidence:** HIGH -- standard local server security practice.

**Phase relevance:** Phase 1 (Local Server). Set the default binding correctly from day one.

---

### Pitfall 14: Flat File Case State Race Conditions

**What goes wrong:** Two concurrent agent sessions (or an agent and a watcher) modify the same case markdown/JSON file simultaneously. One write overwrites the other. Investigation notes, evidence references, or status updates are silently lost.

**Prevention:**
- Use file-level locking (lockfile npm package or OS-level advisory locks) for all flat file writes.
- Prefer append-only patterns: new evidence entries append to a file rather than rewriting it.
- Consider using the DuckDB-backed write queue for coordinating flat file mutations.
- Test with concurrent agent sessions modifying the same case.

**Confidence:** HIGH -- concurrent file access is a well-understood problem. AI agent environments make it worse because agents don't check for conflicts.

**Phase relevance:** Phase 2 (Case Management). Design the file access pattern before building case management.

---

### Pitfall 15: Over-Engineering the Schema Skill

**What goes wrong:** The MCP schema skill (which tells agents what tools/endpoints are available) becomes a comprehensive API documentation system. The agent loads the entire schema into context at the start of every session, consuming thousands of tokens before any investigation work begins.

**Prevention:**
- Design the schema skill as a lightweight index: tool names, one-line descriptions, and cost estimates. Full documentation is available on-demand per tool.
- Use lazy loading: agent discovers available tools from the index, then loads detailed specs only for tools it plans to use.
- Keep the schema under 2000 tokens total for the index view.

**Confidence:** MEDIUM -- inferred from MCP integration best practices.

**Phase relevance:** Phase 2 (MCP Integration).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Foundation / Distribution | DuckDB install failures (#1), npm permission issues (#12), server binding (#13) | Use @duckdb/node-api Neo client, test cross-platform CI, bind 127.0.0.1 |
| Foundation / Architecture | Single-writer bottleneck (#2), premature multi-runtime abstraction (#9), privacy architecture (#8) | Single-writer gateway, build for Claude Code only, zero telemetry policy |
| MCP Integration | Context window bloat (#7), schema skill over-engineering (#15), treating analysis as truth (#4) | Concise responses, lazy schema loading, confidence levels on all data |
| Payment Integration | x402 latency (#3), private key exposure (#5), token compatibility (#10) | Credit/session system, isolated signing subprocess, USDC on Base only |
| Case/Dossier System | Evidence chain of custody (#6), flat file race conditions (#14) | Cryptographic hashing + git ledger, file locking |
| Playbooks | Runaway execution (#11), cost overruns (#3) | Execution guardrails, dry run mode, cost estimates |

---

## Sources

- [Chainalysis: 3 Common Blockchain Analysis Mistakes](https://www.chainalysis.com/blog/common-blockchain-analysis-mistakes-cryptocurrency-investigations/) -- HIGH confidence
- [DuckDB Concurrency Documentation](https://duckdb.org/docs/current/connect/concurrency) -- HIGH confidence
- [DuckDB Node Neo Client Announcement](https://duckdb.org/2024/12/18/duckdb-node-neo-client) -- HIGH confidence
- [x402 Scalability Problems](https://earezki.com/ai-news/2026-05-08-the-hidden-scalability-problems-of-x402-and-machine-payments/) -- MEDIUM confidence
- [x402 Official Documentation](https://docs.cdp.coinbase.com/x402/welcome) -- HIGH confidence
- [x402 Compliance Challenges](https://www.coinlive.com/news/x402-protocol-the-payment-revolution-and-compliance-challenges-in-the) -- MEDIUM confidence
- [MCP Security Best Practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices) -- HIGH confidence
- [Agent Orchestration Problem Nobody Talks About](https://dev.to/o96a/the-agent-orchestration-problem-nobody-talks-about-7kp) -- MEDIUM confidence
- [AI Agent Database Wipe Disaster](https://www.mindstudio.ai/blog/ai-agent-database-wipe-disaster-lessons) -- HIGH confidence
- [Oracle: File Systems vs Databases for AI Agent Memory](https://blogs.oracle.com/developers/comparing-file-systems-and-databases-for-effective-ai-agent-memory-management) -- MEDIUM confidence
- [TRM Labs: How to Evaluate Blockchain Intelligence Platforms](https://www.trmlabs.com/resources/blog/how-to-evaluate-a-blockchain-intelligence-platform-for-crypto-compliance-and-aml) -- HIGH confidence
- [Merkle Science: Top Mistakes in Crypto Investigations](https://www.merklescience.com/blog/top-mistakes-investigators-make-when-investigating-crypto-crime) -- MEDIUM confidence
- [Ghost Clusters: Evaluating Attribution of Illicit Services (USENIX Security)](https://www.usenix.org/system/files/usenixsecurity25-lubbertsen.pdf) -- HIGH confidence
- [DuckDB in Production](https://www.dench.com/blog/duckdb-in-production) -- MEDIUM confidence
- [Hardhat Keystore: Secure Private Key Management](https://www.neonevm.org/blog/hardhat-keystore-secure-private-key-management-for-developers) -- HIGH confidence
- [NIST Digital Evidence Preservation (IR 8387)](https://nvlpubs.nist.gov/nistpubs/ir/2022/NIST.IR.8387.pdf) -- HIGH confidence
