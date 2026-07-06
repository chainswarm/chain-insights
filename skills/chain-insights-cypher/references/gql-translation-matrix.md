# GQL Translation Matrix

Chain Insights Graph parses every query as GQL first, then translates per
layer: `live_topology` → Cypher (Memgraph), `archive_topology`/`facts` → SQL.
The parser is the gate: Memgraph-native syntax fails at parse time on every
layer, even live. Full construct-by-construct detail:
`docs/graph-query-compatibility.md` in the Chain Insights repository.

## Rewrite recipes (rejected → accepted)

| Intent | Rejected (native Cypher) | Accepted (Chain Insights Graph GQL) | Layers |
| --- | --- | --- | --- |
| Bounded variable-length | `-[:FLOWS_TO*1..3]->` | `-[:FLOWS_TO]->{1,3}` | live ✅, archive ⚠️ slow |
| Shortest path | `-[:FLOWS_TO *BFS ..5]->` | `MATCH p = ANY SHORTEST (a)-[:FLOWS_TO]->{1,5}(b) RETURN p` | live only |
| All shortest | `*ALLSHORTEST` | `ALL SHORTEST` (unweighted) | live only |
| K shortest | `*KSHORTEST\|3` | None — `SHORTEST k` broken in 0.7.0 (see hazards); `ALL SHORTEST` + client-side truncate | — |
| Weighted shortest | `*WSHORTEST (r, n \| r.amount_usd_sum)` | Not expressible — enumerate bounded explicit-hop paths, rank client-side | — |
| Mid-path filter lambda | `[* (r, n \| n.is_exchange IS NULL)]` | Not expressible in `{m,n}` — write hops explicitly with per-hop `WHERE`, or post-filter | — |
| Taxonomy label match | `(n:Identity:Exchange)` (rejected) | `(n:Exchange)` or `(n:Identity&Exchange)` — spike-verified | live only |

## Verified hazards (MemGQL 0.7.0 spike, 2026-07-06)

- **`WHERE` inside a quantified segment is ACCEPTED but SILENTLY
  IGNORED** (node and edge predicates both) — the result set is the
  unfiltered traversal. Never use it; write hops explicitly.
- **Inner `WHERE` + `ANY SHORTEST` drops the anchor** — paths return from
  arbitrary start nodes. Never combine.
- **`SHORTEST k` fails at runtime** (invalid backend translation). Use
  `ANY SHORTEST` or `ALL SHORTEST`.
- Verified correct: plain `{m,n}`, `ANY SHORTEST`/`ALL SHORTEST` with
  path binding + edge hydration, `FOR x IN`, node `<>` compare, bare and
  `&`-conjunction label patterns (live).
| List unroll | `UNWIND xs AS x` | `FOR x IN xs` | live only |
| Node identity compare | `WHERE a <> b` | live: works; archive/facts: `a.identity_id <> b.identity_id` | see note |

## Quick layer capability table

| Capability | live | archive / facts |
| --- | --- | --- |
| Typed single hop, OPTIONAL MATCH, WITH, aggregates, CASE, IN, string predicates, UNION | ✅ | ✅ |
| Bounded `{m,n}` quantified path | ✅ | ✅ (recursive CTE — test depth 1 first, keep bounds tight) |
| Unbounded `{m,}`, path binding `MATCH p =`, `ANY/ALL SHORTEST`, temporal functions, `FOR x IN` | ✅ | ❌ |
| `SHORTEST k` | ❌ broken in 0.7.0 (runtime translation error) | ❌ |
| Untyped hop `-[r]->` | ✅ | ❌ (always type the relationship) |
| `collect()` | ✅ | ❌ (warehouse dialect gap) |
| `DATE`-typed edge properties | n/a | ⚠️ may return `null`; filter on `*_timestamp` fields |
| `CALL`, `UNWIND`, `keys()/labels()/type()`, `EXPLAIN/PROFILE`, `*BFS/*DFS/*WSHORTEST`, `USING HOPS LIMIT`, writes | ❌ | ❌ |

## Traversal decision guide

1. **Reach a known endpoint fastest (live):** `ANY SHORTEST` with a bounded
   quantifier. Cheapest correct answer for "is there a route and what is it".
2. **Enumerate routes to any exchange (live):** bounded `{1,n}` quantified
   path with terminal `is_exchange IS NOT NULL`. Intermediate-node predicates
   cannot live inside the quantifier — when every intermediate hop must be
   filtered (exchange-terminal rule) or every edge needs an amount floor,
   write the hops explicitly per depth (the fixed-hop batch pattern in
   `memgraph-examples.md`).
3. **Archive traversal:** bounded `{m,n}` is supported but translates to a
   recursive CTE. Start at `{1,1}`, verify latency against the tier timeout,
   then widen. Fixed-hop batches remain the safest archive pattern.
4. **Weighted (USD-flow) routing:** not expressible server-side. Enumerate
   explicit-hop paths with per-edge `amount_usd_sum` predicates and rank the
   aggregate client-side.

The exchange-terminal rule always applies: exchange identities are terminal
endpoints; every non-terminal traversal node carries
`is_exchange IS NULL`.
