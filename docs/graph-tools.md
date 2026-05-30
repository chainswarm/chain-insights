# Chain Insights Graph Tools

This document covers the graph-facing tools and the result contracts that
agents should rely on during investigations.

## Graph MCP Surface

The GraphRAG MCP public graph surface is intentionally small:

| Tool | Purpose |
| --- | --- |
| `usage_status` | Return the caller's public free graph_query quota for the current UTC day |
| `graph_query` | Run one read-only GQL/Cypher query through the universal graph endpoint |
| `graph_query_batch` | Run related read-only graph-language queries as one MCP call |

Chain Insights AML tools such as `address_risk`, `stake_insights`,
`trace_victim_funds`, `trace_deposit_sources`, and `trace_suspect_funds` are
recipes built over `graph_query_batch`. They are not assumed to exist on the
GraphRAG MCP endpoint.

## Query Rules

- `network` is required. Do not guess it in agent workflows.
- GQL/Cypher must be read-only.
- Use `USE live_topology` for recent topology.
- Use `USE archive_topology` for historical topology.
- Use `USE facts` for labels, features, risk scores, assets, and enrichment.
- Use `usage_status` before public hosted reads when you need the caller's
  remaining free quota.
- Hosted endpoints can expose a public free graph_query quota. The default is
  10 execution seconds per IP per UTC day.
- Use explicit LIMIT and pagination in your query when you want bounded result
  sets.
- The GraphRAG MCP server does not append `LIMIT`; Chain Insights recipes own
  their own limits and pagination.
- Use `graph_query_batch` for related reads that should share one paid call.
- `per_query_timeout_seconds` is optional and capped at `10` by default.
- Returned rows live in `structuredContent.facts`.

Agent installers ship two graph-query skills:

- `chain-insights-cypher`: generic layer selection, schema capture, and
  portable read-only GQL/Cypher examples. Its
  `references/memgraph-examples.md` file includes staging-tested Memgraph-style
  recipes, archive/facts reads, and fixed-hop traversal fallbacks for native
  Memgraph deep traversal syntax that the hosted GraphRAG MCP path may reject.
- `chain-insights-bittensor-cypher`: Bittensor-specific schema notes for SS58
  and EVM-pallet addresses under `network=bittensor`.

Check public-free usage:

```bash
chain-insights mcp call usage_status
```

Example single query:

```bash
chain-insights mcp call graph_query \
  network=bittensor \
  "query=USE live_topology MATCH (n) WHERE n.address IS NOT NULL RETURN n.labels AS labels, n.address AS address LIMIT 10"
```

Example batch query:

```bash
chain-insights mcp call graph_query_batch \
  network=bittensor \
  'queries=[{"id":"count","query":"USE live_topology MATCH (n) RETURN count(n) AS count LIMIT 1"},{"id":"archive_flows","query":"USE archive_topology MATCH (src:Address)-[f:FLOWS_TO]->(dst:Address) RETURN f.period_granularity AS granularity, src.address AS source, dst.address AS target LIMIT 3"}]'
```

Batch result facts include:

```json
{
  "batch": {
    "count": 2,
    "completed": 2,
    "failed": 0,
    "per_query_timeout_seconds": 10,
    "total_query_elapsed_ms": 1345,
    "billable_seconds": 2,
    "estimated_usdc": "0.02"
  }
}
```

## Address Risk

`address_risk` screens one address for AML risk, behavior patterns,
neighborhood context, and exchange exposure. Use it as the first tool for a
single-address investigation.

Required input:

- `network`
- `address`

Optional input:

- `compare_address`
- `include_attachments`

The tool can emit graph report metadata when attachments are requested. Store
large graph payloads under workspace reports and save compact evidence pointers
to cases.

## Trace Tools

All role-specific trace tools return `chain-insights.trace.v1`. The compact
return is for agent reasoning and chaining; durable graph, table, CSV, and
Markdown artifacts stay on disk under the initialized workspace.

Traversal safety is the same across trace tools and manual Cypher fallbacks:
exchange hot wallets are terminal endpoints only. Trace workflows do not expand
from, through, or classify exchange nodes as deposit, suspect, or intermediate
candidates; every non-terminal traversal node must be non-exchange.

### `trace_victim_funds`

Use when the input addresses are victims or trusted stolen-source addresses.
The tool traces forward over `FLOWS_TO` to exchange deposit candidates.

Required input:

- `network`
- `victim_addresses`

Optional input:

- `known_suspect_addresses`
- `incident_timestamp_ms`
- `max_hops`
- `min_amount_sum`
- `per_address_limit`
- `case_id`
- `include_attachments`

Victim/source addresses are case roles, not risky labels. This tool does not
trace backward from deposits; pass returned
`continuation.candidate_deposit_addresses` to `trace_deposit_sources`.
Deposit candidates are the penultimate non-exchange nodes before exchange
endpoints, not exchange hot wallets themselves.

CLI example:

```bash
cia mcp trace-victim-funds \
  --network bittensor \
  --victim-addresses 5... \
  --case 1
```

### `trace_deposit_sources`

Use when the input addresses are suspected deposit/cashout endpoints. The tool
traces backward over `FLOWS_TO` to upstream sources and reports shared-source
convergence.

Required input:

- `network`
- `deposit_addresses`

Optional input:

- `max_hops`
- `case_id`
- `include_attachments`

Deposit seeds are not scammers by default. Candidate suspect and victim roles
are hypotheses requiring review. If the supplied seed is already a known
exchange hot wallet, use `address_risk` or a narrow manual exchange-exposure
query instead of treating it as a deposit-source seed.

CLI example:

```bash
cia mcp trace-deposit-sources \
  --network bittensor \
  --deposit-addresses 5... \
  --case 1
```

### `trace_suspect_funds`

Use when the input addresses are suspected scammer, mule, operator, or
laundering-ring addresses. The tool traces suspect-controlled funds forward to
cashout topology. `incident_timestamp_ms` is optional.

Required input:

- `network`
- `suspect_addresses`

Optional input:

- `incident_timestamp_ms`
- `max_hops`
- `min_amount_sum`
- `per_address_limit`
- `case_id`
- `include_attachments`

CLI example:

```bash
cia mcp trace-suspect-funds \
  --network bittensor \
  --suspect-addresses 5... \
  --max-hops 16 \
  --case 1
```

## Stake Insights

`stake_insights` explains Bittensor staking behavior around one address,
coldkey, or hotkey. It keeps stake semantics separate from generic money-flow
semantics and reads direct `STAKES_IN` relationships from the graph endpoint.

Required input:

- `network`
- exactly one of `address`, `coldkey`, or `hotkey`

Optional input:

- `netuid`
- `start_timestamp_ms`
- `end_timestamp_ms`
- `start_block`
- `end_block`
- `depth`
- `include_attachments`

The first release returns direct coldkey-hotkey-netuid stake relationships. The
current GraphRAG stake parity surface supports timestamp windows; block windows
are accepted by the tool contract but fail explicitly until the backend exposes
block-range fields.

Result facts include:

- `stake_totals`: total staked, total unstaked, moved-in/out amounts, net
  staked, first activity, and last activity.
- `active_relationships`: coldkey-hotkey-netuid relationships with amount,
  event counts, first/last activity, transaction ids when present, topology
  graph, and source backend.
- `stake_movements`: aggregate `stake_added`, `stake_removed`,
  `stake_moved_in`, and `stake_moved_out` movement rows.
- `top_counterparties`: counterparties ranked by stake amount.
- `query_evidence`: `graph_query_batch` query ids, topology graph, row counts,
  source backends, and partial errors.

CLI examples:

```bash
cia mcp stake-insights \
  --network bittensor \
  --coldkey 5... \
  --netuid 19
```

```bash
cia mcp call stake_insights \
  network=bittensor \
  address=5... \
  netuid=19 \
  start_timestamp_ms=1769126300000 \
  end_timestamp_ms=1769126600000
```

## Trace Result Contract

Trace tools return `chain-insights.trace.v1` JSON with this stable top-level
shape:

```json
{
  "schema": "chain-insights.trace.v1",
  "tool": "trace_victim_funds",
  "network": "bittensor",
  "input": { "addresses": ["5..."], "seed_role": "victim", "max_hops": 3 },
  "summary": { "seed_count": 1, "path_count": 0, "edge_count": 0 },
  "addresses": [],
  "edges": [],
  "paths": [],
  "convergence": [],
  "exchange_exposure": [],
  "candidate_labels": [],
  "artifacts": {},
  "evidence": [],
  "continuation": {
    "candidate_deposit_addresses": [],
    "candidate_suspect_addresses": [],
    "candidate_victim_addresses": [],
    "recommended_next_tools": []
  },
  "warnings": []
}
```

Candidate labels are reviewable hypotheses. They are not automatic writes to
warehouse address labels and carry `promote_to_core_label: false`.

## Graph Reports

Graph reports use `chain-insights.graph.v1` JSON. Visual edges use the
canonical `source` / `target` convention.

Trace graph reports emit primary flow edges in `flows`, exchange deposit
candidates in `deposits`, and reverse/source enrichment only when the selected
tool actually performs traceback.

When `case_id` or CLI `--case` is provided, trace tools store
`chain-insights.evidence_pointer.v1` evidence entries.
The pointer references workspace-local compact evidence JSON, graph JSON, graph
HTML, CSV or table files, and Markdown reports.

Evidence Markdown should be a provenance record with key facts and pointers.
Large JSON belongs under workspace report directories, not inline in evidence.

After a case has useful evidence, run `cia case evidence verify <case-id>` and
`cia case export <case-id> --target obsidian-llmwiki --mode private` to produce
an Obsidian, LLM Wiki, and agent-friendly bundle. The export uses
`manifest.chain-insights.json`, `graph.chain-insights.json`, `Graph.canvas`,
Markdown evidence/entity notes, and agent prompt files as views over the
canonical case evidence and report artifacts. Install and ingestion steps live
in [Knowledge exports](knowledge-exports.md).

## Runtime Schema Capture

Fresh workspaces include a runtime schema skill and schema capture directory.
Before the first case query against a network, capture the live graph schema and
use the observed labels, relationship types, and property names in subsequent
queries. Different networks can expose different fact nodes and relationship
properties, so do not assume a query that works on Bittensor will work on Base,
Ethereum, or TRON without a fresh schema probe.

Useful schema probes:

```bash
cia mcp call graph_query_batch \
  network=bittensor \
  per_query_timeout_seconds=5 \
  'queries=[{"id":"live_address_sample","query":"USE live_topology MATCH (n:Address) RETURN n.address AS address, n.labels AS labels, n.is_exchange AS is_exchange LIMIT 10"},{"id":"live_flow_sample","query":"USE live_topology MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address) RETURN src.address AS from_address, dst.address AS to_address, flow.amount_sum AS amount_sum, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count LIMIT 10"},{"id":"archive_flow_sample","query":"USE archive_topology MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address) RETURN src.address AS from_address, dst.address AS to_address, flow.period_granularity AS period_granularity, flow.amount_sum AS amount_sum, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count LIMIT 10"},{"id":"facts_address_sample","query":"USE facts MATCH (a:Address) RETURN a.address AS address, a.labels AS labels, a.is_exchange AS is_exchange LIMIT 10"}]'
```

Use projections like `n.address` and `flow.tx_count` in probes. Metadata
functions such as `keys()`, `labels()`, and `type()` are not portable across
every GraphRAG MCP layer.
