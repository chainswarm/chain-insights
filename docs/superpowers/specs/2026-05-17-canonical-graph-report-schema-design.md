# Canonical Graph Report Schema Design

## Context

Chain Insights currently writes graph visualization JSON in more than one place:

- `reports/graphs/*.graph.json`
- `artifacts/<artifact-id>/graph.json`

The `artifacts/` copy was added to give the MCP app iframe a local URL to fetch,
but this duplicates the graph report data and makes storage ownership unclear.
The intended model is a local report server: Hono should serve existing
workspace report files, not create a second canonical graph store.

The current graph JSON also mixes several incompatible concepts:

- Memgraph system labels such as `Address`, `Exchange`, `Miner`, and `Subnet`
  are sometimes copied into JSON `labels`.
- App-invented fields such as `entity_kind`, `raw_labels`, and
  `address_type: "wallet"` obscure source data.
- Graph and table outputs are not clearly separated for generic Cypher query
  tools.

Live Bittensor schema discovery through the fixed Go MCP endpoint confirmed:

- `address_type` is real and populated: `substrate` and `evm`.
- `address_subtypes` currently returns no rows and must remain optional.
- `labels(n)` returns Memgraph system labels.
- `n.labels` returns display/domain labels such as `Binance`, `Kraken`,
  `validator`, `miner subnet 27`, and `exchange`.

## Goals

- Keep `chain-insights.graph.v1` as the canonical graph JSON schema because the
  product is not live and does not need a v2 compatibility window.
- Make `reports/graphs/*.graph.json` the only canonical graph JSON location.
- Serve graph report JSON through Hono without copying it to `artifacts/`.
- Ensure graph-capable MCP tools return report-backed graph URLs when they
  produce graph visualization data.
- Keep graph output and table output as separate report formats.
- Preserve real source fields and remove misleading compatibility fields.

## Non-Goals

- Do not preserve backward compatibility with old `artifacts/<id>/graph.json`
  graph storage.
- Do not support dual-write v1/v2 graph schemas.
- Do not infer a graph from arbitrary tabular Cypher results.
- Do not migrate old local graph artifacts in this change.

## Canonical Graph JSON

The first-level shape remains:

```json
{
  "schema": "chain-insights.graph.v1",
  "nodes": [],
  "edges": []
}
```

Optional top-level metadata may remain when it describes the report, for
example `metadata.generated_at`, `metadata.network`, or `metadata.seed_address`.
Tool-specific analysis arrays may remain only when they are clearly auxiliary
to the graph report. They are not the graph model itself.

### Nodes

Required node fields:

```json
{
  "id": "5...",
  "node_type": "address",
  "address": "5...",
  "labels": []
}
```

Address nodes may include source-backed address fields:

```json
{
  "id": "5...",
  "node_type": "address",
  "address": "5...",
  "address_type": "substrate",
  "address_subtypes": ["future-source-value"],
  "labels": ["Binance"],
  "roles": ["exchange"]
}
```

Rules:

- `node_type` is the Chain Insights graph model type.
- `address_type` is source data. For Bittensor it is currently `substrate` or
  `evm`.
- `address_subtypes` is optional and omitted when absent or empty.
- `labels` comes from the node property `n.labels`, not from Memgraph
  `labels(n)`.
- `roles` carries investigation or visualization roles such as `seed`,
  `deposit_candidate`, `exchange`, `lead`, or `subject`.
- System labels may inform `node_type` and `roles`, but must not be copied into
  display `labels`.

Forbidden node fields:

- `entity_kind`
- `raw_labels`
- app-invented `address_type` values such as `wallet`
- compatibility-only `pattern_flags` when `flags` is the normalized field

### Edges

Required edge fields:

```json
{
  "source": "5...",
  "target": "5...",
  "edge_type": "flows_to"
}
```

Flow edges may include source-backed fields:

```json
{
  "source": "5...",
  "target": "5...",
  "edge_type": "flows_to",
  "amount_sum": 123,
  "amount_usd_sum": 456,
  "tx_count": 7,
  "first_tx_id": "block-index",
  "last_tx_id": "block-index"
}
```

Rules:

- `edge_type` is normalized from relationship type, for example
  `FLOWS_TO -> flows_to`.
- `source` and `target` are canonical endpoint ids.
- `from_address` and `to_address` are compatibility fields and should be
  removed from canonical writers. Readers may tolerate them during the cleanup.

## Graph And Table Output Discriminator

Graph format and table format are separate report outputs.

Graph-shaped results:

- explicit graph payloads;
- rows containing nodes, relationships, paths, or projected source/target
  relationship data intended for visualization;
- high-level investigation tools that construct visualization data.

Graph-shaped results are normalized to canonical graph JSON, written under
`reports/graphs/`, and returned through graph app metadata.

Table-shaped results:

- aggregate counts;
- schema discovery;
- property distributions;
- arbitrary Cypher row sets;
- summary rows not intended as a visualization.

Table-shaped results are table outputs. They must not create graph JSON and
must not return graph app metadata.

Ambiguous generic query results are treated as table-shaped. The user can rerun
with a graph-oriented query or projection when they want visualization.

## Tool Behavior

### `address_risk`

`address_risk` may produce both graph and table-shaped report data. When graph
visualization data is produced:

- write one canonical graph JSON file under `reports/graphs/`;
- return `_meta.chainInsights.graph.url` pointing to the Hono report URL;
- do not write `artifacts/<id>/graph.json`.

Any tabular details remain in structured content or `reports/tables/` according
to the tool's persistence policy.

### `track_funds`

`track_funds` may produce graph, table, Markdown, and HTML report files. Its
graph visualization data must be the same canonical graph JSON file referenced
by the Markdown/HTML report and by MCP metadata.

It must not create a second graph JSON copy under `artifacts/`.

### `graph_query` and `graph_query_batch`

Generic graph query tools decide output by result shape:

- graph-shaped result: write canonical graph JSON under `reports/graphs/` and
  return graph metadata;
- table-shaped result: return table/structured content and optionally persist
  table output;
- ambiguous result: treat as table output.

They must not invent graph JSON from aggregate or schema rows.

## Hono Serving

Hono serves canonical graph report JSON through:

```text
GET /graph-reports/:filename
```

Rules:

- `filename` must match a safe graph report pattern, for example
  `[A-Za-z0-9._-]+\.graph\.json`.
- Resolve only under workspace `reports/graphs/`.
- Reject traversal and symlink escapes.
- Return `Content-Type: application/json`.
- Allow local graph app iframe fetches with CORS.

MCP metadata uses:

```json
{
  "_meta": {
    "chainInsights": {
      "graph": {
        "schema": "chain-insights.graph.v1",
        "url": "http://127.0.0.1:<port>/graph-reports/<filename>.graph.json"
      }
    }
  }
}
```

Opaque artifact ids are no longer part of graph report metadata.

## Implementation Boundaries

Create one shared graph report writer responsible for:

- validating or normalizing `chain-insights.graph.v1`;
- writing `reports/graphs/*.graph.json`;
- producing the Hono URL;
- starting or ensuring the local Hono server when needed.

Existing `writeGraphArtifact` behavior should be removed or renamed so graph
writers do not accidentally use `artifacts/`.

The graph normalizer should become the schema boundary. Tool-specific builders
should produce clear source-backed fields, and the normalizer should reject or
strip old compatibility fields.

## Error Handling

- Unsupported graph payload schema: fail with a clear error.
- Invalid graph-shaped payload: fail before writing a report file.
- Missing workspace: fail; do not fall back to `~/.chain-insights`.
- Invalid report filename: return HTTP 400.
- Missing report graph: return HTTP 404.
- Path traversal or symlink escape: return HTTP 400 or 404 without leaking
  filesystem paths.
- Generic query shape cannot be classified as graph: return table output, not
  an error.

## Testing

Unit tests:

- normalizer emits `node_type` and `edge_type`;
- normalizer preserves source `address_type`;
- normalizer omits absent `address_subtypes`;
- normalizer uses `n.labels` display labels and strips system labels;
- normalizer rejects or strips `entity_kind`, `raw_labels`, invented `wallet`
  address type, `from_address`, and `to_address`;
- graph/table discriminator classifies aggregate rows as table;
- graph/table discriminator classifies explicit source/target relationships as
  graph.

Server tests:

- `GET /graph-reports/:filename` serves `reports/graphs/*.graph.json`;
- invalid filenames are rejected;
- traversal and symlink escapes are rejected;
- missing graph reports return 404.

MCP proxy/tool tests:

- `address_risk` graph metadata points to `/graph-reports/`;
- `track_funds` graph metadata points to the same report graph JSON referenced
  by its report output;
- `graph_query_batch` with aggregate rows does not return graph metadata;
- graph-shaped query output returns graph metadata;
- no test expects `artifacts/<id>/graph.json` for graph visualization.

Integration smoke:

- run local Bittensor Go MCP on `8012`;
- call `address_risk`, `track_funds`, and graph-shaped/table-shaped
  `graph_query_batch`;
- fetch each returned graph URL through Hono;
- verify no graph JSON is written under `artifacts/`.
