---
name: chain-insights-monitoring
description: Use when the user wants a standing view rather than a one-shot investigation — scheduling `cia monitor`, tracking a stolen-funds or scam-topology case over time, reading case dossiers, or interpreting monitor exit codes and pm2/cron scheduling.
---

# Chain Insights Monitoring

`cia monitor` is the standing-view surface. Use it when the question is
"show me this case's dossier again later", not "what does this address look
like right now".

| The user wants | Use |
| --- | --- |
| A verdict on one address, now | `chain-insights-address-risk` |
| A one-shot investigation, now | `chain-insights-investigation` |
| A case tracked and re-rendered over time | **this skill** |

Monitoring is not a different data source. It re-renders each open case's
dossier from the case document on a schedule. Everything lands as plain
files in the workspace; nothing is pushed anywhere.

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
2. Take one pass by hand before automating it:
   ```bash
   cia monitor run
   cia monitor status
   ```
   `status` prints the open cases and the last run timestamp.

## The Case Surface

A monitor pass renders the dossier of every **open** case. A case anchors one
investigation to seed addresses:

```bash
cia monitor case add theft-1 --type stolen-funds --network robinhood --seed 0xSeed...address
cia monitor case list
cia monitor case close theft-1
```

`--type` is `stolen-funds` (victim funds, cashout tracking) or `scam-topology`
(cluster expansion under review). A case ID is lowercase letters, digits, and
hyphens.

### Seeds are not fixed at creation

Investigations grow. Widen or narrow an **open** case in place, keeping its
seed history:

```bash
cia monitor case add-seed theft-1 --address 0xOperator...address --note "operator wallet identified"
cia monitor case remove-seed theft-1 --address 0xWrong...address
```

Both are idempotent (re-adding an existing seed is a no-op, not an error), both
are **refused on a closed case** — a closed case is a historical record, so
open a new case with the wider seed set instead — and a case can never be left
with zero seeds. The addition is stamped onto `case.json` as
`seeds_added_at_timestamp` plus a `seed_events` entry carrying the note. Never
hand-edit `case.json` to expand a case; use `add-seed`, or the continuity
below is lost.

## Dossier Rendering

Every pass renders each open case from its document:

- `published/cases/<case_id>/dossier.md` — headline verdict, seeds, and a
  money-flow diagram.
- `published/cases/<case_id>/addresses/<addr>.md` — one note per seed.
- `published/cases/<case_id>/timeline.md` — seed events in order.

**An unchanged case is skipped, not re-rendered.** Rendering is content-keyed
(sha256 over `case.json`): the run document records
`skipped_reason: 'unchanged'`, so a quiet watch is provably healthy rather
than silently idle. A closed case is skipped with `skipped_reason: 'closed'`.

The dossier headline is ACTIVE or DORMANT, computed from case activity —
creation and seed events — against `render.dormant_after_days` (default 30).
`render.dormant_after_days` is the only render knob:

```json
{ "render": { "dormant_after_days": 30 } }
```

Render on demand:

```bash
cia monitor render            # all open cases
cia monitor render theft-1    # one case
cia monitor render --force    # re-render even when unchanged
```

## Exit Codes

`cia monitor run` signals the pass through its exit code:

| Code | Meaning | What to do |
| --- | --- | --- |
| `0` | Clean pass; every open case rendered. | Nothing. |
| `2` | **Isolated case failure.** One or more cases failed; every other case still rendered. | Read the `[monitor]   <case_id> FAILED:` lines; the pass itself is sound. |
| `1` | Hard failure — the run could not start (unreadable workspace, invalid config). | Fix before the next scheduled pass; nothing ran. |

`2` is a **partial success**, not a crash. Any scheduler you use must be able
to express that difference, or you will page someone for a single flaky case.

Under `cia monitor watch` the process never exits between passes, so exit
codes are not visible per pass. An isolated case failure shows up as the
`error` field on the case entry in that pass's run document and in
`cia monitor status` — not in the supervisor.

## Scheduling

`cia monitor run` is a **one-shot**: one pass, then exit. The core is one-shot
and idempotent so a killed process never corrupts state. For a standing watch,
the recommended pairing is **pm2 supervising `cia monitor watch`**: `watch`
owns the loop (interval from the monitor config), pm2 owns process lifetime —
crash restart, logs, status, boot persistence. `pm2 list` showing `online`
means healthy; a killed and restarted watch loses no state and re-renders
nothing over unchanged cases.

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
the one-shot `monitor run`**: pm2's default treats every clean exit as a
crash, and without `autorestart: false` it re-launches the pass continuously.
Supervising `watch` avoids that trap entirely.

## Pulse Checks

```bash
cia monitor status   # open cases and the last run
```

Canonical JSON under `.chain-insights/monitor/` and `cases/` is always the
source of truth. The append-only run log
(`.chain-insights/monitor/logs/monitor-runs.jsonl`) is the pass record.

## Hard Rules

- Run every `cia monitor` command from the workspace root.
- Never present monitor output as a graph-backed verdict — the dossier is
  document-derived (seeds + timeline), not a live graph re-trace. Use
  `aml_address_risk` or `graph_query` for current-state answers.
- Never hand-edit `case.json`; use the `case` commands so seed history and
  the dossier timeline stay consistent.
- Never treat exit `2` as a broken deployment.
- Never schedule a pass you have not run once by hand.
