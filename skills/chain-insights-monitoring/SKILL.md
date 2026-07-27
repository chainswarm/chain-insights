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

### Seeds are not fixed at creation

Investigations grow. Widen or narrow an **open** case in place, keeping its
snapshot history and movement timeline:

```bash
cia monitor case add-seed theft-1 --address 5Operator...address --note "operator wallet identified"
cia monitor case remove-seed theft-1 --address 5Wrong...address
```

Both are idempotent (re-adding an existing seed is a no-op, not an error), both
are **refused on a closed case** — a closed case is a historical record and the
run loop does not re-trace it, so open a new case with the wider seed set
instead — and a case can never be left with zero seeds. The addition is stamped
onto `case.json` as `seeds_added_at_timestamp` plus a `seed_events` entry carrying the
note. Never hand-edit `case.json` to expand a case; use `add-seed`, or the
continuity below is lost.

**Do not read a post-`add-seed` corridor as movement.** The next pass sees more
addresses because the aperture widened, not because funds moved. Chain Insights
separates the two by recording which seed(s) reached each address (`via_seeds`):
reachable from a pre-existing seed → **movement**; reachable only from a
newly added seed → **scope expansion**, reported as `scope_expansions_count` on
the run document, `movement = 'scope_expansion'` in the derived store, and a
`case_scope_expansion` alert. Classification signals (`cashout_endpoint`,
`frontier_candidate`) still fire either way, so the convergence you widened the
case to find still reaches the review queue — only the movement claim is
withheld. If you see `case_movement` after an `add-seed`, funds genuinely moved
within the old aperture.

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

`cia monitor run` signals the pass through its exit code:

| Code | Meaning | What to do |
| --- | --- | --- |
| `0` | Clean pass; every cell and case trace completed. | Nothing. |
| `2` | **Isolated cell failure.** One or more cells failed; every other cell still ran and its findings and alerts landed. | Read the `[monitor] <cell> FAILED:` lines; the pass itself is sound. |
| `1` | Hard failure — the run could not start (unreadable workspace, invalid config). | Fix before the next scheduled pass; nothing was scanned. |

`2` is a **partial success**, not a crash. Any scheduler you use must be able to
express that difference, or you will page someone for a single flaky cell.

Under `cia monitor watch` the process never exits between passes, so exit
codes are not visible per pass. An isolated cell failure shows up as the
`error` field on the cell entry in that pass's run document and in
`cia monitor status` — not in the supervisor.

## Scheduling

`cia monitor run` is a **one-shot**: one pass, then exit. The core is one-shot
and idempotent so a killed process never corrupts state. For a standing watch,
the recommended pairing is **pm2 supervising `cia monitor watch`**: `watch`
owns the loop (interval from the monitor config), pm2 owns process lifetime —
crash restart, logs, status, boot persistence. `pm2 list` showing `online`
means healthy; a killed and restarted watch loses no alerts and re-emits
nothing over unchanged data.

| Use | When |
| --- | --- |
| **pm2 + `monitor watch`** | Standing watch with supervision: crash restart, one log surface, one status command. Recommended. |
| `cron` + `monitor run` | A host that already has cron and external log plumbing. Per-pass exit codes visible to cron. |
| bare `cia monitor watch` | Interactive or short-lived sessions. Zero setup, but dies with the shell. |

```bash
cia monitor watch --interval 1800   # floor 60s
```

```text
0 * * * * cd /path/to/workspace && cia monitor run
```

For the pm2 setup read `references/pm2-scheduling.md`. **Do not point pm2 at
the one-shot `monitor run`**: pm2's default treats every clean exit as a crash,
and without `autorestart: false` it re-launches the pass continuously, burning
metered graph allowance. Supervising `watch` avoids that trap entirely.

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
