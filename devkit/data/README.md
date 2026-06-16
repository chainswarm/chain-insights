# Devkit Fixture Data

This directory is populated by the RBMK real-data export:

```bash
bash scripts/devops/chain-insights-devkit/build-fixture.sh
```

Do not hand-author fixture rows here. The devkit fixture must be generated from
real Bittensor semantic facade data through the `2026-01-01T00:00:00Z`
exclusive upper bound.
