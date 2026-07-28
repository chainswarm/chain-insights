# detection

Entrypoint: `src/detection` · Language: typescript · Tests: `tests/detection/`

## Purpose

The internal findings scanners behind `cia detect <detector>`. Four
detectors: `fake-token`, `mixer`, `address-poisoning`,
`attack-attribution`. Files: `registry.ts`, `runtime.ts`, `run.ts`,
`checkpoint.ts`, `emit.ts`, `emitted-state.ts`, `graph-client.ts`,
`lookalike.ts`, `params.ts`, `detectors/*`. Wired via `src/cli.ts`'s
top-level `detect <detector>` command (`--full`, `--watch`,
`--param k=v`).

The related investigation tools `src/investigation/scam-corridor-trace.ts`
and `exchange-likeness.ts` are wired separately via the
`cia mcp aml-scam-corridor-trace` / `aml-exchange-likeness` subcommands.

## Reads

- Chain Insights Graph only, through the `graph_query` wrapper in
  `graph-client.ts`. Never direct warehouse access.
- `networkPredicate()` in `graph-client.ts` scopes unanchored sweeps to
  `<alias>.network = "<network>"` — added after unscoped sweeps published
  wrong-network attributions at double cost. Address-anchored lookups stay
  unscoped on purpose.
- Per-detector-per-network scan checkpoints under
  `.chain-insights/detectors/` (`checkpoint.ts`).

## Writes

- Findings JSON under `detections/`, named
  `<generated_at_timestamp>-<detector>-<network>.findings.json`
  (`emit.ts`).
- Full-state emitted-findings key sets
  (`.chain-insights/detectors/<detector>.<network>.emitted.json`,
  `emitted-state.ts`).

## Flow

Each detector is a pure core: `scan(window, client, network, params) →
findings[]` (`DetectorScan` in `runtime.ts`). The runner resolves the
effective parameters, executes the scan, checkpoints or updates emitted
state, and emits the findings document.

## Invariants

- **Parametrization.** Every detector ships a per-network default table
  layered with operator `--param key=value` overrides. The effective config
  is always echoed in the findings document's `threshold_provenance`.
- **Bounded knobs go through the shared limits registry.** Numeric
  search-bound knobs resolve via `limitFromParams` against
  `src/config/limits.ts` and reject an out-of-range `--param` with
  `LimitRangeError`:
  - `attack-attribution`: `max_hops` / `max_frontier` / `max_rows`
    (`attribution_max_hops` / `attribution_max_frontier` /
    `attribution_max_rows`).
  - `address-poisoning`: `max_rows` (`poisoning_max_rows`).
  - `fake-token`: `max_pages` / `page_size`
    (`fake_token_max_asset_pages` / `fake_token_max_rows`).
  Previously `numParam` accepted any non-negative number with no ceiling —
  a live way to hang the graph.
- **Non-bounded knobs** use the coercion helpers in `params.ts`
  (`numParam` / `strParam` / `listParam`): malformed numbers fall back to
  the default, csv lists are trimmed and lowercased.
- **Per-network defaults:**
  - `mixer` — `MIXER_NETWORK_DEFAULTS` hourglass floors (bittensor 50/50,
    bittensor_evm 20/20, generic fallback 5/5) with `min_in` / `min_out` /
    `max_candidates` / `time_scope` / `role_keywords` overrides. None of
    mixer's knobs moved to the shared registry. Its degree-qualified batch
    scan defaults `time_scope=recent` (live shard only) because node-metric
    degrees are window-exact, not mergeable across temporal shards.
  - `address-poisoning` — `POISONING_NETWORK_DEFAULTS` dust floor
    (bittensor and bittensor_evm both 0.0001), with `dust_floor` /
    `scan_window_days` via `numParam`.
  - `attack-attribution` — `ATTRIBUTION_NETWORK_DEFAULTS` holds only
    non-numeric taxonomy overrides (`seedLabels` / `boundaryKeywords`,
    empty today). The seed override param is `seed_labels` (taxonomy node
    labels, default `Scam`); `seed_subtypes` is kept only as a
    provenance/docs constant (`ATTRIBUTION_SEED_SUBTYPES`), not a live
    param.
  - `fake-token` — no per-network divergence (the assets dimension is
    small everywhere).
- **Window modes.** `address-poisoning` is `incremental` (checkpointed).
  `fake-token`, `mixer`, `attack-attribution` are `full-state` (emitted
  key set, no checkpoint). An unchanged run legitimately emits zero
  findings. `--full` resets emitted state and re-emits everything.
- **Findings are artifacts, never labels.** `reviewer` stays intentionally
  unset on every generated findings document. Review is the only path to a
  label (see [monitor](monitor.md)).

## Run

```bash
cia detect fake-token --network bittensor
cia detect mixer --network bittensor --param min_in=100
cia detect attack-attribution --network bittensor --full
```

## Verify

```bash
npm test -- tests/detection
```
