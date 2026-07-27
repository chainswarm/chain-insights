# Search Limits

Every Chain Insights investigation and detection tool bounds how far and how
wide it searches. Those bounds used to be constants compiled into the code, so
one value had to serve a quiet chain and a busy one, a routine sweep and a live
case. They are now tunable knobs with published defaults and hard ceilings.

Why it matters, measured on a real high-fan-in deposit:

| Reverse-trace row limit | Depth | Outcome |
| --- | --- | --- |
| 500 | 4 hops | origin **not reachable** |
| 5000 | 4 hops | origin reached, full deposit -> origin chain closes, ~6s |

The cap, not the depth, was the binding constraint — and raising it was nearly
free. On a smaller chain the same 500 may be far too generous. Hence a knob.

## Precedence

Highest wins:

1. **Per-call** — an argument on the MCP tool, a CLI flag, or a detector
   `--param`.
2. **Config file, per network** — `networkLimits.<network>.<key>` in
   `~/.chain-insights/config.json` (or in the monitor config for unattended
   runs).
3. **Config file, all networks** — `limits.<key>`.
4. **Per-network default** — the built-in table for that chain.
5. **Built-in default** — the value in the table below.

## Knobs

| Key | Bounds | Default | Ceiling | Per-call argument |
| --- | --- | --- | --- | --- |
| `trace_max_hops` | forward trace depth | 3 | 5 | `max_hops` on `aml_trace_victim_funds` / `aml_trace_suspect_funds` |
| `trace_per_address_limit` | counterparties expanded per address per hop | 5 | 50 | `per_address_limit` on the same two tools |
| `deposit_sources_max_hops` | reverse trace depth | 2 | 5 | `max_hops` on `aml_trace_deposit_sources` |
| `deposit_sources_row_limit` | value-ordered upstream paths kept per depth | 500 | 20000 | `row_limit` on `aml_trace_deposit_sources` |
| `corridor_max_hops` | corridor BFS depth | 3 | 4 | `maxHops` |
| `corridor_frontier_cap` | addresses carried forward per hop | 50 | 500 | `frontierCap` |
| `corridor_query_row_limit` | rows per frontier query | 200 | 5000 | `queryRowLimit` |
| `exchange_likeness_max_candidates` | candidates per call | 25 | 100 | `maxCandidates` |
| `attribution_max_hops` | downstream attribution depth | 3 | 5 | `--param max_hops` |
| `attribution_max_frontier` | nodes emitted per attribution hop | 500 | 10000 | `--param max_frontier` |
| `attribution_max_rows` | seed rows per sweep | 1000 | 50000 | `--param max_rows` |
| `poisoning_max_rows` | rows per poisoning sweep query | 1000 | 50000 | `--param max_rows` |
| `fake_token_max_rows` | assets per pagination page | 1000 | 50000 | `--param page_size` |
| `fake_token_max_asset_pages` | pages walked per sweep | 50 | 500 | `--param max_pages` |
| `viz_max_nodes` | nodes rendered before truncation | 100 | 2000 | `maxNodes` |

Defaults are exactly the values that used to be hardcoded, so an existing call
that passes no override behaves identically.

## Hop depth is bounded harder than anything else

Row and frontier caps cost roughly linearly in their value. Hop depth does not:
cost grows exponentially, and each extra hop widens the fan-out so the row cap
bites sooner. On one real deposit, three hops produced 5,201 paths and four
produced 10,201 at the same row cap. Five hops against a live shard has been
observed to exhaust the graph backend's memory outright.

So hop ceilings are tight (5 at most, and never more than 3 hops above the
shipped default), and they are **not raisable from the per-call layer**. A
per-network entry may *lower* a ceiling for a chain that cannot afford the
work; only a code change raises the absolute maximum.

## Over-ceiling requests are rejected, not clamped

Asking for more than the ceiling returns a typed error naming the knob and its
limit. It does not quietly clamp:

```
deposit_sources_max_hops must be an integer between 1 and 5 (got 9 from the
call). Reverse trace depth in hops from a deposit/cashout seed. The ceiling is
a hard bound and cannot be raised per call.
```

A silently clamped search returns a result that reads as exhaustive when it is
not — the same failure this whole surface exists to fix.

## Seeing the effective bounds

Trace tools report what was requested, what was used, the value that would have
been used with no override, and the ceiling, under `input.search_limits`:

```json
"search_limits": {
  "deposit_sources_max_hops":  { "requested": 3, "used": 3, "default": 2, "ceiling": 5 },
  "deposit_sources_row_limit": { "requested": 5000, "used": 5000, "default": 500, "ceiling": 20000 }
}
```

When a cap is actually hit, the warning says what was lost, not merely that
something was:

```
reverse_deposit_sources_2 hit the 5000-row limit; results are truncated.
Kept the 5000 highest-value paths; the weakest retained path carries 19.78 USD,
so any dropped path carries no more than that.
Raise row_limit (currently 5000, max 20000) to retain more.
```

## Configuring

Per-call, through an MCP client:

```json
{ "deposit_addresses": "5Deposit...", "network": "bittensor", "max_hops": 3, "row_limit": 5000 }
```

Per-call, from the CLI:

```bash
cia mcp call aml_trace_deposit_sources \
  network=bittensor deposit_addresses=5Deposit... max_hops=3 row_limit=5000
```

In `~/.chain-insights/config.json`:

```json
{
  "limits": { "deposit_sources_row_limit": 2000 },
  "networkLimits": {
    "bittensor": { "deposit_sources_row_limit": 5000, "trace_per_address_limit": 10 }
  }
}
```

For unattended monitor runs, the monitor config accepts the same two blocks,
plus per-cell `params` which remain the most specific layer:

```json
{
  "cells": [
    { "detector": "attack-attribution", "network": "bittensor", "params": { "max_hops": "4" } }
  ],
  "networkLimits": { "bittensor": { "corridor_query_row_limit": 500 } }
}
```

Bad values fail at config load, not eight hours into a watch loop. An unknown
key is rejected outright — a silently ignored knob is indistinguishable from
one that had no effect.

## Bounds that are deliberately NOT tunable

These are protocol or safety limits, not budget choices:

| Bound | Why it stays fixed |
| --- | --- |
| Max query text size (32 KiB) | A hard backend limit. Exceeding it fails the query; it is not a cost trade-off. |
| Queries per `graph_query_batch` (20) | The backend's protocol maximum. A larger batch is rejected server-side. |
| Attribution frontier chunk size (200) | Sizes the IN-list so the generated query stays under the text limit above. |
| Corridor wall-clock budget (120s) | The last stop against a runaway trace holding a metered connection open. A caller must not be able to extend their own timeout. |
| Connection-route BFS depth (4) | A native variable-length BFS whose cost is not bounded by any row cap. |
| Per-query and per-request timeouts | Transport-level, not search breadth. |
| Gate and scoring thresholds (hub degree, reciprocity, dust floor, ...) | Detection semantics. Changing them changes what a finding *means*, not how much of the graph is searched. Several are already `--param`-tunable per detector. |
