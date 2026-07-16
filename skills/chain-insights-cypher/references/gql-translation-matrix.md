# Graph Query Compatibility (was: GQL Translation Matrix)

**MemGQL is retired.** Chain Insights Graph no longer parses queries as GQL and
no longer translates GQL→Cypher. The two graphs now have distinct native
surfaces:

- `USE topology` → **native Memgraph Cypher**, bounded (variable-length,
  `*BFS`, `*WSHORTEST`, `*KSHORTEST`, `*ALLSHORTEST`, filter lambdas; depth ≤ 5,
  KSHORTEST k ≤ 16, UNWIND ≤ 1000; unbounded rejected; read-only). One unified
  graph serves ALL topology — recent and full historical activity — in one
  place; it never compiles to SQL.
- `USE facts` → a **corpus-scoped Cypher subset** compiled to StarRocks SQL
  (single-relationship `MATCH`, indexed-predicate `WHERE`, projections,
  predicate-guarded aggregates, `ORDER BY`, `LIMIT` ≤ 1000). Native traversal,
  `WITH`, `CASE`, grouped aggregates, `collect()`, and predicate-less global
  aggregates are rejected with a typed contract error before any SQL runs.

The authoritative construct-by-construct matrix, the topology bounds table, and
the facts contract-error schema now live in
**`docs/graph-query-compatibility.md`**. Read that; the old GQL parser-gate and
MemGQL 0.7.0 hazard tables (#4343/#4344/#4345/#4241/#4178) are historical and do
not apply to the current surface.
