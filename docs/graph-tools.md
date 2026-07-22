# Chain Insights Graph Tools

This document covers the graph-facing tools and the result contracts that
agents should rely on during investigations.

Chain Insights workspaces are plain local folders. Graph tools write workspace
evidence and report pointers into the workspace; use live workspace files for
local review and `published/` only for rendered HTML or handoff-ready outputs.

## Chain Insights Graph Surface

The Chain Insights Graph surface is intentionally small:

| Tool | Purpose |
| --- | --- |
| `network_capabilities` | Return supported networks and graph layers when the backend exposes capability metadata |
| `graph_query` | Run one read-only GQL/Cypher query through the universal graph endpoint |
| `graph_query_batch` | Run related read-only graph-language queries as one MCP call |

Chain Insights tools such as `aml_address_risk`,
`aml_trace_victim_funds`, `aml_trace_deposit_sources`, and `aml_trace_suspect_funds` are
recipes built over `graph_query_batch`. They are not assumed to exist on the
Chain Insights Graph endpoint.

The Chain Insights MCP proxy adds product-facing local metadata tools such as
`meta_network_capabilities`, `meta_usage_status`, and `meta_help`. On hosted
backends, `meta_usage_status` can reflect remote quota telemetry. On
primitive-only local backends such as the Bittensor devkit, Chain Insights
returns a local unmetered primitive-backend status instead.

## Query Rules

- `network` is required. Do not guess it in agent workflows.
- GQL/Cypher must be read-only.
- Use `USE topology` for topology (the address / FLOWS_TO / LINKED graph,
  covering unified recent and full historical activity in one graph, plus the
  node `risk_score`/`risk_level` verdict).
- Use `USE facts` for labels, features, assets, and enrichment.
- Use `meta_usage_status` through Chain Insights before public hosted reads
  when you need the caller's remaining free-tier allowance.
- Hosted endpoints can expose a public free tier for graph_query. The default
  is 10 execution seconds per IP per UTC day.
- Prepared wallet users receive the daily free tier first; after it is used,
  x402 payment continues automatically from the configured wallet.
- Use explicit LIMIT and pagination in your query when you want bounded result
  sets.
- Chain Insights Graph does not append `LIMIT`; Chain Insights recipes own their
  own limits and pagination.
- Use single bounded `graph_query` calls for public no-wallet free-tier usage. Use
  `graph_query_batch` for related reads that should share one paid call; public
  free-tier access does not include batches.
- `per_query_timeout_seconds` is optional and capped at `10` by default.
- Returned rows live in `structuredContent.facts`.

Agent installers ship two graph-query skills:

- `chain-insights-cypher`: generic layer selection, schema capture, and
  portable read-only GQL/Cypher examples. Its
  `references/memgraph-examples.md` file includes staging-tested Memgraph-style
  recipes, archive/facts reads, and fixed-hop traversal fallbacks for native
  Memgraph deep traversal syntax that the hosted Chain Insights Graph path may
  reject.
- `chain-insights-bittensor-cypher`: Bittensor-specific schema notes for SS58
  and EVM-pallet addresses under `network=bittensor`.

Check public-free usage:

```bash
chain-insights mcp call meta_usage_status
```

Example single query:

```bash
chain-insights mcp call graph_query \
  network=bittensor \
  "query=USE topology MATCH (a:Address) RETURN a.address AS address, a.network AS network, a.labels AS labels, a.risk_level AS risk_level LIMIT 10"
```

Example batch query:

```bash
chain-insights mcp call graph_query_batch \
  network=bittensor \
  'queries=[{"id":"count","query":"USE topology MATCH (a:Address) RETURN count(a) AS count LIMIT 1"},{"id":"flows","query":"USE topology MATCH (src:Address)-[f:FLOWS_TO]->(dst:Address) RETURN src.address AS source, dst.address AS target, f.amount_usd_sum AS amount_usd_sum, f.tx_count AS tx_count LIMIT 3"},{"id":"linked","query":"USE topology MATCH (a:Address)-[l:LINKED]-(b:Address) RETURN a.address AS address, b.address AS linked_address, l.basis AS basis, l.confidence AS confidence LIMIT 3"}]'
```

Batch calls reserve worst-case execution time from their timeout settings. On
public hosted endpoints, they can ask for paid x402 access even when a small
free-tier allowance remains.

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

`aml_address_risk` screens one address for AML risk, behavior patterns,
neighborhood context, and exchange exposure. Use it as the first tool for a
single-address investigation.

AML tools accept full blockchain addresses directly and return blockchain
addresses as the public result surface — the graph is address-grain, so there
is no identity-resolution step.

Required input:

- `network`
- `address`

Optional input:

- `compare_address`
- `include_attachments`

The tool can emit graph report metadata when attachments are requested. Store
large graph payloads under workspace reports and save compact evidence pointers
to workspace artifacts.

## Trace Tools

All role-specific trace tools return `chain-insights.trace.v1`. The compact
return is for agent reasoning and chaining; durable graph, table, CSV, and
Markdown artifacts stay on disk under the initialized workspace.

Traversal safety is the same across trace tools and manual Cypher fallbacks:
exchange hot wallets are terminal endpoints only. Trace workflows do not expand
from, through, or classify exchange nodes as deposit, suspect, or intermediate
candidates; every non-terminal traversal node must be non-exchange.

### `aml_trace_victim_funds`

Use when the input addresses are victims or trusted source addresses.
The tool traces forward over `FLOWS_TO` to exchange deposit candidates.

Required input:

- `network`
- `victim_addresses`

Optional input:

- `known_suspect_addresses`
- `incident_timestamp_ms`
- `max_hops`
- `include_attachments`

Victim/source addresses are role labels for workflow intent, not risky labels. This tool does not
trace backward from deposits; pass returned
`continuation.candidate_deposit_addresses` to `aml_trace_deposit_sources`.
Deposit candidates are the penultimate non-exchange nodes before exchange
endpoints, not exchange hot wallets themselves.

CLI example:

```bash
cia mcp trace-victim-funds \
  --network bittensor \
  --victim-addresses 5...
```

### `aml_trace_deposit_sources`

Use when the input addresses are suspected deposit/cashout endpoints. The tool
traces backward over `FLOWS_TO` to upstream sources and reports shared-source
convergence.

Required input:

- `network`
- `deposit_addresses`

Optional input:

- `max_hops`
- `include_attachments`

Deposit seeds are not scammers by default. Candidate suspect and victim roles
are hypotheses requiring review. If the supplied seed is already a known
exchange hot wallet, use `aml_address_risk` or a narrow manual exchange-exposure
query instead of treating it as a deposit-source seed.

CLI example:

```bash
cia mcp trace-deposit-sources \
  --network bittensor \
  --deposit-addresses 5...
```

### `aml_trace_suspect_funds`

Use when the input addresses are suspected scammer, mule, operator, or
laundering-ring addresses. The tool traces suspect-controlled funds forward to
cashout topology. `incident_timestamp_ms` is optional.

Required input:

- `network`
- `suspect_addresses`

Optional input:

- `incident_timestamp_ms`
- `max_hops`
- `include_attachments`

CLI example:

```bash
cia mcp trace-suspect-funds \
  --network bittensor \
  --suspect-addresses 5... \
  --max-hops 16
```

## Trace Result Contract

Trace tools return `chain-insights.trace.v1` JSON with this stable top-level
shape:

```json
{
  "schema": "chain-insights.trace.v1",
  "tool": "aml_trace_victim_funds",
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

Trace tools store
`chain-insights.evidence_pointer.v1` evidence entries.
The pointer references workspace-local compact evidence JSON, graph JSON, graph
HTML, CSV or table files, and Markdown reports.

Evidence Markdown should be a provenance record with key facts and pointers.
Large JSON belongs under workspace report directories, not inline in evidence.

After evidence is collected, keep workspace notes and `published/` artifacts in
sync for a handoff. Use workspace-generated graph JSON, graph HTML, table
extracts, and Markdown reports as the review surface over canonical workspace
artifacts.

## Runtime Schema Capture

Fresh workspaces include a runtime schema skill and schema capture directory.
Before the first graph query against a network, capture the live graph schema and
use the observed labels, relationship types, and property names in subsequent
queries. The current public Chain Insights Graph investigation network is
Bittensor only; do not infer support for unadvertised networks from internal
database names or historical examples.

Useful schema probes:

```bash
cia mcp call graph_query_batch \
  network=bittensor \
  per_query_timeout_seconds=5 \
  'queries=[{"id":"address_sample","query":"USE topology MATCH (a:Address) RETURN a.address AS address, a.network AS network, a.labels AS labels, a.risk_level AS risk_level, a.is_exchange AS is_exchange LIMIT 10"},{"id":"flow_sample","query":"USE topology MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address) RETURN src.address AS from_address, dst.address AS to_address, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count LIMIT 10"},{"id":"linked_sample","query":"USE topology MATCH (a:Address)-[l:LINKED]-(b:Address) RETURN a.address AS address, b.address AS linked_address, b.network AS linked_network, l.basis AS basis, l.confidence AS confidence LIMIT 10"},{"id":"node_metric_sample","query":"USE topology MATCH (a:Address) RETURN a.address AS address, a.tx_out_count AS tx_out_count LIMIT 10"}]'
```

Use endpoint-safe property projections like `a.address` and `flow.tx_count`
in probes. Metadata
functions such as `keys()`, `labels()`, and `type()` are not portable across
every Chain Insights Graph layer.
