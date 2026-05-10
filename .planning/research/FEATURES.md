# Feature Landscape

**Domain:** Blockchain AML Investigation Agent Framework
**Researched:** 2026-05-10
**Overall confidence:** HIGH

## Context

This analysis maps features across two converging domains: (1) commercial blockchain AML investigation platforms (Chainalysis Reactor, TRM Forensics, Elliptic Investigator, Crystal Intelligence) and (2) AI agent frameworks (GSD, MCP-based tool systems). Chain Insights occupies a unique intersection -- it is not a SaaS compliance platform, but a local-first, open-source toolkit that gives AI coding agents the ability to run AML investigations through slash commands, playbooks, and MCP-connected on-chain data.

The competitive frame is not "replace Chainalysis" -- it is "give independent investigators, small compliance teams, and crypto-native analysts a free investigation toolkit powered by their AI agent of choice, paying only for on-chain data queries via x402 micropayments."

---

## Table Stakes

Features users expect from any credible AML investigation tool. Missing = the product feels incomplete or amateur.

### TS-1: Wallet/Address Lookup

| Attribute | Detail |
|-----------|--------|
| **Description** | Query any blockchain address and get balance, transaction history, risk score, and entity attribution. The fundamental atomic operation. |
| **Why Expected** | Every commercial tool starts here (Chainalysis Reactor, TRM, Elliptic). Without it, nothing else works. |
| **Complexity** | Low |
| **Dependencies** | Chain Insights MCP connection, x402 payment gateway |
| **Notes** | Data comes from MCP -- the toolkit just needs clean query/response handling and result formatting. Slash command: `/ci-lookup` or similar. |

### TS-2: Transaction Tracing (Fund Flow)

| Attribute | Detail |
|-----------|--------|
| **Description** | Follow money from address A through intermediate hops to destination. Forward tracing (where did funds go?) and backward tracing (where did funds come from?). |
| **Why Expected** | Core of every investigation. Chainalysis Reactor, TRM Forensics, and Elliptic all treat this as their primary workflow. "Follow the money" is the investigator's mantra. |
| **Complexity** | Medium |
| **Dependencies** | TS-1 (lookup), MCP trace endpoints, visualization (TS-6) |
| **Notes** | MCP already has probe endpoints for stolen funds detection. Toolkit needs to orchestrate multi-hop queries and accumulate results into a coherent trace narrative. Cross-chain tracing is a differentiator, not table stakes -- start with single-chain. |

### TS-3: Risk Scoring

| Attribute | Detail |
|-----------|--------|
| **Description** | Assign and display risk scores for addresses, transactions, and entities. Flag sanctioned addresses, known mixers, darknet markets, scam contracts. |
| **Why Expected** | Every commercial platform does this. Scorechain offers free sanctions screening APIs. Chainalysis KYT, Elliptic Lens, TRM Screening all provide risk scores. Without risk indicators, an investigator cannot prioritize. |
| **Complexity** | Low (consuming scores from MCP) |
| **Dependencies** | MCP risk scoring endpoints, sanctions list data |
| **Notes** | MCP already provides risk scoring via graphrag probes. Toolkit surfaces and contextualizes scores within case context. Display risk categories (sanctions, mixer, darknet, scam, gambling, etc.). |

### TS-4: Case Management

| Attribute | Detail |
|-----------|--------|
| **Description** | Create, open, close, tag, and track investigation cases. Each case accumulates evidence, notes, queries, and findings. Cases persist across sessions. |
| **Why Expected** | All commercial platforms have case management. TRM Forensics, Chainalysis Reactor, and Elliptic all organize work into cases. Without case structure, investigations are ephemeral and unprofessional. |
| **Complexity** | Medium |
| **Dependencies** | DuckDB for metadata, flat files for case state |
| **Notes** | Domain vocabulary: "cases" not "tasks." Cases are directories with structured markdown/JSON. Slash commands: `/ci-case-open`, `/ci-case-close`, `/ci-case-list`. Each case gets a unique ID, title, status, tags, timestamps. This is the spine of the entire system -- nearly everything else attaches to a case. |

### TS-5: Evidence/Dossier System

| Attribute | Detail |
|-----------|--------|
| **Description** | Accumulate and organize evidence per entity or case. Include query results, annotations, notes, screenshots, risk assessments, and investigator commentary. Human-readable flat files. |
| **Why Expected** | Chainalysis Reactor has annotations and contextual notes on graphs. TRM has "glass box" evidence sourcing. Elliptic links evidence to entity profiles. Without evidence accumulation, every query is a one-shot -- the investigator cannot build a picture. |
| **Complexity** | Medium |
| **Dependencies** | TS-4 (case management) |
| **Notes** | Domain vocabulary: "dossiers" and "evidence" not "artifacts." Dossiers are per-entity (wallet, exchange, person) markdown files within a case directory. AI agents append findings as they investigate. Git-trackable for audit trail. |

### TS-6: Money Flow Visualization

| Attribute | Detail |
|-----------|--------|
| **Description** | Interactive D3.js force-directed and tree graphs showing fund flows between addresses. Nodes = wallets/entities. Edges = transactions with amounts, timestamps, and direction. |
| **Why Expected** | Visualization is THE feature of Chainalysis Reactor. TRM offers "prosecutor-grade graphing." Elliptic has "single-click forensics" visualization. Crystal has dedicated visualization tools. Without graphs, investigators cannot communicate findings to prosecutors, compliance officers, or clients. |
| **Complexity** | Medium (reusing existing rbmk viz code) |
| **Dependencies** | TS-2 (transaction tracing), local HTTP server for serving visualizations |
| **Notes** | Existing D3.js code in rbmk repos handles force/tree graphs. Toolkit needs to: (a) transform MCP trace data into graph data, (b) serve visualization from local server, (c) open in browser. Slash command: `/ci-visualize`. Annotation support on graph nodes is a differentiator. |

### TS-7: MCP Schema Discovery

| Attribute | Detail |
|-----------|--------|
| **Description** | Agent can query what MCP tools/endpoints are available, their parameters, return types, and pricing. Self-describing API. |
| **Why Expected** | MCP standard requires tools to be discoverable at runtime. Without schema awareness, agents cannot know what queries are possible, leading to hallucinated tool calls. |
| **Complexity** | Low |
| **Dependencies** | MCP server schema endpoint |
| **Notes** | Skill file that loads MCP schema into agent context. Agent learns available probes, their costs (x402 pricing), and input/output formats. Critical for multi-runtime support -- each agent runtime needs the same schema understanding. |

### TS-8: x402 Payment Integration

| Attribute | Detail |
|-----------|--------|
| **Description** | Local EVM wallet management for x402 micropayments. Auto-pay for MCP queries. Budget tracking, spend limits, and payment history. |
| **Why Expected** | The MCP is gated behind x402 payments. Without payment integration, the toolkit cannot access any on-chain data. This is the monetization engine. |
| **Complexity** | Medium |
| **Dependencies** | Local wallet (private key management), x402 protocol libraries |
| **Notes** | x402 protocol is well-established (Coinbase, Cloudflare, Google, Visa backing). HTTP 402 response triggers automatic stablecoin payment. Need: wallet setup during install, balance checking, spend tracking per case, budget alerts. Slash command: `/ci-balance`, `/ci-budget`. |

### TS-9: Investigation Memory / Session Persistence

| Attribute | Detail |
|-----------|--------|
| **Description** | Persistent context across agent sessions for each case. When an investigator returns to a case, the agent knows what has been done, what was found, and what remains. |
| **Why Expected** | GSD framework proves this pattern works. Without persistence, every session starts from zero. Commercial tools persist state server-side. Agent-native tool must persist state locally. |
| **Complexity** | Medium |
| **Dependencies** | TS-4 (case management), flat file system |
| **Notes** | Each case maintains a `MEMORY.md` or equivalent that the agent reads on case resumption. Includes: investigation timeline, key findings, open questions, next steps. The agent skill auto-loads this context. Pattern borrowed directly from GSD's `.planning/` structure. |

---

## Differentiators

Features that set Chain Insights apart from commercial platforms. Not expected, but create compelling value. These justify choosing this toolkit over alternatives.

### D-1: Playbook System (Reusable Investigation Workflows)

| Attribute | Detail |
|-----------|--------|
| **Value Proposition** | Pre-built, parameterized investigation workflows that agents execute end-to-end. "Trace stolen funds," "profile exchange," "risk-check counterparty," "OFAC sanctions sweep." Investigators define once, run many times. No commercial platform offers agent-executable playbooks. |
| **Complexity** | High |
| **Dependencies** | TS-4 (case management), TS-1 (lookup), TS-2 (tracing), TS-3 (risk scoring) |
| **Notes** | Domain vocabulary: "playbooks" not "skills" (avoids GSD collision). Playbooks are markdown templates with structured steps, decision points, and evidence collection instructions. Agent interprets and executes. Community can contribute playbooks. Slash command: `/ci-playbook-run <name>`. Examples: `trace-funds.md`, `entity-profile.md`, `sanctions-check.md`, `mixer-analysis.md`. This is the "killer feature" -- it turns ad-hoc investigation into repeatable, auditable process. |

### D-2: Agent-Native Investigation (AI-First, Not GUI-First)

| Attribute | Detail |
|-----------|--------|
| **Value Proposition** | Unlike Chainalysis/TRM/Elliptic which are GUI applications with optional APIs, Chain Insights is built for AI agents first. Natural language commands, contextual reasoning, and autonomous multi-step investigation. The agent IS the interface. |
| **Complexity** | Medium (architecture choice, not a single feature) |
| **Dependencies** | Claude Code skills/hooks system, multi-runtime support |
| **Notes** | This is the fundamental differentiator. An investigator says "trace the funds from this wallet and find where they cashed out" and the agent orchestrates lookup, tracing, risk scoring, visualization, and dossier updates autonomously. No clicking through graph UIs. Competitive platforms cost $40K+/year for a single seat. This is free + per-query micropayments. |

### D-3: Watcher System (Address/Wallet Monitoring)

| Attribute | Detail |
|-----------|--------|
| **Value Proposition** | Set up persistent watches on addresses. Poll MCP for new activity and alert the investigator when monitored wallets send/receive funds. Long-running surveillance without manual checking. |
| **Complexity** | Medium |
| **Dependencies** | TS-4 (case management), MCP polling endpoints, local server for scheduling |
| **Notes** | Domain vocabulary: "watches" not "crons." Commercial tools like CryptocurrencyAlerting, MetaSleuth, and MistTrack offer this, but as separate paid SaaS. Chain Insights embeds it locally. Watchers persist in DuckDB with configurable polling intervals. Alert channels: agent notification on next session, or webhook/file-based for external integration. Slash command: `/ci-watch-add`, `/ci-watch-list`, `/ci-watch-pause`. |

### D-4: Multi-Runtime Support

| Attribute | Detail |
|-----------|--------|
| **Value Proposition** | Works across Claude Code, Codex, OpenCode, Gemini CLI, and other agent runtimes. Investigators are not locked into one AI provider. GSD has proven this works across 14+ runtimes. |
| **Complexity** | Medium |
| **Dependencies** | Agent Skills open standard, runtime detection |
| **Notes** | Claude Code first (primary user base, GSD proves the model). Architecture must support other runtimes from day one -- same skills/commands in runtime-appropriate format. GSD's installer auto-detects runtime and configures accordingly. Chain Insights follows same pattern. |

### D-5: Quick MCP Query Execution

| Attribute | Detail |
|-----------|--------|
| **Value Proposition** | Fast, one-shot queries against MCP without opening a full case. Like GSD's `/gsd-fast` -- quick answer, minimal ceremony. "What's the risk score for this address?" without creating a case, dossier, or evidence trail. |
| **Complexity** | Low |
| **Dependencies** | TS-1 (lookup), TS-8 (x402 payment) |
| **Notes** | Slash command: `/ci-fast` or `/ci-query`. For quick checks during development, due diligence, or curiosity. Results displayed inline, not persisted. Reduces friction for casual use. Important for adoption -- not every query is a formal investigation. |

### D-6: Investigation Report Generation

| Attribute | Detail |
|-----------|--------|
| **Value Proposition** | Auto-generate structured investigation reports from case evidence. Markdown reports with fund flow summaries, risk assessments, entity profiles, and timeline of findings. Exportable for compliance filings or client delivery. |
| **Complexity** | Medium |
| **Dependencies** | TS-4 (case management), TS-5 (dossier system), TS-6 (visualization) |
| **Notes** | Chainalysis offers "court-format PDF export." TRM produces API exports. Chain Insights generates markdown reports (agent-friendly, human-readable) with optional PDF/HTML rendering from local server. Reports include: executive summary, methodology, findings, evidence references, risk indicators, money flow diagrams. Slash command: `/ci-report`. |

### D-7: Peeling Chain / Mixer Detection Assistance

| Attribute | Detail |
|-----------|--------|
| **Value Proposition** | Agent-guided analysis of common obfuscation techniques: peeling chains, mixer/tumbler usage, chain-hopping patterns. The agent explains what it finds in plain language -- critical for investigators who may not be blockchain experts. |
| **Complexity** | High |
| **Dependencies** | TS-2 (tracing), MCP pattern detection probes |
| **Notes** | Commercial platforms auto-detect peeling chains and mixer patterns. MCP can provide the detection signals. The agent's job is to interpret findings, explain the obfuscation technique, and suggest next investigative steps. This is where the AI agent adds unique value -- reasoning about patterns, not just displaying them. Playbook: `mixer-analysis.md`. |

### D-8: Local-First Privacy

| Attribute | Detail |
|-----------|--------|
| **Value Proposition** | All investigation data stays on the investigator's machine. No cloud sync, no telemetry, no SaaS backend. Git-trackable case files. Investigators maintain full control of sensitive case materials. |
| **Complexity** | Low (architecture decision, not a feature to build) |
| **Dependencies** | DuckDB (embedded), flat file system |
| **Notes** | Commercial platforms store your investigation data on their servers. Chain Insights stores everything locally. This matters enormously for law enforcement, independent investigators, and privacy-conscious compliance teams. The only external communication is MCP queries (which send addresses/transactions, not case context). |

### D-9: Cost Transparency and Budget Management

| Attribute | Detail |
|-----------|--------|
| **Value Proposition** | Per-query cost tracking, case-level spend reports, budget limits, and cost estimates before executing expensive operations. Investigators know exactly what each query costs. |
| **Complexity** | Low-Medium |
| **Dependencies** | TS-8 (x402 payment integration), TS-4 (case management) |
| **Notes** | Commercial platforms charge $40K+/year flat. Chain Insights charges per query via x402. This is both a selling point and a UX obligation -- investigators must understand costs. Show: total spend per case, spend per query type, remaining balance, estimated cost before trace operations. Prevents bill shock. |

---

## Anti-Features

Features to deliberately NOT build. Each would be a trap that wastes development time, creates scope creep, or moves the product toward being something it is not.

### AF-1: DO NOT Build a GUI/Dashboard

| Why Avoid | What to Do Instead |
|-----------|-------------------|
| Chain Insights is an agent framework, not a web app. Building a GUI duplicates Chainalysis/TRM/Elliptic's core competency (where they have 10+ years of head start and $100M+ in funding). It also fragments the UX -- users would have to choose between agent commands and GUI clicks. | Agent IS the interface. Visualization is the exception: D3.js graphs open in browser for viewing, but all interaction happens through the agent. Local server serves static visualizations, not interactive dashboards. |

### AF-2: DO NOT Build Your Own Blockchain Indexer

| Why Avoid | What to Do Instead |
|-----------|-------------------|
| Indexing even one blockchain (Bitcoin) requires terabytes of storage, weeks of sync time, and continuous maintenance. Multi-chain indexing is a $10M+ infrastructure problem. Chainalysis, TRM, and Elliptic each spend enormous resources on this. | MCP provides all on-chain data. The toolkit queries, never indexes. The MCP server (graphrag) already handles indexing, clustering, and attribution. Chain Insights is the investigation layer, not the data layer. |

### AF-3: DO NOT Build Entity Attribution / Address Clustering

| Why Avoid | What to Do Instead |
|-----------|-------------------|
| Attribution databases (linking addresses to real-world entities) require years of data collection, law enforcement partnerships, exchange cooperation, and human intelligence. Chainalysis has 134K+ attributed entities. Building even 1% of this is impractical. | Consume attribution from MCP. The graphrag system provides entity labels and clustering. If MCP attribution is insufficient for a query, surface that gap to the investigator rather than guessing. |

### AF-4: DO NOT Build Real-Time Chain Streaming

| Why Avoid | What to Do Instead |
|-----------|-------------------|
| Real-time mempool/block monitoring requires persistent connections to blockchain nodes, high-bandwidth infrastructure, and complex event processing. The watcher system does not need real-time -- it needs periodic polling. | Watchers poll MCP at configurable intervals (e.g., every 5 minutes, hourly). MCP handles the chain connectivity. The toolkit asks "has anything new happened?" rather than listening to a firehose. |

### AF-5: DO NOT Build SAR Filing / Regulatory Submission

| Why Avoid | What to Do Instead |
|-----------|-------------------|
| SAR filing requires integration with FinCEN BSA E-Filing, jurisdiction-specific regulatory formats, compliance officer approval workflows, and legal review processes. This is enterprise compliance software, not an investigation toolkit. | Generate investigation reports (D-6) that can inform SAR filings. The output is evidence and narrative, not the regulatory submission itself. Compliance officers use the report to file SARs through their existing systems. |

### AF-6: DO NOT Build Multi-User Collaboration

| Why Avoid | What to Do Instead |
|-----------|-------------------|
| Multi-user access control, concurrent editing, shared case management, and team workflows require authentication, authorization, conflict resolution, and networking. This turns a local toolkit into a SaaS platform. | Single investigator, single machine. If teams need to share, they share via git (case files are flat markdown/JSON). Future milestone could add simple export/import, but never user management or access control. |

### AF-7: DO NOT Build Vector Store / Semantic Search (Yet)

| Why Avoid | What to Do Instead |
|-----------|-------------------|
| Embedding-based semantic search adds infrastructure complexity (vector DB, embedding model, indexing pipeline) without clear ROI in early phases. Investigation queries are structured (addresses, hashes, entity names), not semantic. | Use DuckDB full-text search and structured queries. Defer semantic search to a later milestone when the case corpus is large enough to benefit from it. The PROJECT.md already marks this as out of scope. |

---

## Feature Dependencies

```
                           MCP Connection
                               |
                    +----------+----------+
                    |                     |
              x402 Payment          MCP Schema
              Gateway (TS-8)        Discovery (TS-7)
                    |
         +----------+----------+
         |          |          |
   Wallet/Addr   Risk       Transaction
   Lookup (TS-1) Scoring    Tracing (TS-2)
         |       (TS-3)        |
         |          |          |
         +----+-----+----+----+
              |           |
         Case Mgmt   Money Flow
         (TS-4)       Viz (TS-6)
              |
    +---------+---------+
    |         |         |
 Dossier   Session    Watcher
 System    Memory     System
 (TS-5)   (TS-9)     (D-3)
    |
    +----+----+
    |         |
 Playbooks  Report
 (D-1)      Gen (D-6)
```

### Critical Path

1. MCP Connection + x402 Payment = foundation (nothing works without data access)
2. Lookup + Risk Scoring + Tracing = core investigation primitives
3. Case Management = organizational spine (everything else attaches to cases)
4. Dossier + Memory = investigation persistence (AI agent value)
5. Visualization = communication of findings
6. Playbooks = automation and repeatability (primary differentiator)
7. Watchers + Reports = operational maturity

### Dependency Rules

- **TS-1 before TS-2**: Cannot trace funds without address lookup
- **TS-4 before TS-5**: Dossiers live inside cases
- **TS-4 before TS-9**: Memory is per-case
- **TS-4 before D-3**: Watches are associated with cases
- **TS-5 before D-1**: Playbooks write to dossiers
- **TS-2 + TS-6 together**: Tracing without visualization is half the story
- **TS-5 before D-6**: Reports synthesize dossier contents

---

## MVP Recommendation

### Phase 1: Foundation (Must Ship First)

1. **MCP Connection + x402 Payment (TS-7, TS-8)** -- without data access, nothing works
2. **Wallet/Address Lookup (TS-1)** -- the atomic operation
3. **Risk Scoring (TS-3)** -- immediate value on every lookup
4. **Quick Query (D-5)** -- low friction entry point, proves the concept

**Rationale:** An investigator can install, connect, and immediately check addresses. This is the minimum viable "does it work?" test.

### Phase 2: Investigation Core

5. **Case Management (TS-4)** -- organizational spine
6. **Transaction Tracing (TS-2)** -- follow the money
7. **Dossier System (TS-5)** -- accumulate findings
8. **Session Memory (TS-9)** -- persist across sessions

**Rationale:** Now investigations can span sessions and accumulate evidence. This is the minimum viable "can I actually investigate?" test.

### Phase 3: Communication & Automation

9. **Money Flow Visualization (TS-6)** -- communicate findings visually
10. **Playbook System (D-1)** -- repeatable workflows
11. **Report Generation (D-6)** -- professional output

**Rationale:** Investigators can now produce deliverables and automate common workflows.

### Phase 4: Operational Maturity

12. **Watcher System (D-3)** -- passive surveillance
13. **Multi-Runtime Support (D-4)** -- expand user base
14. **Mixer/Peeling Chain Analysis (D-7)** -- advanced investigation

**Rationale:** Power features that deepen the toolkit's value for serious investigators.

### Defer

- **Cost Transparency (D-9)**: Build incrementally alongside x402 integration. Add case-level spend tracking when case management ships.
- **Agent-Native Investigation (D-2)**: This is an architecture principle, not a feature to ship. It emerges from building everything else well.
- **Local-First Privacy (D-8)**: Architecture decision made at project inception. No feature work needed -- just maintain the principle.

---

## Sources

### Commercial Platform Analysis
- [Chainalysis Reactor Features](https://www.chainalysis.com/product/reactor/) -- HIGH confidence
- [TRM Forensics Platform](https://www.trmlabs.com/blockchain-intelligence-platform/forensics) -- HIGH confidence
- [Elliptic Investigator](https://www.elliptic.co/platform/investigator) -- HIGH confidence
- [Crystal Intelligence](https://crystalintelligence.com/) -- MEDIUM confidence
- [Crypto Trace Labs Platform Comparison](https://cryptotracelabs.com/blog/chainalysis-vs-elliptic-vs-trm-labs-vs-crystal-intelligence-platform-comparison-for-investigators/) -- HIGH confidence
- [TRM Labs Best AML Solution 2026](https://www.trmlabs.com/resources/blog/what-is-the-best-crypto-aml-and-compliance-solution-in-2026) -- HIGH confidence

### Wallet Monitoring & Alerting
- [CryptocurrencyAlerting Wallet Watch](https://cryptocurrencyalerting.com/wallet-watch.html) -- HIGH confidence
- [MetaSleuth Wallet Tracking](https://metasleuth.io/wallet-tracking-crypto) -- MEDIUM confidence
- [MistTrack AML Tracing](https://misttrack.io/) -- MEDIUM confidence

### Risk Scoring & Sanctions
- [Scorechain Free Sanctions API](https://www.scorechain.com/developers/free-sanction-api) -- HIGH confidence
- [Chainalysis Address Screening](https://www.chainalysis.com/free-cryptocurrency-sanctions-screening-tools/) -- HIGH confidence
- [Elliptic Screening](https://www.elliptic.co/solutions/screening) -- HIGH confidence

### Agent Framework Patterns
- [GSD Framework](https://github.com/gsd-build/get-shit-done/) -- HIGH confidence
- [Claude Code Skills Documentation](https://code.claude.com/docs/en/skills) -- HIGH confidence
- [x402 Protocol](https://www.x402.org/) -- HIGH confidence
- [x402 MCP Monetization Guide](https://eco.com/support/en/articles/14846276-build-an-mcp-server-with-x402-monetization) -- HIGH confidence

### OSINT & Investigation Techniques
- [Crypto OSINT on the Blockchain](https://www.osint.industries/post/crypto-osint-understanding-osint-on-the-blockchain) -- MEDIUM confidence
- [On-Chain Investigation Tools List](https://github.com/OffcierCia/On-Chain-Investigations-Tools-List) -- MEDIUM confidence

### AML Compliance
- [AML Case Management Workflow Guide](https://www.aiprise.com/blog/aml-case-management-workflow-guide) -- MEDIUM confidence
- [FATF Travel Rule 2026](https://sumsub.com/blog/what-is-the-fatf-travel-rule/) -- HIGH confidence

### Technical Infrastructure
- [DuckDB for Blockchain Analytics](https://watsy0007.com/blog/analyzing_blockchain_data_with_duckdb_1/) -- MEDIUM confidence
- [DuckDB Why](https://duckdb.org/why_duckdb) -- HIGH confidence
