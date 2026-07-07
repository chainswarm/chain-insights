# Graph Query Compatibility (was: GQL Translation Matrix)

**MemGQL is retired.** Chain Insights Graph no longer parses queries as GQL and
no longer translates GQL→Cypher. The two layers now have distinct native
surfaces:

- `USE live_topology` → **native Memgraph Cypher**, bounded (variable-length,
  `*BFS`, `*WSHORTEST`, `*KSHORTEST`, `*ALLSHORTEST`, filter lambdas; depth ≤ 5,
  KSHORTEST k ≤ 16, UNWIND ≤ 1000; unbounded rejected; read-only).
- `USE archive_topology` / `USE facts` → a **corpus-scoped Cypher subset**
  compiled to StarRocks SQL (single-relationship `MATCH`, indexed-predicate
  `WHERE`, projections, predicate-guarded aggregates, `ORDER BY`, `LIMIT` ≤ 1000).
  Native traversal, `WITH`, `CASE`, grouped aggregates, `collect()`, and
  predicate-less global aggregates are rejected with a typed contract error
  before any SQL runs.

The authoritative construct-by-construct matrix, the live bounds table, and the
archive/facts contract-error schema now live in
**`docs/graph-query-compatibility.md`**. Read that; the old GQL parser-gate and
MemGQL 0.7.0 hazard tables (#4343/#4344/#4345/#4241/#4178) are historical and do
not apply to the current surface.
