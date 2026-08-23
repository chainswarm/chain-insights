# Chain Insights Graph Query Compatibility Matrix

Chain Insights Graph accepts Cypher through `graph_query` and
`graph_query_batch`. A query is routed by its leading `USE <graph>` clause to
one of two backends, each with its own accepted surface:

| Graph | Backend | Query surface |
| --- | --- | --- |
| `topology` | Memgraph, directly over Bolt | **Native Memgraph Cypher**, bounded (see topology bounds) |
| `facts` | StarRocks warehouse | Corpus-scoped Cypher subset, compiled to SQL |

Two consequences drive everything below:

1. **`topology` is native Memgraph Cypher.** It is a single federated graph that
   serves ALL topology — both recent and full historical activity — in one place;
   there is no separate "live" vs "archive" split and it never compiles to SQL.
   Variable-length paths and the path-algorithm forms (`*BFS`, `*WSHORTEST`,
   `*KSHORTEST`, `*ALLSHORTEST`) are first-class — subject to traversal bounds
   enforced before execution. There is no separate query dialect and no
   federation parser in front of it.
2. **`facts` is a compiled Cypher *subset*.** A corpus-scoped translator
   (`internal/cyphersql`) compiles a defined shape of `MATCH` / `WHERE` /
   projection / aggregate / `ORDER BY` / `LIMIT` to StarRocks SQL. Shapes outside
   that grammar are rejected with a typed contract error *before* any SQL runs —
   they do not reach the warehouse.

> **History.** Chain Insights Graph previously split topology into a fast
> recent-topology tier and a StarRocks-compiled historical rollup tier, both once
> fronted by a MemGQL (Memgraph Zero) GQL federation layer. MemGQL was retired in
> 2026‑07, and the separate historical rollup tier was retired shortly after: one
> Memgraph-backed `topology` graph now serves the full lifetime history. Docs and
> skills that describe a "GQL parser gate", GQL quantifier syntax (`{1,3}`),
> MemGQL 0.7.0 hazards (#4343/#4344/#4345), a per-call graph-scope tool argument,
> or period-granular historical rollups are historical.

## The shared-graph model — what `network` actually selects

Read this before writing any query that matches `:Address` without an exact
address.

Robinhood is the single public query network: one EVM H160 (`0x…`) address
space over ONE address-grain topology graph. There is no SS58/H160 split and
no second query network — `network=robinhood` selects the one public graph and
there is no `network=robinhood_evm` argument to pass.

The consequence is exact and easy to get wrong:

> **The `network` argument selects the GRAPH, not the subset of addresses
> inside it.**

A `USE topology` query that matches `:Address` without a network predicate
scans the whole public H160 space; scope by the node property when you want an
explicit subset:

```cypher
-- WRONG: unbounded sweep — returns every H160 address in the public space
USE topology MATCH (a:Address) RETURN a.address AS address LIMIT 100

-- RIGHT: scope by the node property
USE topology MATCH (a:Address) WHERE a.network = "robinhood"
RETURN a.address AS address LIMIT 100
```

Exact-address lookups (`MATCH (a:Address {address: "0x…"})`) need no predicate:
the address is already a unique key, and adding a network predicate there fails
closed on an H160 address screened under the chain's primary network name.

### `USE facts` is the opposite case

`facts` is the one place each network *does* get its own backing database —
the routing metadata on a result reports it as
`facts.routing.starrocks_database`. Because the database already scopes the
network, the facts `Address` label has **no mapped `network` property at all**:

```text
USE facts MATCH (a:Address {address:"0x…"})-[t:TRANSFER]->(b:Address)
          RETURN a.network AS from_network
→ unknown graph identifier: property "network" is not mapped on label "Address"
```

`Address` on facts is served only as a `TRANSFER` relationship endpoint, so a
single-node `MATCH (a:Address)` is refused there as well. Read address-grain
node properties — including `network` — on `USE topology`.

Getting these two rules backwards is not a stylistic problem. An unscoped
topology sweep publishes wrong-network results at double the metered cost, and
a facts query projecting `network` hard-fails rather than degrading.

## `topology` — native Memgraph Cypher

Everything Memgraph accepts on a read-only session is accepted here, within the
admission + bounds gate below. This includes clause- and pattern-level `WHERE`,
`WITH` pipelines, `CASE`, `collect()`, temporal functions, `UNWIND`, map
projections, `UNION`, and the full traversal surface. The topology graph serves
`Address` nodes (with `risk_score`/`risk_level` always present), `FLOWS_TO`
lifetime money-flow edges, the `LINKED` ownership overlay, `RISK_PROXIMITY`, and
a two-layer Bittensor neuron model: `(:Neuron {hotkey, netuid})` nodes labeled
`:Miner` or `:Validator`, connected via `(:Neuron)-[:MINES|:VALIDATES]->(:Subnet
{netuid, name, github_repo, url, discord, contact, owner_coldkey,
owner_hotkey})`; `(:Address)-[:HOTKEY_OF|:COLDKEY_OF]->(:Neuron)` bridges
addresses to neurons; `(:Address)-[:OWNS]->(:Subnet)` marks subnet ownership;
and on-chain identity properties (`chain_name`, `chain_url`, `chain_github`,
`chain_discord`) live on `:Address` directly. Validator/miner roles are
chain-evidence-derived, not registry labels.

### Traversal (the expanded surface)

| Form | Syntax | Supported |
| --- | --- | --- |
| Bounded variable-length | `-[:FLOWS_TO*1..5]->` | ✅ upper bound ≤ 5 |
| BFS to depth | `-[:FLOWS_TO *BFS 1..5]->` | ✅ upper bound ≤ 5 |
| Weighted shortest path | `-[:FLOWS_TO *WSHORTEST 5 (r,n \| coalesce(r.amount_usd_sum,1)) w]->` | ✅ hop bound ≤ 5, weight lambda supported |
| All shortest paths | `-[:FLOWS_TO *ALLSHORTEST 5 (r,n \| 1) w]->` | ✅ hop bound ≤ 5 |
| K shortest paths | `-[:FLOWS_TO *KSHORTEST\|3]->` | ✅ path count k ≤ 16 |
| Traversal filter lambda | `-[:FLOWS_TO *1..5 (r,n \| n.is_exchange IS NULL)]->` | ✅ |

### Topology admission + bounds gate

Admission mirrors the production graph MCP exactly (read-only, byte size ≤ 32768,
single statement, must start with a read clause). On top of that, traversal is
bounded so an admitted query cannot become an unbounded graph walk:

| Bound | Limit | Rejected example |
| --- | --- | --- |
| Traversal depth (upper hop bound) | ≤ 5 | `-[:FLOWS_TO*1..9]->` → *traversal depth 9 exceeds the maximum of 5* |
| Unbounded traversal | forbidden | `-[:FLOWS_TO*]->`, `-[:FLOWS_TO *BFS]->`, `-[:FLOWS_TO*3..]->` → *unbounded traversal … add an explicit upper hop bound* |
| KSHORTEST path count `k` | ≤ 16 | `*KSHORTEST\|50` → *KSHORTEST k=50 exceeds the maximum of 16* |
| `UNWIND` literal list length | ≤ 1000 | `UNWIND [ …1001 items… ] AS x` → *UNWIND list of 1001 items exceeds the maximum of 1000* |

Always add an explicit upper hop bound and a `LIMIT`. Writes/DDL (`CREATE`,
`MERGE`, `SET`, `DELETE`, `DROP`, `CALL`, …) are always rejected — the surface is
read-only.

## `facts` — compiled Cypher subset

The translator compiles a defined grammar to StarRocks SQL. All literals are
bound as parameters (no SQL injection surface). Anything outside the grammar is
rejected with a typed contract error before execution.

### Supported

| Construct | Notes |
| --- | --- |
| `MATCH` on a mapped node / single relationship | `(from:Address)-[t:TRANSFER]->(to:Address)` (bounded individual transfer rows from `facts_transfers_view`). Lifetime address metrics are node properties on `USE topology` (the facts `AddressFeature` surface is retired). Never serves `FLOWS_TO` or `LINKED` — those are topology-only. Neuron identity, hotkey/coldkey pairing, and IP/axon-port observation live on the topology `:Neuron` node, not on `facts`. Labels and per-label risk live on the topology address node, not on `facts`. |
| Chained fixed-hop patterns | up to 5 hops |
| `WHERE` with an indexed predicate | `address` equality or `IN`; `tx_id` equality or `IN` (the `TRANSFER` edge's row-level key); date/height/timestamp range |
| Inline property maps | `MATCH (a:Address {address:"…"})` |
| Property projections with aliases | `RETURN a.address AS address, f.tx_out_count AS tx_out_count` |
| Aggregates **with** an indexed predicate | `count`, `sum` |
| `ORDER BY`, `LIMIT` (≤ 1000), `OFFSET`-free paging | `LIMIT` required unless an indexed predicate is present — except `TRANSFER`, where an indexed predicate is always required (see below) |

### Cost-shape gate

`facts` rejects full-scan shapes so a mapped-graph read cannot turn into an
unbounded warehouse scan:

| Rejected shape | Contract error |
| --- | --- |
| Predicate-less global aggregate | `count(i)` with no indexed predicate → *StarRocks-backed aggregate graph queries require an indexed predicate* |
| No `LIMIT` and no indexed predicate | → *StarRocks-backed graph queries require an explicit LIMIT or indexed predicate* |
| `TRANSFER` row-select or aggregate with no indexed predicate, even with `LIMIT` | `facts_transfers_view` is a full transfer-history table — a bare `LIMIT` does not bound the scan → *StarRocks-backed TRANSFER graph queries require an indexed predicate (address equality on either endpoint, or tx_id)* |
| `LIMIT` above the ceiling | `LIMIT 5000` → *StarRocks-backed graph query LIMIT exceeds maximum 1000* |

### Not in the facts grammar (contract error)

These compile-reject (`ErrUnsupportedShape` / related) — they never reach
StarRocks. Use the topology graph, or restructure:

| Construct | Instead |
| --- | --- |
| `FLOWS_TO` / money-flow traversal | The topology graph — facts never serves money flow |
| Native traversal (`*1..3`, `*BFS`, `*WSHORTEST`, …) | The topology graph, or a single fixed-hop `LINKED` pattern |
| `WITH` pipelines | The topology graph |
| `CASE … END` | The topology graph, or post-process client-side |
| Grouped aggregates (`GROUP BY`-shaped) | The topology graph, or per-key `graph_query_batch` |
| `collect()` and other warehouse-dialect-gap aggregates | The topology graph |
| Self-joins / node-to-node comparison `WHERE a <> b` | Compare key properties: `a.address <> b.address` |
| Untyped relationship `-[r]->` | Name the relationship type |
| Metadata functions `keys(n)`, `labels(n)`, `type(r)` | Project known properties explicitly |

The facts result baselines and the exact supported/rejected shape set are pinned
by `devkit/chain-insights-graph-devkit/internal/cyphersql`
(`corpus_test.go`, `conformance_starrocks_test.go`).

## Taxonomy labels (topology graph)

Secondary node labels (exchange / scam classification labels maintained on
addresses) are queryable on `topology`:

| Form | Result |
| --- | --- |
| `MATCH (n:Exchange)` — bare secondary label | ✅ |
| `MATCH (n:Address:Exchange)` — colon-stacked labels | ✅ (native Cypher) |
| `RETURN labels(n)` | project known properties instead |

Caveats: taxonomy labels are sticky (never removed once assigned — presence means
"was ever classified", not "currently active"); facts carries only its mapped
labels, so taxonomy-label patterns are topology-only. The property-flag form
(`is_exchange`) remains the canonical cross-graph filter.

## Practical guidance

- **Prefer inline property maps for equality lookups**:
  `MATCH (a:Address {address:"X"})` over
  `MATCH (a:Address) WHERE a.address = "X"`.
- **Bound every traversal and add `LIMIT`.** The topology gate rejects unbounded
  and over-depth traversal outright; facts rejects predicate-less scans.
- **Weighted / filtered deep traversal is first-class on the topology graph.**
  Use `*WSHORTEST … (r,n | coalesce(r.amount_usd_sum,1)) w` for flow-weighted
  routing or `*BFS 1..k` for reachability, instead of enumerating hops client-side.
  The topology graph already covers full lifetime history — there is no separate
  mode to opt into for older activity.
- **Facts stays fixed-hop.** For bounded transfer rows and, until P3,
  address features, write one explicit pattern per shape and batch them
  with `graph_query_batch`.
- When a query is rejected, read the returned contract error — it names the exact
  violated bound or unsupported shape.

## Related documentation

- `docs/graph-tools.md` — tool tiers, timeouts, and capability transparency
- Skill `chain-insights-cypher` — Memgraph dialect and layer rules
- Skill `chain-insights-schema-evm` — EVM / Robinhood GraphRAG map
- Skill `chain-insights-schema-bittensor` — Bittensor GraphRAG map
