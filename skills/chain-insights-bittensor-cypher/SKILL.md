---
name: chain-insights-bittensor-cypher
description: Use when writing Chain Insights graph_query or graph_query_batch reads for network=bittensor, Bittensor SS58 and EVM-pallet addresses, TAO FLOWS_TO, hotkey/coldkey/neuron facts, or Bittensor-specific schema checks.
---

# Chain Insights Bittensor Cypher

Load `chain-insights-cypher` first for generic layer rules. This skill adds the
Bittensor address-grain schema and examples.

## Network Rule

All Bittensor investigation runs on ONE public network: `network=bittensor`.
Native Substrate/SS58 addresses such as `5...` and EVM-pallet `0x...` (H160)
addresses live in the same graph:

- Always pass `network=bittensor` — for SS58 and `0x...` inputs alike. There
  is no separate public query network for the EVM-pallet space.
- The SS58/H160 split is the `:Address.network` node PROPERTY
  (`bittensor` for SS58, `bittensor_evm` for H160) — a per-node value, not a
  `network` argument.
- `FLOWS_TO` stays within one address space; a single `network=bittensor`
  query spans both spaces by walking `FLOWS_TO` within a space and hopping
  the bridge (money) or `LINKED` (ownership) edge across the boundary —
  SS58 → (bridge or LINKED) → H160 and back, with no network switch.
- `LINKED` (undirected, `basis`/`confidence`/`source_event`/`declared_owner`)
  is the ownership edge across the space boundary — use it for cross-space
  resolution, never assume the two spaces share a `FLOWS_TO`-reachable graph.
- Preserve exact returned `address` and `network` fields.

### Scope every non-exact `:Address` match by `a.network`

`bittensor` and `bittensor_evm` are **two views over ONE address-grain
topology graph**. Passing `network=bittensor` selects the GRAPH; it does not
select the addresses inside it. Both spaces are in the same topology shards,
and only the `:Address.network` node property separates them.

```cypher
-- WRONG: sweeps SS58 and H160 addresses together
USE topology MATCH (a:Address) RETURN a.address AS address LIMIT 100

-- RIGHT
USE topology MATCH (a:Address) WHERE a.network = "bittensor_evm"
RETURN a.address AS address LIMIT 100
```

An unscoped sweep publishes wrong-space results at double the metered cost.
Exact-address matches (`MATCH (a:Address {address: "0x…"})`) are exempt: the
address is already a unique key, and scoping one fails closed on an H160
address screened under `network=bittensor`.

`USE facts` inverts this. Facts is the one place each network gets its own
backing database (reported as `facts.routing.starrocks_database=bittensor`), so
the facts `Address` label carries **no mapped `network` property at all** —
projecting `a.network` there fails with
`unknown graph identifier: property "network" is not mapped on label "Address"`.
`Address` is served on facts only as a `TRANSFER` endpoint; a single-node
`MATCH (a:Address)` is refused. Read `network` on `USE topology`.

## Current Schema Notes

Observed against the address-serving contract on 2026-07-07:

- `meta_network_capabilities` advertises `bittensor` as the single public
  investigation network with topology, facts, risk, `graph_query`, and
  `graph_query_batch` available.
- `topology` uses `Address` nodes and `FLOWS_TO` relationships, keyed by
  the raw chain-native `address` (SS58 or `0x...`), plus a `network` property
  (`bittensor` / `bittensor_evm`) marking the address space. One unified graph
  serves the full lifetime history — there is no separate historical tier to
  opt into.
- `FLOWS_TO` is USD-only for AML value. Use `amount_usd_sum`, not native
  `amount_sum`. Edges are lifetime aggregates (first/last endpoints only).
- `facts` serves bounded individual transfer rows via
  `(from:Address)-[t:TRANSFER]->(to:Address)` (properties: `amount`,
  `amount_usd`, `asset_symbol`, `asset_contract`, `tx_id`, `block_height`,
  `block_timestamp`, `event_index`, `edge_index`, `price_usd`,
  `price_missing`) — every `TRANSFER` query requires an indexed predicate
  (address equality on either endpoint, or `WHERE t.tx_id = "..."`); a bare
  `LIMIT` alone is rejected. Lifetime address metrics are node properties
  on `USE topology`, not facts. Neuron identity, hotkey/coldkey
  pairing, and IP/axon-port observation live on the topology `:Neuron`
  node and `MINES`/`VALIDATES`/`HOTKEY_OF`/`COLDKEY_OF` edges, not on
  `facts`. Labels and per-label risk live on the topology address node
  (`labels` array + `label_risk` entries), not on `facts`.
- Use the generic skill reference `references/memgraph-examples.md` for tested
  examples and fixed-hop traversal fallbacks. Native Memgraph deep traversal
  operators such as `*BFS`, `*WSHORTEST`, `*ALLSHORTEST`, and `*KSHORTEST` may
  not be portable across the Chain Insights Graph federation path.

## Bittensor Shapes

Topology address grain (covers full lifetime history):

```cypher
USE topology
MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address)
RETURN src.address AS from_address,
       dst.address AS to_address,
       flow.amount_usd_sum AS amount_usd_sum,
       flow.tx_count AS tx_count,
       flow.first_seen_timestamp AS first_seen_timestamp,
       flow.last_seen_timestamp AS last_seen_timestamp
LIMIT 25
```

`LINKED` ownership-overlay lookup (cross-space, `bittensor` <-> `bittensor_evm`):

```cypher
USE topology
MATCH (a:Address {address: "5Ggf..."})-[l:LINKED]-(b:Address)
RETURN a.address AS address,
       b.address AS linked_address,
       b.network AS linked_network,
       l.basis AS basis,
       l.confidence AS confidence,
       l.source_event AS source_event,
       l.declared_owner AS declared_owner
LIMIT 25
```

Lifetime node metrics, on the topology graph:

```cypher
USE topology
MATCH (address:Address {address: "FULL_ADDRESS"})
RETURN address.address AS address,
       address.tx_out_count AS tx_out_count,
       address.tx_in_count AS tx_in_count
LIMIT 1
```

Individual transfer rows, bounded by an address endpoint predicate:

```cypher
USE facts
MATCH (from:Address {address: "5Ggf..."})-[t:TRANSFER]->(to:Address)
RETURN to.address AS to_address,
       t.tx_id AS tx_id,
       t.block_height AS block_height,
       t.amount_usd AS amount_usd,
       t.asset_symbol AS asset_symbol
LIMIT 25
```

`TRANSFER` requires an indexed predicate on every query — address equality on
either endpoint, or `WHERE t.tx_id = "..."` — regardless of `LIMIT`, since
`facts_transfers_view` is a full transfer-history table.

## Schema Probe

Use this before a custom Bittensor query session:

```bash
cia mcp call graph_query_batch \
  network=bittensor \
  per_query_timeout_seconds=5 \
  'queries=[{"id":"address_projection","query":"USE topology MATCH (a:Address) RETURN a.address AS address, a.network AS network, a.labels AS labels, a.risk_score AS risk_score, a.risk_level AS risk_level, a.is_exchange AS is_exchange LIMIT 10"},{"id":"flow_sample","query":"USE topology MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address) RETURN src.address AS from_address, dst.address AS to_address, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count LIMIT 10"},{"id":"linked_sample","query":"USE topology MATCH (a:Address)-[l:LINKED]-(b:Address) RETURN a.address AS address, b.address AS linked_address, b.network AS linked_network, l.basis AS basis, l.confidence AS confidence LIMIT 10"},{"id":"node_metric_sample","query":"USE topology MATCH (a:Address) RETURN a.address AS address, a.tx_out_count AS tx_out_count LIMIT 10"}]'
```

Avoid `keys()`, `labels()`, `type()`, native BFS syntax, and variable-length
paths in schema probes. They may be valid in a direct Memgraph console but are
not portable across the Chain Insights Graph federation path.

## Connectivity Checks: BFS First

When the question is "is address A connected to address B" — for example,
victim → exchange — default to one bounded BFS path query. Do not start with
manual hop-by-hop `FLOWS_TO` expansion.

```cypher
USE topology
MATCH path=(a:Address {address: "SOURCE_ADDRESS"})-[:FLOWS_TO *BFS]->(b:Address {address: "TARGET_ADDRESS"})
RETURN size(path) AS hops
LIMIT 1
```

Rules (observed live 2026-07-29):

- **Plain `*BFS` is the default.** Do not add hop bounds to a connectivity
  check. If the endpoint refuses with "unbounded traversal is not
  permitted", that is the Chain Insights Graph server depth guard
  (`MCP_MAX_TRAVERSAL_DEPTH`, default 5) — raise the guard on the
  deployment; do not paper over it with an arbitrary bound in the query.
- **BFS runs on one shard only.** With more than one covering shard the
  federation refuses with `cross_shard_unsafe_path`. Path stitching across
  shards is a permanent non-goal.
- **Narrow shards with `time_scope`.** Pass it as a `graph_query` argument:
  `time_scope=recent` selects the single live shard. `since_timestamp:<ms>`
  works only when it overlaps exactly one shard; the live shard is
  open-ended, so a historical lower bound usually still selects 2+ shards.

```bash
cia mcp call graph_query network=bittensor time_scope=recent \
  'query=USE topology MATCH path=(a:Address {address: "SOURCE"})-[:FLOWS_TO *BFS]->(b:Address {address: "TARGET"}) RETURN size(path) AS hops LIMIT 1'
```

- **Cross-shard or historical connectivity:** use the `aml_trace_*` tools or
  generated fixed-hop `FLOWS_TO` batches. They federate hop by hop and merge
  client-side, so shard boundaries do not hide paths.
- **Never name a node variable `in`.** It is a reserved keyword and fails the
  federation parser with a misleading `cross_shard_unsafe_path` error.

## Investigation Patterns

Outflows from a Bittensor address:

```bash
cia mcp call graph_query \
  network=bittensor \
  'query=USE topology MATCH (src:Address {address: "5Ggf..."})-[flow:FLOWS_TO]->(dst:Address) RETURN dst.address AS to_address, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count, flow.last_seen_timestamp AS last_seen_timestamp ORDER BY flow.amount_usd_sum DESC LIMIT 50'
```

Find likely address completions from a prefix:

```bash
cia mcp call graph_query \
  network=bittensor \
  'query=USE topology MATCH (a:Address) WHERE a.address STARTS WITH "5Ggf" RETURN a.address AS address, a.network AS network LIMIT 10'
```

Actor-level exposure via one visible `LINKED` hop (AC11):

```bash
cia mcp call graph_query \
  network=bittensor \
  'query=USE topology MATCH (a:Address {address: "5Ggf..."})-[l:LINKED]-(owned:Address)-[r:FLOWS_TO]-(b:Address) WHERE owned.address <> b.address AND a.address <> b.address RETURN owned.address AS linked_via_address, b.address AS counterparty_address, r.amount_usd_sum AS amount_usd_sum LIMIT 50'
```

Resolve the `bittensor_evm` counterpart of a `bittensor` address (AC5, the only
cross-space edge):

```bash
cia mcp call graph_query \
  network=bittensor \
  'query=USE topology MATCH (a:Address {address: "5Ggf..."})-[l:LINKED]-(b:Address) WHERE a.network <> b.network RETURN b.address AS linked_address, b.network AS linked_network, l.basis AS basis, l.confidence AS confidence LIMIT 5'
```

When comparing amounts, remember that facts StarRocks-backed numeric fields
may arrive as strings while topology Memgraph fields may arrive as numbers.
