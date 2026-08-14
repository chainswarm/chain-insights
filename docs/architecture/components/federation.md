Worker: federation
Entrypoint: src/federation
Package: federation
Language: typescript
Tests: tests/federation-apply-merge.test.ts, tests/federation/merge.test.ts

# federation

## Purpose

Client-side merge for federated topology results. graphrag-mcp's thin fan-out
pushes the caller's query verbatim to every covering shard and returns rows
tagged with `__shard`, merging nothing. Merge semantics (max-over-shards vs
sum-over-shards) are a caller decision, so this module is the reference
implementation on the client side.

## Reads

- **Shard rows:** Result rows tagged with `__shard` from graphrag-mcp thin fan-out
- **Query text:** `apply-merge.ts` derives merge options (`aggregateKeys`, `orderBy`/`limit`, `orderKeyClass`) from the caller's flat `RETURN ... ORDER BY ... LIMIT n` query text

## Writes

- **Merged result:** `mergeShardRows` returns merged rows plus `perShard` aggregates, lifted out of the rows so no consumer can sum them by accident

## Flow

1. graphrag-mcp returns rows tagged `__shard`, unmerged.
2. `apply-merge.ts` derives merge options from the query text the caller already holds.
3. `merge.ts` merges the rows client-side.

## Invariants

- The merge is pure: no network, no config, no mutation of the caller's rows
- Non-mergeable aggregate columns are named by the caller, never inferred from rows
- Query-text parsing is deliberately narrow; anything it cannot confidently classify is treated as merge-affected (the safer default), never guessed

## Run

Library module only — no standalone runtime. Exercised through the graph read path.

## Verify

```bash
npx vitest run tests/federation-apply-merge.test.ts tests/federation/merge.test.ts
```
