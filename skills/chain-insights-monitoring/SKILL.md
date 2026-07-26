---
name: chain-insights-monitoring
description: Use when the user wants a standing watch rather than a one-shot investigation — scheduling `cia monitor`, configuring the detector×network matrix, tracking a stolen-funds or scam-topology case over time, watching their own addresses, reviewing findings before they become labels, wiring alert sinks, or interpreting monitor exit codes and pm2/cron scheduling.
---

# Chain Insights Monitoring

`cia monitor` is the standing-watch surface. Use it when the question is
"tell me when this changes", not "what does this address look like right now".

| The user wants | Use |
| --- | --- |
| A verdict on one address, now | `chain-insights-address-risk` |
| To trace a specific incident, once | `chain-insights-investigation` / `chain-insights-trace-funds` |
| To be told when something changes | **this skill** |

Monitoring is not a different data source. It re-runs the same detector and
trace machinery on a schedule, diffs the result against the last run, and turns
the difference into findings, case movements, and alerts. Everything lands as
plain files in the workspace, and **nothing becomes a label until a human
approves it**.

Full reference: `docs/monitoring.md`. Scheduling detail:
`references/pm2-scheduling.md`.

## First Moves

1. Monitoring writes into a workspace, exactly like an investigation. Confirm
   one exists, or create it:
   ```bash
   test -f .chain-insights/workspace.json || cia init .
   ```
   Run every `cia monitor` command from the workspace root. No monitor output
   belongs under `~/.chain-insights`.
2. Confirm the graph endpoint answers before scheduling anything — a scheduled
   run that cannot reach the graph just accumulates failed cells:
   ```bash
   cia mcp networks
   cia mcp call meta_usage_status
   ```
3. Take one pass by hand before automating it:
   ```bash
   cia monitor run
   cia monitor status
   ```

## The Detector × Network Matrix

A monitor pass runs a **matrix of cells**. One cell is one detector against one
network. Cells are independent: a failing cell never stops the others.

| Detector | Watches for | Window mode |
| --- | --- | --- |
| `fake-token` | Newly deployed lookalike / scam-shaped token contracts | full-state |
| `address-poisoning` | Dust and lookalike transfers crafted to poison a copy-paste | incremental |
| `mixer` | Addresses whose in/out flow shape resembles a mixing service | full-state |
| `attack-attribution` | Downstream activity attributable to a known scam-labeled seed | full-state |

With no config file the matrix defaults to all four detectors against
`bittensor` and `bittensor_evm`. To choose your own, write
`.chain-insights/monitor/config.json`:

```json
{
  "cells": [
    { "detector": "fake-token",        "network": "bittensor_evm" },
    { "detector": "address-poisoning", "network": "bittensor_evm" },
    { "detector": "attack-attribution","network": "bittensor" },
    { "detector": "mixer",             "network": "bittensor", "params": { "time_scope": "recent" } }
  ],
  "intervalSeconds": 3600,
  "stopIfRemainingBelow": 30,
  "reviewer": "analyst@example.com",
  "webhookUrl": "https://hooks.example.com/monitor",
  "caseMaxHops": 3
}
```

A missing config file is the **only** condition that falls back to the default
matrix. An unreadable or invalid config fails the run loudly rather than
silently monitoring something other than what you configured.

### Network scoping — the trap

Several network views share ONE address-grain topology graph. The `network`
argument passed to a graph read selects **the graph**, not the subset of
addresses inside it; the split lives on the `:Address.network` node property.

Cells named `bittensor` and `bittensor_evm` therefore read the same shards. The
detectors scope themselves by the node property, so a configured matrix is
correct — but if you hand-write a monitoring query, scope it yourself or you
will sweep the wrong address space at double the metered cost. See
`chain-insights-cypher` for the query rule.

### Full-state vs incremental — why a clean run is empty

Two detector shapes, two different notions of "new":

- **Incremental** (`address-poisoning`) reads a time window and advances a scan
  checkpoint. Next run starts where this one stopped.
- **Full-state** (`fake-token`, `mixer`, `attack-attribution`) classifies an
  address from its *current* cumulative graph state, so a time window would
  make it wrong. It re-derives its entire result set every run and keeps an
  emitted-findings set instead of a checkpoint, emitting only what you have not
  already been shown.

Consequence: **on unchanged data a run legitimately produces a findings
document with zero findings.** That is the system working. An empty document is
not a broken detector, a broken endpoint, or a missed sweep — it is the reason
the review backlog does not grow by thousands of already-reviewed rows every
hour. When findings are suppressed, the document says so in `warnings`.

Empty documents are still written and still replayed by `cia monitor rebuild`
as provenance, but they are not queued as pending review work — so
`cia monitor review list` stays a list of things that actually need a decision.

To deliberately re-emit everything for one detector — after a bad review pass,
a wiped workspace, or a changed threshold — use the `--full` escape hatch on
the underlying detect command. It resets the emitted-findings state and
republishes the whole result set:

```bash
cia detect mixer --network bittensor --full
```

`cia monitor run` never passes `--full`; a scheduled pass is always the
incremental/new-only path by design.

## Cases

A case anchors one incident to seed addresses and is re-traced on every pass.

```bash
cia monitor case add theft-1 --type stolen-funds --network bittensor --seed 5Seed...address
cia monitor case list
cia monitor case close theft-1
```

`--type` is `stolen-funds` (victim funds, cashout tracking) or `scam-topology`
(cluster expansion under review). Each pass writes a **snapshot** of the
addresses reachable from the case; the diff against the previous snapshot is
the case's **movements** — a new hop, a shared deposit address, a
cashout/exchange endpoint, or a frontier candidate worth reviewing. Movements
that reach a cashout endpoint or open a review frontier raise alerts.

## Review → Labels

Every detector finding and case movement is a **proposal**. The boundary is
absolute: machine output never writes a label.

```bash
cia monitor review list
cia monitor review approve <doc-path> --reviewer alice
cia monitor review reject  <doc-path> --reviewer alice
cia monitor export labels
```

Approving stamps the reviewer onto a **copy** under `detections/reviewed/`; the
original findings document is never modified. That reviewed copy — not the raw
machine output — is what label export and case expansion consume.
`export labels` reads approved decisions only and writes
`labels-<timestamp>.json` / `.csv` under `reports/monitor/`.

Reject rather than delete. A rejected document keeps the decision record, so
the same finding does not come back as a surprise and the audit trail survives.

## Alerts and Sinks

```bash
cia monitor alerts list        # unacked by default; --all for everything
cia monitor alerts ack <alert-id>
```

Alerts are recorded locally first, always. Two optional sinks fan them out,
configured in `.chain-insights/monitor/config.json`:

- `webhookUrl` — each alert POSTed as JSON.
- `execHook` — each alert piped as JSON on stdin to a shell command.

Both are best-effort. A failed sink never fails a run, because the alert is
already durable locally. Do not treat sink delivery as the alert record.

## Watchlist

Cases are incident-centric. The watchlist is **address-centric**: it tells you
when what monitoring already detects touches *your own* addresses.

```bash
cia monitor watchlist add 5GTj... --network bittensor --note "treasury cold"
cia monitor watchlist list
cia monitor watchlist remove 5GTj... --network bittensor
```

Enable it with a `watchlist` block in the monitor config (an empty block turns
it on with defaults; no block means off). Three triggers —
`watchlist_finding`, `watchlist_movement`, and `watchlist_dust` — all flow
through the normal alert stream.

**Address risk is not a trigger.** Monitoring never polls a risk score. Risk is
a final product you read once you have a reason to look, not a monitoring
input; polling it per watched address spends metered allowance re-reading a
downstream result. Use `aml_address_risk` when you want a verdict.

## Exit Codes

`cia monitor run` — and each iteration of `cia monitor watch` — signals the
pass through its exit code:

| Code | Meaning | What to do |
| --- | --- | --- |
| `0` | Clean pass; every cell and case trace completed. | Nothing. |
| `2` | **Isolated cell failure.** One or more cells failed; every other cell still ran and its findings and alerts landed. | Read the `[monitor] <cell> FAILED:` lines; the pass itself is sound. |
| `1` | Hard failure — the run could not start (unreadable workspace, invalid config). | Fix before the next scheduled pass; nothing was scanned. |

`2` is a **partial success**, not a crash. Any scheduler you use must be able to
express that difference, or you will page someone for a single flaky cell.

## Scheduling

`cia monitor run` is a **one-shot**: one pass, then exit. It is deliberately not
a daemon — the core is one-shot and idempotent so any scheduler can drive it and
a killed process never corrupts state. The scheduler supplies only the schedule.

| Use | When |
| --- | --- |
| `cia monitor watch` | Interactive or short-lived sessions. Zero setup, but dies with the shell and gives you no exit-code visibility per pass. |
| `cron` | A host that already has cron and no supervision requirement. Simplest durable option. |
| **pm2** | You want per-pass logs, `pm2 list` status, restart-on-boot, and non-zero exits made visible. |

```text
0 * * * * cd /path/to/workspace && cia monitor run
```

```bash
cia monitor watch --interval 1800   # floor 60s
```

For pm2 — including the `autorestart: false` requirement that keeps pm2 from
hot-looping the one-shot — read `references/pm2-scheduling.md`. Get that one
flag wrong and pm2 will re-launch the pass continuously, burning metered graph
allowance.

## Pulse Checks

```bash
cia monitor status   # cells, open cases, pending reviews, unacked alerts, last run
cia monitor report   # markdown rollup incl. case timelines and the watchlist section
cia monitor rebuild  # rebuild the derived DuckDB index from the canonical JSON
```

Canonical JSON under `.chain-insights/monitor/`, `detections/`, and `cases/` is
always the source of truth. `monitor.duckdb` is a derived, always-reconstructable
index — never authoritative.

## Cost Controls

Graph access is metered. Set a floor so a pass stops before spending allowance
you want to keep:

```json
{ "stopIfRemainingBelow": 30 }
```

When remaining allowance is below the floor, the pass halts before running any
cell and records the halt reason in the run document. Every run records
remaining allowance before and after under `.chain-insights/monitor/runs/`.

## Hard Rules

- Run every `cia monitor` command from the workspace root.
- Never present an unreviewed finding as a label or a conclusion.
- Never delete a bad findings document — reject it, so the decision is recorded.
- Never treat exit `2` as a broken deployment.
- Never assume an empty findings document means the sweep failed.
- Never schedule a matrix you have not run once by hand.
