# Chain Insights Graph Query Compatibility Matrix

Chain Insights Graph accepts Cypher through `graph_query` and
`graph_query_batch`. A query is routed by its leading `USE <layer>` clause to
one of two backends, each with its own accepted surface:

| Layer | Backend | Query surface |
| --- | --- | --- |
| `live_topology` | Memgraph, directly over Bolt | **Native Memgraph Cypher**, bounded (see live bounds) |
| `archive_topology` | StarRocks warehouse | Corpus-scoped Cypher subset, compiled to SQL |
| `facts` | StarRocks warehouse | Corpus-scoped Cypher subset, compiled to SQL |

Two consequences drive everything below:

1. **`live_topology` is native Memgraph Cypher.** Variable-length paths and the
   path-algorithm forms (`*BFS`, `*WSHORTEST`, `*KSHORTEST`, `*ALLSHORTEST`) are
   first-class — subject to traversal bounds enforced before execution. There is
   no separate query dialect and no federation parser in front of it.
2. **`archive_topology` / `facts` are a compiled Cypher *subset*.** A
   corpus-scoped translator (`internal/cyphersql`) compiles a defined shape of
   `MATCH` / `WHERE` / projection / aggregate / `ORDER BY` / `LIMIT` to StarRocks
   SQL. Shapes outside that grammar are rejected with a typed contract error
   *before* any SQL runs — they do not reach the warehouse.

> **History.** Chain Insights Graph previously fronted both layers with a MemGQL
> (Memgraph Zero) GQL federation layer. MemGQL was retired in 2026‑07 after
> blocking upstream defects; the routing above replaces it. Docs and skills that
> describe a "GQL parser gate", GQL quantifier syntax (`{1,3}`), or MemGQL 0.7.0
> hazards (#4343/#4344/#4345) are historical.

## `live_topology` — native Memgraph Cypher

Everything Memgraph accepts on a read-only session is accepted here, within the
admission + bounds gate below. This includes clause- and pattern-level `WHERE`,
`WITH` pipelines, `CASE`, `collect()`, temporal functions, `UNWIND`, map
projections, `UNION`, and the full traversal surface.

### Traversal (the expanded surface)

| Form | Syntax | Supported |
| --- | --- | --- |
| Bounded variable-length | `-[:FLOWS_TO*1..5]->` | ✅ upper bound ≤ 5 |
| BFS to depth | `-[:FLOWS_TO *BFS 1..5]->` | ✅ upper bound ≤ 5 |
| Weighted shortest path | `-[:FLOWS_TO *WSHORTEST 5 (r,n \| coalesce(r.amount_usd_sum,1)) w]->` | ✅ hop bound ≤ 5, weight lambda supported |
| All shortest paths | `-[:FLOWS_TO *ALLSHORTEST 5 (r,n \| 1) w]->` | ✅ hop bound ≤ 5 |
| K shortest paths | `-[:FLOWS_TO *KSHORTEST\|3]->` | ✅ path count k ≤ 16 |
| Traversal filter lambda | `-[:FLOWS_TO *1..5 (r,n \| n.is_exchange IS NULL)]->` | ✅ |

### Live admission + bounds gate

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

## `archive_topology` / `facts` — compiled Cypher subset

The translator compiles a defined grammar to StarRocks SQL. All literals are
bound as parameters (no SQL injection surface). Anything outside the grammar is
rejected with a typed contract error before execution.

### Supported

| Construct | Notes |
| --- | --- |
| `MATCH` on a mapped node / single relationship | `(:Address)-[:FLOWS_TO]->(:Address)`, `(:Address)-[:LINKED]-(:Address)`, `(:Address)-[:HAS_LABEL]->(:AddressLabel)`, etc. |
| Chained fixed-hop patterns | up to 5 hops |
| `WHERE` with an indexed predicate | `address` equality or `IN`; date/height/timestamp range |
| Inline property maps | `MATCH (a:Address {address:"…"})` |
| Property projections with aliases | `RETURN a.address AS address, f.amount_usd_sum AS amt` |
| Aggregates **with** an indexed predicate | `count`, `sum`, `min`, `max` |
| `ORDER BY`, `LIMIT` (≤ 1000), `OFFSET`-free paging | `LIMIT` required unless an indexed predicate is present |

### Cost-shape gate

`archive_topology` / `facts` reject full-scan shapes so a mapped-graph read
cannot turn into an unbounded warehouse scan:

| Rejected shape | Contract error |
| --- | --- |
| Predicate-less global aggregate | `count(i)` with no indexed predicate → *StarRocks-backed aggregate graph queries require an indexed predicate* |
| No `LIMIT` and no indexed predicate | → *StarRocks-backed graph queries require an explicit LIMIT or indexed predicate* |
| `LIMIT` above the ceiling | `LIMIT 5000` → *StarRocks-backed graph query LIMIT exceeds maximum 1000* |

### Not in the archive/facts grammar (contract error)

These compile-reject (`ErrUnsupportedShape` / related) — they never reach
StarRocks. Use the live layer, or restructure:

| Construct | Instead |
| --- | --- |
| Native traversal (`*1..3`, `*BFS`, `*WSHORTEST`, …) | Live layer, or explicit fixed-hop `FLOWS_TO` patterns batched via `graph_query_batch` |
| `WITH` pipelines | Live layer |
| `CASE … END` | Live layer, or post-process client-side |
| Grouped aggregates (`GROUP BY`-shaped) | Live layer, or per-key `graph_query_batch` |
| `collect()` and other warehouse-dialect-gap aggregates | Live layer |
| Untyped relationship `-[r]->` | Name the relationship type |
| Node-to-node comparison `WHERE a <> b` | Compare key properties: `a.address <> b.address` |
| Metadata functions `keys(n)`, `labels(n)`, `type(r)` | Project known properties explicitly |
| Cost-bound free-ended traversal (k ≥ 3 free-ended `FLOWS_TO`) | Add an anchor / narrower bound |

The archive/facts result baselines and the exact supported/rejected shape set
are pinned by `devkit/chain-insights-graph-devkit/internal/cyphersql`
(`corpus_test.go`, `conformance_starrocks_test.go`) and the shared
`archive-result-goldens.json`.

## Taxonomy labels (live layer)

Secondary node labels (exchange / scam classification labels maintained on live
addresses) are queryable on `live_topology`:

| Form | Result |
| --- | --- |
| `MATCH (n:Exchange)` — bare secondary label | ✅ |
| `MATCH (n:Address:Exchange)` — colon-stacked labels | ✅ (native Cypher) |
| `RETURN labels(n)` | project known properties instead |

Caveats: taxonomy labels are sticky (never removed once assigned — presence means
"was ever classified", not "currently active"); archive/facts carry only their
mapped labels, so taxonomy-label patterns are live-only. The property-flag form
(`is_exchange`) remains the canonical cross-layer filter.

## Practical guidance

- **Prefer inline property maps for equality lookups**:
  `MATCH (a:Address {address:"X"})` over
  `MATCH (a:Address) WHERE a.address = "X"`.
- **Bound every traversal and add `LIMIT`.** The live gate rejects unbounded and
  over-depth traversal outright; archive/facts reject predicate-less scans.
- **Weighted / filtered deep traversal is now first-class on the live layer.**
  Use `*WSHORTEST … (r,n | coalesce(r.amount_usd_sum,1)) w` for flow-weighted
  routing or `*BFS 1..k` for reachability, instead of enumerating hops client-side.
- **Archive/facts stay fixed-hop.** For historical multi-hop flows, write one
  explicit pattern per depth and batch them with `graph_query_batch`.
- When a query is rejected, read the returned contract error — it names the exact
  violated bound or unsupported shape.

## Related documentation

- `docs/graph-tools.md` — tool tiers, timeouts, and capability transparency
- Skill `chain-insights-cypher` — schema, layer choice, and query recipes
