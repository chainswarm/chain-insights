# Chain Insights Graph Query Compatibility Matrix

Chain Insights Graph accepts GQL (ISO/IEC 39075) with Cypher-style pattern
syntax through `graph_query` and `graph_query_batch`. Queries are parsed once
by a federation layer and then translated per layer:

| Layer | Backend class | Translation |
| --- | --- | --- |
| `live_topology` | Cypher graph database (Memgraph) | GQL → Cypher |
| `archive_topology` | SQL warehouse mapped as a graph | GQL → SQL (recursive CTE for paths) |
| `facts` | SQL warehouse mapped as a graph | GQL → SQL |

Two consequences drive everything below:

1. **The GQL parser is the gate.** A construct the parser rejects never
   reaches any backend — even when the backend itself would support it.
   Memgraph-native syntax such as `[:R*1..3]`, `*BFS`, or `CALL` fails at
   parse time on every layer, including `live_topology`.
2. **The SQL layers support a subset of the Cypher layer.** A query that runs
   on `live_topology` may still fail on `archive_topology` or `facts`.

## Construct support by layer

Legend: ✅ supported · ❌ rejected or unsupported · ⚠️ caveat (see notes)

### Core query structure

| Construct | Syntax | live | archive / facts |
| --- | --- | --- | --- |
| Node match with inline properties | `MATCH (n:Identity {identity_id: "X"})` | ✅ | ✅ |
| Clause-level `WHERE` | `MATCH (n) WHERE n.x = 1` | ✅ | ✅ |
| Pattern-level `WHERE` | `MATCH (n WHERE n.x = 1)` | ✅ | ✅ |
| Multiple sequential `MATCH` | `MATCH (a) MATCH (b)` | ✅ | ✅ |
| `OPTIONAL MATCH` | `OPTIONAL MATCH (a)-[r:R]->(b)` | ✅ | ✅ |
| `WITH` pipelines | `WITH n, count(*) AS c` | ✅ | ✅ |
| `WITH DISTINCT`, `WITH ... ORDER BY ... LIMIT` | | ✅ | ✅ |
| `RETURN` expressions with aliases | `RETURN n.x AS x` | ✅ | ✅ |
| Whole node / relationship return | `RETURN n`, `RETURN r` | ✅ | ✅ ⚠️ typed Bolt objects; not across layers |
| Map projections | `RETURN n {.identity_id, .risk_level}` | ✅ | ✅ |
| `ORDER BY` (incl. aliases) | | ✅ | ✅ |
| `SKIP` / `LIMIT` (`SKIP` works without `LIMIT`) | | ✅ | ✅ |
| `DISTINCT` | | ✅ | ✅ |
| `UNION` / `UNION ALL` / `UNION DISTINCT` | | ✅ | ✅ |
| `INTERSECT` / `EXCEPT` | | ✅ | ✅ |

### Filters, expressions, aggregates

| Construct | Syntax | live | archive / facts |
| --- | --- | --- | --- |
| `IN` list membership | `WHERE n.x IN ["a", "b"]` | ✅ | ✅ |
| `STARTS WITH` / `ENDS WITH` / `CONTAINS` | | ✅ | ✅ |
| `CASE WHEN ... THEN ... ELSE ... END` | | ✅ | ✅ |
| `COALESCE`, `NULLIF` | | ✅ | ✅ |
| Arithmetic | `+ - * / %` | ✅ | ✅ |
| `count`, `sum`, `avg`, `min`, `max` | | ✅ | ✅ |
| `COUNT(DISTINCT ...)` | | ✅ | ✅ |
| `collect()` | `collect(n.x)` | ✅ | ❌ warehouse dialect gap — translation emits an unsupported aggregate |
| Temporal functions | `date()`, `datetime()`, `localTime()` | ✅ | ❌ Cypher layer only |
| `DATE`-typed edge properties | `flow.period_start_date` | n/a | ⚠️ may materialize as `null`; filter on timestamps instead |
| Node-to-node identity comparison | `WHERE a <> b` | ✅ | ❌ compare key properties instead: `a.identity_id <> b.identity_id` |
| List iteration | `FOR x IN [...]` | ✅ | ❌ |

### Paths and traversal

| Construct | Syntax | live | archive / facts |
| --- | --- | --- | --- |
| Typed single hop | `-[r:FLOWS_TO]->` | ✅ | ✅ |
| Untyped hop | `-[r]->` | ✅ | ❌ specify the relationship type |
| Bounded quantified path | `-[:FLOWS_TO]->{1,3}` | ✅ | ✅ ⚠️ recursive CTE; keep bounds tight and expect archive-tier latency |
| Unbounded quantified path | `-[:FLOWS_TO]->{1,}` | ✅ ⚠️ always bound in practice | ❌ |
| Path binding | `MATCH p = (a)-[:R]->{1,3}(b) RETURN p` | ✅ | ❌ return individual nodes/edges instead |
| Shortest path | `ANY SHORTEST`, `ALL SHORTEST` | ✅ | ❌ |
| K shortest paths | `SHORTEST k` | ❌ broken in 0.7.0 (invalid backend translation — see hazards) | ❌ |
| Trail semantics (no repeated edges) | automatic on quantified paths | ✅ | ✅ |

### Rejected on every layer (parser gate)

These fail at parse time regardless of layer. Use the accepted form.

| Intent | Rejected (Memgraph-native Cypher) | Accepted (Chain Insights Graph GQL) |
| --- | --- | --- |
| Bounded variable-length | `-[:FLOWS_TO*1..3]->` | `-[:FLOWS_TO]->{1,3}` |
| Shortest path (BFS) | `-[:FLOWS_TO *BFS ..5]->` | `MATCH p = ANY SHORTEST (a)-[:FLOWS_TO]->{1,5}(b) RETURN p` (live only) |
| All shortest paths | `-[* ALLSHORTEST ...]-` | `ALL SHORTEST` (live only, unweighted) |
| K shortest paths | `-[*KSHORTEST\|3]->` | None on 0.7.0 — `SHORTEST k` is broken at runtime (see hazards); use `ALL SHORTEST` and truncate client-side |
| Weighted shortest path | `-[*WSHORTEST (r, n \| r.amount_usd_sum)]-` | No equivalent — enumerate bounded paths and rank client-side |
| Traversal filter lambda | `-[* (r, n \| n.is_exchange IS NULL)]->` | No equivalent — apply `WHERE` per hop or post-filter |
| Hop budget directive | `USING HOPS LIMIT 1000` | No equivalent — bound the quantifier instead |
| List unrolling | `UNWIND xs AS x` | `FOR x IN xs` (live only) |
| Procedures / query modules | `CALL anything()` | Not available through Chain Insights Graph |
| Metadata functions | `keys(n)`, `labels(n)`, `type(r)` | Project known properties explicitly |
| Plan inspection | `EXPLAIN`, `PROFILE` | Not available |
| Writes / DDL | `CREATE`, `MERGE`, `SET`, `DELETE`, `DROP`, ... | Never — the surface is read-only |

## Verified hazards (spike-tested against MemGQL 0.7.0)

These were verified empirically on 2026-07-06 against a seeded Memgraph
3.10.1 + MemGQL 0.7.0 stack. They are **more dangerous than parse
errors** because the query is accepted and returns confidently wrong
results:

| Form | What happens | Rule |
| --- | --- | --- |
| `WHERE` inside a quantified segment, node or edge — `(-[r:FLOWS_TO WHERE r.amount_usd_sum >= 10]->(x WHERE x.is_exchange IS NULL)){1,3}` | Accepted; **predicates silently discarded** — result set is the unfiltered traversal | Never use. Write hops explicitly with clause-level `WHERE` per hop |
| Inner `WHERE` combined with `ANY SHORTEST` | Accepted; **the anchor node is dropped** — paths returned from arbitrary start nodes | Never use. Shortest-path patterns must carry no quantifier-inner predicates |
| `SHORTEST k` | Rejected at runtime: the federation layer emits invalid backend Cypher | Use `ANY SHORTEST` (one route) or `ALL SHORTEST` (all same-length routes) |

Verified working in the same spike: plain `{m,n}` (correct result sets),
`ANY SHORTEST` / `ALL SHORTEST` with path binding and full edge-property
hydration, `FOR x IN`, node `<>` comparison (live).

### Taxonomy labels (live layer, spike-verified)

Secondary node labels (for example exchange or scam classification labels
maintained on live topology identities) are queryable through the
federation layer on `live_topology` only:

| Form | Result |
| --- | --- |
| `MATCH (n:Exchange)` — bare secondary label | ✅ works |
| `MATCH (n:Identity&Exchange)` — GQL conjunction | ✅ works |
| `MATCH (n:Identity:Exchange)` — Cypher colon-stacking | ❌ parse error |
| `RETURN labels(n)` | ❌ parse error (all layers) |

Caveats: taxonomy labels are sticky (never removed once assigned — label
presence means "was ever classified", not "currently active"); archive
and facts layers carry only their mapped labels, so taxonomy-label
patterns are live-only. The property-flag form (`is_exchange`) remains
the canonical cross-layer filter.

## Practical guidance

- **Prefer inline property maps for equality lookups**:
  `MATCH (n:Identity {identity_id: "X"})` rather than
  `MATCH (n:Identity) WHERE n.identity_id = "X"`. The federation layer
  normalizes the inline form itself, and the inline form has proven more
  robust across client drivers.
- **Always bound quantified paths** and always add `LIMIT`. Unbounded
  traversal on a dense money-flow graph is how queries hit the per-query
  timeout.
- **Weighted or filtered deep traversal is not expressible** through the
  federation layer today. For flows-weighted routing, enumerate bounded
  paths (`{1,n}` with per-edge predicates where each hop is written
  explicitly) and rank by aggregated `amount_usd_sum` client-side.
- **Test archive queries at depth 1 first.** The recursive-CTE translation
  is correct but expensive; grow the bound only after the shallow form
  returns within the tier timeout.
- When a construct fails with a parse error, check the rejected/accepted
  table above before assuming the data is missing.

## Related documentation

- `docs/graph-tools.md` — tool tiers, timeouts, and capability transparency
- Skill `chain-insights-cypher` — schema, layer choice, and query recipes
