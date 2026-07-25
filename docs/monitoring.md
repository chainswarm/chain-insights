# Continuous Monitoring

`cia monitor` turns Chain Insights from a one-shot investigation tool into a
standing watch: it re-runs detection sweeps and case traces on a schedule, so
new scam activity, poisoning attempts, and stolen-funds movement surface
without an analyst re-running each check by hand. Every result still lands as
plain files in the workspace, and nothing becomes a label until a human
reviews it.

## What It Does

- **Fake-token surveillance** — sweeps for newly deployed lookalike or
  scam-shaped token contracts before they spread.
- **Address-poisoning surveillance** — watches for dust and lookalike
  transfers crafted to trick a victim into copying the wrong address.
- **Attack attribution** — walks outward from known scam-labeled seed
  addresses to attribute downstream activity to the same operator.
- **Mixer-likeness surveillance** — flags addresses whose inbound/outbound
  flow shape resembles a mixing service.
- **Exchange-likeness mapping** — classifies candidate deposit and cashout
  addresses by fan-in, reciprocity, and inbound lifetime, so exchange-shaped
  endpoints are proposed for review instead of assumed automatically.
- **Stolen-funds case tracking** — re-traces the corridor from a theft's seed
  addresses on every run, snapshots the reachable address set, and raises an
  alert the moment funds reach a new hop, a shared deposit address, or a
  cashout/exchange endpoint.
- **Scam-topology expansion under review** — grows a scam cluster's seed set
  only after a human approves the newly discovered addresses, so automated
  corridor growth never becomes a label without sign-off.

The first four are scheduled detector sweeps over a network matrix. The last
three are case-centric: a monitor case anchors one investigation (a theft or a
scam cluster) and is re-traced on every run so its own history — snapshots,
movements, alerts — accumulates over time.

## Quick Start

Initialize a workspace and run one monitoring pass:

```bash
cia init .
cia monitor run
```

With no config file, `cia monitor run` uses a default matrix covering all four
detectors against `bittensor` and `bittensor_evm`. To customize the matrix,
write `.chain-insights/monitor/config.json`:

```json
{
  "cells": [
    { "detector": "fake-token", "network": "bittensor_evm" },
    { "detector": "address-poisoning", "network": "bittensor_evm" },
    { "detector": "attack-attribution", "network": "bittensor" },
    { "detector": "mixer", "network": "bittensor", "params": { "time_scope": "recent" } }
  ],
  "intervalSeconds": 3600,
  "stopIfRemainingBelow": 30,
  "reviewer": "analyst@example.com",
  "webhookUrl": "https://hooks.example.com/monitor",
  "caseMaxHops": 3
}
```

For a standing watch, put `cia monitor run` on a schedule. Cron is the
simplest option:

```text
0 * * * * cd /path/to/workspace && cia monitor run
```

`cia monitor watch` is a thin built-in alternative to cron — it loops
`monitor run` on `intervalSeconds` (or `--interval <seconds>`, floor 60s)
without needing an external scheduler:

```bash
cia monitor watch --interval 1800
```

Two read-only commands give you a pulse check without waiting for a report:

```bash
cia monitor status   # cells, open cases, pending reviews, unacked alerts, last run — one line
cia monitor report   # markdown rollup: recent runs, pending review, unacked alerts, case timelines
```

## Cases

A case anchors one investigation — a theft or a scam cluster — to one or more
seed addresses, and is re-traced automatically on every `cia monitor run`.

```bash
cia monitor case add theft-1 \
  --type stolen-funds \
  --network bittensor \
  --seed 5Seed...address

cia monitor case list          # open cases (add --all for closed too)
cia monitor case close theft-1
```

`--type` is `stolen-funds` (victim funds, cashout tracking) or
`scam-topology` (cluster expansion under review). A case ID is lowercase
letters, digits, and hyphens.

Each run re-traces every open case from its seed addresses (plus any
approved expansion addresses — see [Review & labels](#review--labels)) and
writes a **snapshot**: the full set of addresses reachable from the case at
that point in time. Comparing a snapshot to the one before it produces the
case's **movements** — a new hop, a new shared-deposit address, a
cashout/exchange endpoint, or a frontier candidate worth reviewing for
expansion. Movements that reach a cashout/exchange endpoint or open a new
review frontier are raised as alerts (see [Alerts](#alerts)) so a stolen-funds
case surfaces cashout activity as soon as the next run sees it, not only when
someone remembers to check.

## Review & labels

Anything a detector sweep or a case trace finds is a **proposal**, not a
label. It lands in the workspace as a findings document and waits for a human
decision:

```bash
cia monitor review list                       # pending findings documents
cia monitor review approve <doc-path> --reviewer alice
cia monitor review reject  <doc-path> --reviewer alice
```

`--reviewer` falls back to the `reviewer` key in
`.chain-insights/monitor/config.json` if set, otherwise it is required.

Approving a document **stamps the reviewer's identity onto a copy** written
under `detections/reviewed/`; the original findings document is never
modified. That reviewed copy is the hand-off artifact — it is what downstream
label-ingestion and case expansion consume, never the raw machine output.
Rejecting a document records the decision only; no reviewed copy is written
and it does not feed case expansion.

Once findings are approved, export them as curated labels:

```bash
cia monitor export labels
```

This reads **approved decisions only** and writes matching
`labels-<timestamp>.json` and `labels-<timestamp>.csv` files under
`reports/monitor/`, each row carrying the address, network, label,
originating tool, reviewer, and decision timestamp.

## Alerts

Every run emits alerts for new findings and for case movements worth
attention (cashout endpoints, frontier candidates for review):

```bash
cia monitor alerts list          # unacked only by default (--all for everything)
cia monitor alerts ack <alert-id>
```

Alerts are always recorded locally first. Two optional sinks fan them out in
real time, configured in `.chain-insights/monitor/config.json`:

- `webhookUrl` — each alert is POSTed as JSON to this URL.
- `execHook` — each alert is piped as JSON (on stdin) to this shell command.

Both sinks are best-effort: a failed webhook or hook never fails a run — the
alert is already durable in the local log regardless of sink delivery.

## Storage Model

Everything monitor writes is plain, human-readable JSON in the workspace:

```text
detections/                          Raw findings documents from sweeps and case traces
detections/reviewed/                 Reviewer-stamped copies (the hand-off artifact)
cases/<case-id>/case.json            Case definition
cases/<case-id>/snapshots/           One snapshot per run that traced this case
.chain-insights/monitor/config.json  Monitor configuration
.chain-insights/monitor/runs/        One run document per `monitor run`
.chain-insights/monitor/alerts/      Alert stream and acknowledgements
.chain-insights/monitor/reviews/     Review decision records
```

This canonical JSON is always the source of truth. Alongside it,
`.chain-insights/monitor/monitor.duckdb` holds a **derived** index built
purely from that JSON — fast to query, never authoritative, and always
reconstructable:

```bash
cia monitor rebuild
```

For ad-hoc analysis, open the derived store directly with the DuckDB CLI:

```bash
duckdb -readonly .chain-insights/monitor/monitor.duckdb -ui
```

## Cost Controls

Chain Insights Graph access is metered. Every run records the remaining
execution-time allowance before and after it runs, in the run document under
`.chain-insights/monitor/runs/`. Set a floor to stop a run before it spends
allowance you want to keep in reserve:

```json
{ "stopIfRemainingBelow": 30 }
```

When the remaining allowance drops below this floor, `cia monitor run` halts
before running any sweep cells or case traces for that pass and records the
halt reason in the run document. Leave it unset to run unconditionally.

## Exit Codes

`cia monitor run` (and each iteration of `cia monitor watch`) uses its exit
code to signal how the pass went, so cron and CI can tell a clean run from a
partial one from a broken one:

| Code | Meaning |
| --- | --- |
| `0` | Clean run — every sweep cell and case trace completed. |
| `2` | One or more sweep cells or case traces failed in isolation; every other cell still ran, and any findings or alerts it produced still landed. |
| `1` | Hard failure — the run could not start at all (for example, an unreadable workspace or an invalid monitor config). |
