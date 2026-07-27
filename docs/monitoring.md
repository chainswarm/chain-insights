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

For a standing watch, put `cia monitor run` on a schedule — see
[Scheduling](#scheduling).

Two read-only commands give you a pulse check without waiting for a report:

```bash
cia monitor status   # cells, open cases, pending reviews, unacked alerts, last run — one line
cia monitor report   # markdown rollup: recent runs, pending review, unacked alerts, case timelines
```

### Network scoping

Several network views share ONE address-grain topology graph. The `network`
value on a cell selects **the graph**, not the subset of addresses inside it —
the split between address spaces lives on the `:Address.network` node property.
`bittensor` and `bittensor_evm` cells therefore read the same underlying data
and are separated by that property alone.

The shipped detectors scope themselves by the node property, so a configured
matrix sweeps the address space you asked for. It matters when you write your
own monitoring query by hand: an unscoped `:Address` match returns every
network's addresses, which means wrong-network findings at double the metered
cost. See [Graph query compatibility](graph-query-compatibility.md) for the
query-level rule.

Only `USE facts` gives each network its own backing database, and the facts
`Address` label carries no `network` property at all — a facts query that
projects it fails outright.

## Full-State vs Incremental Detectors

Detectors come in two shapes, and they mean different things by "new":

| Shape | Detectors | Run state |
| --- | --- | --- |
| **Incremental** | `address-poisoning` | Reads a bounded time window and advances a scan checkpoint. The next run starts where this one stopped. |
| **Full-state** | `fake-token`, `mixer`, `attack-attribution` | Classifies an address from its *current* cumulative graph state (degree metrics, taxonomy labels, the verified-asset registry). A time window would make it wrong, so it keeps no checkpoint; it records the findings it has already emitted instead. |

A full-state detector re-derives its entire result set on every run. Emitting
that verbatim would republish thousands of already-reviewed findings every hour
and drown the review backlog, so a run emits only the findings it has not shown
you before, and notes any suppressed count in the document's `warnings`.

**An unchanged run therefore legitimately produces a findings document with
zero findings.** That is the intended behavior, not a failed sweep, a broken
endpoint, or a misconfigured cell. Empty documents are still written and still
replayed by `cia monitor rebuild` — they are provenance, carrying the run
record and the suppression count — but they are not listed as pending review
work, so a standing schedule does not bury the real items under empty ones.

Both kinds of run state advance only *after*
the findings document is durably on disk, so a pass that dies mid-write
re-emits next time rather than losing findings.

### The `--full` escape hatch

To deliberately re-emit a detector's whole result set — after a bad review
pass, a wiped workspace, or a changed threshold — run the detector directly
with `--full`. It ignores the checkpoint, resets the emitted-findings state,
and republishes everything:

```bash
cia detect mixer --network bittensor --full
```

`cia monitor run` never passes `--full`. A scheduled pass is always the
new-only path by design; `--full` stays a deliberate, manual act.

## Scheduling

`cia monitor run` is a **one-shot**: it performs a single pass and exits. That
is deliberate — the monitor core is one-shot and idempotent, never a stateful
service, so an interrupted process cannot leave half-written state.

For a standing watch, the recommended pairing is **pm2 supervising
`cia monitor watch`**: `watch` owns the loop (interval from `intervalSeconds`
in the monitor config), pm2 owns process lifetime (crash restart, logs, status,
boot persistence). Each tool does the one job it is built for, and
`pm2 list` showing `online` means exactly what it appears to mean.

| Option | Choose it when | Cost |
| --- | --- | --- |
| **pm2 + `monitor watch`** | You want a supervised standing watch: crash restart, one log surface, one status command. | pm2 installed; one config file. |
| `cron` + `monitor run` | The host already runs cron and you have external log plumbing. | No status surface; you own log capture and failure visibility. |
| bare `cia monitor watch` | Interactive session, ad-hoc coverage for a few hours. | Dies with the shell; nothing restarts it. |

Do not run two of these against the same workspace. Passes are idempotent, but
overlapping schedules double the metered graph spend for no extra coverage.

### pm2 + watch (recommended)

A working `ecosystem.config.cjs`, run from the monitoring workspace root:

```js
// pm2 supervises `cia monitor watch` — a long-running loop that re-runs a
// monitoring pass on the interval configured in
// .chain-insights/monitor/config.json (intervalSeconds).
//
// pm2's job here is process lifetime: if the loop dies, pm2 restarts it, and
// `watch` resumes cleanly — a killed and restarted watch loses no alerts and
// re-emits nothing over unchanged data. A failed pass does NOT kill the loop:
// `watch` logs it and keeps looping.
module.exports = {
  apps: [
    {
      name: 'cia-monitor',
      // Globally installed CLI; use an absolute path to a checkout's
      // bin/cli.js plus `interpreter: 'node'` if you run from source, or if
      // `cia` is not on pm2's PATH.
      script: 'cia',
      args: 'monitor watch',
      // The monitoring workspace root.
      cwd: './',
      autorestart: true,
      // Backstop against a crash loop (e.g. a broken config that fails every
      // start): give up after 10 rapid restarts instead of looping forever.
      max_restarts: 10,
      min_uptime: '30s',
      time: true,
      merge_logs: true,
      out_file: './.chain-insights/monitor/pm2-out.log',
      error_file: './.chain-insights/monitor/pm2-err.log',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
```

Bring it up and confirm the first pass before walking away:

```bash
pm2 start ecosystem.config.cjs
pm2 list                            # `online` = healthy
pm2 logs cia-monitor --lines 50
```

Reading the surface:

- **`online`** — the loop is alive. This is the steady state.
- **`errored` / climbing restart counter** — the loop itself is dying
  (bad config, missing workspace). `watch` survives failed *passes*, so a
  dying loop means something structural; read the error log.
- A successful pass writes a run document under
  `.chain-insights/monitor/runs/` and prints nothing — check `cia monitor
  status` for `last run`, not the pm2 log, to confirm passes are landing.

Persistence needs **two** separate steps; doing only the first is the usual
mistake:

```bash
pm2 save           # persist the process list so `pm2 resurrect` can restore it
sudo pm2 startup   # prints a platform-specific boot line — run what it prints
```

`pm2 save` does not make pm2 itself start at boot. Run the command
`pm2 startup` prints, then `pm2 save` again. Without both, the watch stops
silently at the next reboot.

### cron

```text
0 * * * * cd /path/to/workspace && cia monitor run
```

Per-pass exit codes are visible to cron (`0` clean, `2` isolated cell failure,
`1` run failed) — wire them to whatever alerting the host already has.

### Do not pair pm2 with `monitor run`

The tempting hybrid — pm2 launching the one-shot `monitor run` on a
`cron_restart` schedule — works, but it is the worst of both worlds and one
setting away from an expensive failure: pm2's default is to treat any process
exit as a crash and relaunch immediately, and a one-shot exits on every
successful pass. Without `autorestart: false` that default produces a hot loop
that re-runs the full detector matrix continuously and burns metered graph
allowance until someone notices. Between passes the process shows `stopped`,
which reads as broken and hides nothing useful. If you want pm2, supervise
`watch`; if you want one-shots, use cron.
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

### Growing and narrowing a case

Seeds are **not** fixed at creation. Investigations grow: an operator wallet
surfaces, an intermediate coldkey turns out to fund the same exchange deposit,
a new corridor branch resolves. Widen the case in place — its snapshot history
and its movement timeline are preserved:

```bash
cia monitor case add-seed theft-1 \
  --address 5Operator...address \
  --note "second controlled wallet identified"

cia monitor case add-seed theft-1 --address 5AddrA... 5AddrB...   # several at once
cia monitor case remove-seed theft-1 --address 5AddrA...
```

- **Idempotent.** Re-adding an existing seed is a no-op, not an error, so a
  scripted `add-seed` is safe to re-run. Same for removing an address that is
  not a seed.
- **Open cases only.** Both commands refuse on a closed case. A closed case is
  a historical record of what was investigated and when; the run loop does not
  re-trace it, so a seed added to it would sit in canonical JSON with no
  snapshot behind it. If a closed investigation needs to grow, open a new case
  with the wider seed set.
- **A case always has at least one seed.** `remove-seed` refuses the removal
  that would empty it.
- Addresses approved through [review](#review--labels) join the traced seed set
  automatically and are not listed in `seeds`; `remove-seed` does not apply to
  them.
- The addition is recorded on the case: `seeds_added_at_timestamp` (address → when it
  became a seed) and a `seed_events` timeline entry carrying your `--note`.

### Why a widened corridor is not a movement

Movements are derived by diffing each snapshot against the one before it, so
adding a seed poses a real hazard: the next run legitimately sees more
addresses, and a naive diff would report every one of them as a new hop — as
though funds had moved, when in fact only the aperture widened. On a theft case
that is a fabricated forensic signal.

Chain Insights separates the two. Each snapshot records, per address, which
seed(s) reached it (`via_seeds`). On the next diff:

| Address is reachable from | Reported as |
| --- | --- |
| a seed that already existed at the previous snapshot | **movement** — the corridor changed under a fixed aperture |
| only seeds added since the previous snapshot | **scope expansion** — it was always there; you just could not see it |

Scope expansion is not silently dropped: it appears in the run document as
`scope_expansions_count`, in the derived store's `case_movements` table as
`movement = 'scope_expansion'` (with the seed and its timestamp in the
details), and on the alert stream as `case_scope_expansion`. That is what
explains the discontinuity in the case timeline to whoever reads it later.

Classification signals still apply to whatever is in the corridor however it
got there: an exchange terminal or a scam hub that entered through a new seed
still raises `cashout_endpoint` / `frontier_candidate` and still enters the
review queue — suppressing it would hide the convergence the `add-seed` was
performed to find. Only the *movement* claim is withheld.

A subsequent run over unchanged data is quiet again: the expanded corridor is
the new baseline.

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

### Quarantine, do not delete

When a findings document is wrong — a misconfigured threshold, a
wrong-network sweep, a detector bug — **reject it rather than deleting the
file**:

```bash
cia monitor review reject <doc-path> --reviewer alice
```

Deleting looks tidier and costs you the two things that matter. The decision
record disappears, so nothing distinguishes "reviewed and wrong" from "never
reviewed", and the audit trail of what monitoring proposed at a given time
loses a document it once contained. A rejected document is inert: it feeds
neither label export nor case expansion, and no reviewed copy is written.

If you need the bad batch out of the working set entirely, move the raw
documents into a workspace-local quarantine directory you keep alongside the
originals — for example `detections/quarantine/` — after recording the
rejection, so the reason travels with the files. Then fix the cause and
re-emit with `--full` (see [The `--full` escape hatch](#the---full-escape-hatch))
rather than hand-editing findings, which are machine output and are not meant
to be edited.

## Alerts

Every run emits alerts for new findings and for case movements worth
attention (cashout endpoints, frontier candidates for review). A
`case_scope_expansion` alert is distinct from `case_movement`: it says the case
corridor grew because seeds were added, not because funds moved (see
[Why a widened corridor is not a movement](#why-a-widened-corridor-is-not-a-movement)):

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

## Watchlist

Cases are incident-centric ("this theft, this scam cluster"). The watchlist is
**address-centric**: it tells you when the things monitoring already detects
touch *your own* addresses.

```bash
cia monitor watchlist add 5GTj... --network bittensor --note "treasury cold"
cia monitor watchlist list
cia monitor watchlist remove 5GTj... --network bittensor
```

An address plus a network is the identity, so the same string on two networks
is two entries, and re-adding an address updates its note instead of failing.
The list lives in `.chain-insights/monitor/watchlist.json`, which is plain JSON
and equally valid to hand-edit.

Enable the feature by adding a `watchlist` block to
`.chain-insights/monitor/config.json`. An empty block turns it on with
defaults; no block at all means the feature is off and a run behaves exactly
as before:

```json
{
  "watchlist": {
    "dustMaxUsd": 1.0,
    "dustLookbackSeconds": 86400,
    "enabled": true
  }
}
```

- `dustMaxUsd` (default `1.0`) — the incoming-transfer USD ceiling counted as
  dust.
- `dustLookbackSeconds` (default `86400`) — how far back the dust check looks.
  Overlapping windows are safe: hits are deduplicated by their source
  reference, so the same transfer never alerts twice.
- `enabled` (default `true` when the block is present) — an off switch that
  keeps your addresses in place.

### The three triggers

| Trigger | Alert type | What it means |
| --- | --- | --- |
| A detector finding names a watched address | `watchlist_finding` | A fake-token, address-poisoning, attack-attribution, or mixer sweep implicated one of your addresses. |
| A tracked case's movement reaches a watched address | `watchlist_movement` | Funds from an open incident moved to an address you watch. |
| Incoming dust below `dustMaxUsd` | `watchlist_dust` | The opening move of address poisoning: a tiny inbound transfer that a network-wide detector may not flag on its own, but that matters against *your* address. |

All three flow through the normal alert stream — `alerts list`, `alerts ack`,
webhook and exec sinks, and the report — rather than a parallel notification
system. `cia monitor report` gains a **Watchlist** section listing each
watched address with its hit counts by trigger.

The first two triggers are answered entirely from data the run already
produced locally, so they cost nothing extra. The dust check is one batched
graph query per distinct network, so a 500-address watchlist costs the same as
a 5-address one. Nothing in the watchlist scales with the number of addresses
you watch.

### Address risk is not a trigger

Monitoring never polls an address risk score. Risk is a *final product* — an
enrichment surface you read about an address once you have a reason to look at
it — not a monitoring input. Polling it per watched address would spend
metered allowance re-reading a downstream result rather than watching a
threat. The watchlist watches the detectors and the case tracker; use
`cia` risk screening when you want a verdict on a specific address.

## Storage Model

Everything monitor writes is plain, human-readable JSON in the workspace:

```text
detections/                          Raw findings documents from sweeps and case traces
detections/reviewed/                 Reviewer-stamped copies (the hand-off artifact)
cases/<case-id>/case.json            Case definition (seeds, seeds_added_at_timestamp, seed_events)
cases/<case-id>/snapshots/           One snapshot per run that traced this case
.chain-insights/monitor/config.json  Monitor configuration
.chain-insights/monitor/runs/        One run document per `monitor run`
.chain-insights/monitor/alerts/      Alert stream and acknowledgements
.chain-insights/monitor/reviews/     Review decision records
.chain-insights/monitor/watchlist.json  Watched addresses (address-centric alerting)
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

## Investigation Output

Every run ends with a render pass that turns each open case into
human-readable Markdown under `published/cases/<case_id>/`:

- `dossier.md` — the case dossier: an **ACTIVE (last movement `<date>`)** or
  **DORMANT since `<date>`** headline verdict, a funds-destination summary by
  terminal endpoint class, exchange deposit endpoints with labels where known,
  the scammer-cluster address list with roles, a bounded Mermaid diagram of
  the money flow, and links to the HTML graph reports under `reports/`.
- `addresses/<addr>.md` — one note per notable address (seeds, deposit
  candidates, exchanges): roles, labels, first/last seen, link back to the
  dossier. Rewritten on every render.
- `timeline.md` — append-only, one line per alert. Existing lines are never
  rewritten.

The verdict, diagram, and tables are computed from persisted
`chain-insights.trace.v1` artifacts written by the render pass itself: on a
case **change** (new snapshot content, movement, or alert) the pass re-traces
the case seeds as victim funds and as suspect funds through the standard trace
tools, persists the trace documents under `cases/<case_id>/traces/`, and
re-renders. An unchanged case skips tracing entirely, so the hourly cost of a
quiet watch is near zero.

Render on demand with:

```bash
cia monitor render            # all open cases (changed ones re-trace)
cia monitor render my-case    # one case
cia monitor render --force    # re-trace and re-render even when unchanged
```

A case with no traced movement for `render.dormant_after_days` days (default
30) is reported DORMANT:

```json
{ "render": { "dormant_after_days": 30 } }
```

The workspace is plain Markdown, so it doubles as an Obsidian vault: open the
workspace directory directly in Obsidian (or point an Obsidian MCP server at
it) — no copy step, no second vault.

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

`cia monitor run` uses its exit code to signal how the pass went, so cron and
CI can tell a clean run from a partial one from a broken one:

| Code | Meaning |
| --- | --- |
| `0` | Clean run — every sweep cell and case trace completed. |
| `2` | One or more sweep cells or case traces failed in isolation; every other cell still ran, and any findings or alerts it produced still landed. |
| `1` | Hard failure — the run could not start at all (for example, an unreadable workspace or an invalid monitor config). |

Exit `2` is a **partial success**. Whatever scheduler you use must be able to
express the difference between `1` and `2`, or a single flaky cell will page
someone as though nothing ran.

Under `cia monitor watch` the process does not exit between passes, so
per-pass exit codes are not visible to the supervisor. An isolated cell
failure is recorded on the cell entry in that pass's run document
(`.chain-insights/monitor/runs/<run_timestamp>.run.json`, `error` field) — check
there, or `cia monitor status`, rather than expecting pm2 to flag it.

## Related

- Skill `chain-insights-monitoring` — agent-facing routing, the detector
  matrix, review boundary, and scheduling, including
  `references/pm2-scheduling.md`.
- [Investigation workspaces](investigation-workspaces.md) — how a monitor
  workspace relates to an investigation workspace.
- [Graph query compatibility](graph-query-compatibility.md) — the shared
  address-grain topology graph and the network-scoping rule.
