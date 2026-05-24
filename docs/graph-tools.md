# Chain Insights Graph Tools

This document covers the graph-facing tools and the result contracts that
agents should rely on during investigations.

## Graph MCP Surface

The Go Graph MCP public graph surface is intentionally small:

| Tool | Purpose |
| --- | --- |
| `graph_query` | Run one read-only GQL/Cypher query through the universal graph endpoint |
| `graph_query_batch` | Run related read-only graph-language queries as one MCP call |

High-level AML tools such as `address_risk`, `track_funds`, and
`scam_topology` are Chain Insights recipes built over `graph_query_batch`.
They are not assumed to exist on the Go Graph MCP endpoint.

## Query Rules

- `network` is required. Do not guess it in agent workflows.
- GQL/Cypher must be read-only.
- Use `USE live_topology` for Memgraph RAM topology.
- Use `USE archive_topology` for StarRocks historical topology.
- Use `USE facts` for StarRocks facts.
- Use `graph_query_batch` for related reads that should share one paid call.
- `per_query_timeout_seconds` is optional and capped at `600`.
- Returned rows live in `structuredContent.facts`.

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
    "per_query_timeout_seconds": 600,
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

## Track Funds

`track_funds` traces funds from trusted victim/source addresses through
intermediaries to exchange deposit candidates.

Required input:

- `network`
- `trusted_addresses`

Optional input:

- `untrusted_addresses`
- `max_hops`
- `min_amount_sum`
- `per_address_limit`
- `case_id`
- `include_attachments`

Victim/source addresses are case roles, not risky labels. The tool returns
investigator-ready flow summaries and, when a case is provided, stores compact
evidence pointers in the active workspace.

CLI example:

```bash
cia mcp track-funds \
  --network bittensor \
  --trusted-addresses 5... \
  --case 1
```

## Scam Topology

`scam_topology` expands the topology around a known victim incident so the
result can produce reviewable scam-label inputs for ML and analyst workflows.

Contract summary: victim-only traversal is outward from victim/source funds;
the primary graph is a node-relative novelty wave with non-expanding
convergence edges; exchange terminal safety; `scam_labels` are ML-ready flags;
label candidates are reviewable, not automatic writes.

Required input:

- `network`
- `victim_address`
- `incident_timestamp_ms`
- `max_hops`

Optional input:

- `activity_policy`
- `case_id`
- `include_attachments`

CLI examples:

```bash
cia mcp scam-topology \
  --network bittensor \
  --victim-address 5... \
  --incident-timestamp-ms 1715532228001 \
  --max-hops 16
```

```bash
cia mcp scam-topology \
  --network bittensor \
  --victim-address 5... \
  --incident-timestamp-ms 1715532228001 \
  --max-hops 16 \
  --activity-policy global_incident_only \
  --case 1
```

### Traversal Semantics

`scam_topology` starts from one victim/source address and
`incident_timestamp_ms`, then runs directed `FLOWS_TO` traversal outward from
that victim incident.

The default traversal is `node_relative_only`. Each new node expands only once.
Repeated targets are retained as non-expanding `convergence_edge` context.
Downstream edges must have `first_seen_timestamp` or `last_seen_timestamp`
greater than or equal to the current node's wave-arrival timestamp.

The alternate policy is `global_incident_only`. In that mode every wave is
filtered against the original `incident_timestamp_ms`.

Exchange terminal safety is the only hard-coded terminal class. Other labels
are generic context hints. Victim/source addresses, exchange endpoints, and
generic labeled context nodes are not automatic scam labels.

### Result Contract

`scam_topology` returns `chain-insights.result.v1` JSON with this stable
top-level shape:

```json
{
  "schema": "chain-insights.result.v1",
  "tool": "scam_topology",
  "facts": {
    "network": "bittensor",
    "victim_address": "5...",
    "incident_timestamp_ms": 1715532228001,
    "topology_graphs": ["live_topology"],
    "primary_activity_policy": "node_relative",
    "activity_policy_mode": "node_relative_only",
    "topology_edges": [],
    "intermediaries": [],
    "terminal_points": [],
    "exchange_deposits": [],
    "investigation_hints": [],
    "scam_labels": [],
    "label_candidates": [],
    "case_roles": [],
    "safety_decisions": [],
    "runs": [
      {
        "graph_scope": "incident",
        "topology_graph": "live_topology",
        "activity_policy": "node_relative",
        "primary": true
      }
    ]
  }
}
```

The tool returns ML-ready `scam_labels` plus `label_candidates` for analyst
review before any write to warehouse address labels.

## Graph Reports

Graph reports use `chain-insights.graph.v1` JSON. Visual edges use the
canonical `source` / `target` convention.

For `scam_topology`:

- Primary victim-flow edges are emitted in `flows`.
- Exchange deposit candidates are emitted in `deposits`.
- Deposit-cluster enrichment is emitted in `reverse_leads`.
- Deposit-cluster enrichment is not emitted as primary victim-flow topology.

For `track_funds`, the same graph report shape is used so renderers and import
helpers can share one parser.

When `case_id` or CLI `--case` is provided, `track_funds` and
`scam_topology` store `chain-insights.evidence_pointer.v1` evidence entries.
The pointer references workspace-local compact evidence JSON, graph JSON, graph
HTML, CSV or table files, and Markdown reports.

Evidence Markdown should be a provenance record with key facts and pointers.
Large JSON belongs under workspace report directories, not inline in evidence.

## Runtime Schema Capture

Fresh workspaces include a runtime schema skill and schema capture directory.
Before the first case query against a network, capture the live graph schema and
use the observed labels, relationship types, and property names in subsequent
queries.

Useful schema probes:

```bash
cia mcp call graph_query_batch \
  network=bittensor \
  'queries=[{"id":"live_address_sample","query":"USE live_topology MATCH (n:Address) RETURN n.address AS address, n.labels AS labels LIMIT 5"},{"id":"archive_flow_sample","query":"USE archive_topology MATCH (src:Address)-[f:FLOWS_TO]->(dst:Address) RETURN src.address AS source, dst.address AS target, f.period_granularity AS granularity LIMIT 5"},{"id":"facts_sample","query":"USE facts MATCH (a:Address)-[:HAS_FEATURE]->(f:AddressFeature) RETURN a.address AS address, f.sent_count AS sent_count LIMIT 5"}]'
```
