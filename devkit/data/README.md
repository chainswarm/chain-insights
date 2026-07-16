# Devkit Fixture Data

This directory is populated by the RBMK real-data export:

```bash
bash scripts/devops/chain-insights-devkit/build-fixture.sh
```

Do not hand-author fixture rows here. The devkit fixture must be generated from
real Bittensor semantic facade data through the `2026-01-01T00:00:00Z`
exclusive upper bound.

The `starrocks/` TSV files serve the `facts` scope (compiled to StarRocks SQL
by the vendored corpus-scoped translator). The `memgraph/` JSONL files serve
the unified `topology` scope (native Cypher, recent + historical) and must be
exported from a GraphRAG-synced Memgraph instance. They preserve node labels,
relationship types, properties, and scam-topology edges, but intentionally
exclude `GlobalState` runtime cursor data.
