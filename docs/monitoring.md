# Continuous Monitoring

`cia monitor` turns Chain Insights from a one-shot investigation tool into a
standing view of your cases. It re-renders each open case's dossier on a
schedule. The typical operator is a **theft victim** watching their own stolen
funds, or an analyst tracking a scam cluster over time.

Everything lands as plain files in the workspace. Nothing is pushed anywhere:
render output stays local until the operator exports or publishes it.

## Victim Quick Start (stolen funds)

One command takes you from "my wallet was drained" to a configured,
scheduled watch:

```bash
cia init .
cia monitor init victim --case-id my-theft --network robinhood \
  --seed 0xYourDrainedWallet... --note "drained 2026-07-27"
cia monitor run     # first pass: renders the dossier
cia monitor watch   # hourly loop (pm2 snippet under "Scheduling")
```

`monitor init victim` writes the minimal config
(`intervalSeconds: 3600`), creates the stolen-funds case, and refuses to
overwrite an existing monitor config. Editing an initialized workspace is a
direct config edit, never a re-init.

What you get:

- **The case dossier** — after the first pass, a human-readable Markdown
  dossier lands at `published/cases/<case-id>/dossier.md`: the seeds, the
  case verdict (ACTIVE/DORMANT), a money-flow diagram, per-address notes,
  and a timeline. Re-rendered whenever the case document changes.

The ACTIVE/DORMANT verdict measures case activity: creation and seed
events (add/remove). A case with no activity for `render.dormant_after_days`
(days, default 30) reads DORMANT:

```json
{ "render": { "dormant_after_days": 30 } }
```
- **A standing view** — `cia monitor status` shows open cases and the last
  successful run; `cia monitor run` is safe to put on any schedule.

## The Command Surface

| Command | What it does |
| --- | --- |
| `cia monitor run` | One pass: render the dossier of every open case |
| `cia monitor watch` | Loop `monitor run` on an interval (thin daemon; cron + `monitor run` works too) |
| `cia monitor render` | Re-render all open cases, or one case by id; `--force` re-renders unchanged cases |
| `cia monitor status` | Open cases and the timestamp of the last run |
| `cia monitor init victim` | Bootstrap the victim profile (case + config in one command) |
| `cia monitor case add` | Register a case with one or more seed addresses |
| `cia monitor case list` | List cases (open by default; `--all` includes closed) |
| `cia monitor case add-seed` | Add seed addresses to an open case (timestamped, idempotent) |
| `cia monitor case remove-seed` | Remove seed addresses from an open case (idempotent) |
| `cia monitor case close` | Close a case; the run loop stops re-tracing it |

Every command runs from the workspace root. No monitor output belongs under
`~/.chain-insights`.

## Cases

A case anchors one investigation — a stolen-funds corridor or a scam cluster —
to one or more seed addresses:

```bash
cia monitor case add theft-1 \
  --type stolen-funds \
  --network robinhood \
  --seed 0xSeed...address

cia monitor case list
cia monitor case close theft-1
```

Case rules:

- `--type` is `stolen-funds` (victim funds, cashout tracking) or
  `scam-topology` (cluster expansion under review). A case ID is lowercase
  letters, digits, and hyphens.
- A case always has at least one seed. `remove-seed` refuses the removal
  that would empty it.
- Only open cases are re-run. A closed case is a historical record; the run
  loop skips it.

### Growing and narrowing a case

Seeds are not fixed at creation. Investigations grow — an operator wallet
surfaces, a new corridor branch resolves. Widen the case in place; its seed
history is preserved:

```bash
cia monitor case add-seed theft-1 \
  --address 0xSecondOperator... \
  --note "second controlled wallet identified"

cia monitor case remove-seed theft-1 --address 0xWrong...
```

- **Idempotent.** Re-adding an existing seed is a no-op, not an error.
  Removing an address that is not a seed is a no-op too.
- **Open cases only.** Both commands refuse on a closed case. To re-open an
  investigation, create a new case with the wider seed set.
- The addition is recorded on the case: `seeds_added_at_timestamp` (address
  → when it became a seed) and a `seed_events` timeline entry carrying your
  `--note`.

## Dossier Rendering

Every pass renders each open case's dossier from the case document:

- `published/cases/<case_id>/` — the dossier
  - `dossier.md` — headline **ACTIVE** / **DORMANT** verdict, seed list,
    money-flow diagram, per-address notes, and the case timeline.
  - `addresses/<addr>.md` — one note per seed address: roles, first/last
    seen, link back to the dossier.
  - `timeline.md` — seed events in order.

Rendering is content-keyed: a case whose document is unchanged since the last
render is **skipped** (`skipped_reason: 'unchanged'`), so a quiet watch costs
nothing. A closed case is skipped with `skipped_reason: 'closed'`. Render on
demand with:

```bash
cia monitor render            # all open cases
cia monitor render theft-1    # one case
cia monitor render --force    # re-render even when unchanged
```

The workspace is plain Markdown, so it doubles as an Obsidian vault. Open the
workspace directory directly in Obsidian — no copy step, no second vault.

## Scheduling

`cia monitor run` is a **one-shot**: one pass and exit. That is deliberate —
the monitor core is one-shot and idempotent, so an interrupted process cannot
leave half-written state.

For a standing watch, the recommended pairing is **pm2 supervising
`cia monitor watch`**: `watch` owns the loop (interval from `intervalSeconds`
in the monitor config), pm2 owns process lifetime (restart on crash, logs,
status, boot persistence). Each tool does the one job it is built for, and
`pm2 list` showing `online` means exactly what it appears to mean.

| Option | Choose it when | Cost |
| --- | --- | --- |
| **pm2 + `monitor watch`** | You want a supervised standing watch: crash restart, one log surface, one status command. | pm2 installed; one config file. |
| `cron` + `monitor run` | The host already runs cron and you have external log plumbing. | No status surface; you own log capture and failure visibility. |
| bare `cia monitor watch` | Interactive session, ad-hoc coverage for a few hours. | Dies with the shell; nothing restarts it. |

Do not run two of these against the same workspace. Passes are idempotent, but
overlapping schedules double the work for no extra coverage.

### pm2 + watch (recommended)

A working `ecosystem.config.cjs`, run from the workspace root:

```js
// pm2 supervises `cia monitor watch` — a long-running loop that re-runs a
// monitoring pass on the interval configured in
// .chain-insights/monitor/config.json (intervalSeconds).
//
// pm2's job here is process lifetime: if the loop dies, pm2 restarts it, and
// `watch` resumes cleanly — a killed and restarted watch loses no state and
// re-renders nothing over unchanged cases. A failed pass does NOT kill the
// loop: `watch` logs it and keeps looping.
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
      // start): give up after 25 rapid restarts instead of looping forever.
      max_restarts: 25,
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
  `.chain-insights/monitor/runs/` and prints nothing — check
  `cia monitor status` for `last run`, not the pm2 log, to confirm passes are
  landing.

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

Per-pass exit codes are visible to cron (`0` clean, `2` isolated case
failure, `1` run failed) — wire them to whatever alerting the host already
has.

### Do not pair pm2 with `monitor run`

The tempting hybrid — pm2 launching the one-shot on a `cron_restart`
schedule — is the worst of both worlds: pm2's default treats every clean
exit as a crash and immediately relaunches, and the input flips a hot loop
instead of a scheduled pass. Between passes the process shows `stopped`,
which reads as broken and hides nothing useful. If you want pm2, supervise
`watch`; if you want one-shots, use cron.

## Storage Model

Everything monitor writes is plain, human-readable JSON in the workspace:

```text
cases/<case-id>/case.json                The case definition (seeds, seed events, timestamps)
.chain-insights/monitor/config.json      Monitor configuration (intervalSeconds, render)
.chain-insights/monitor/render-state.json  Per-case render keys (sha256 of case.json)
.chain-insights/monitor/logs/monitor-runs.jsonl  Append-only run log (one line per pass)
.cia-monitor.lock                        Run lock (pid of the active pass)
published/cases/<case-id>/dossier.md     Rendered case dossier
published/cases/<case-id>/addresses/     Per-address notes
published/cases/<case-id>/timeline.md    Append-only timeline (one line per seed event)
```

`case.json` is canonical. `render-state.json` is derived and optional; the
renderer rebuilds it from the case files. `monitor-runs.jsonl` is
append-only (last line wins on read). The run lock serializes concurrent
passes — a second `monitor run` while one is active exits with
`[monitor] already running`.

## Exit Codes

`cia monitor run` signals the pass through its exit code, so cron and CI can
tell a clean run from a partial one from a broken one:

| Code | Meaning |
| --- | --- |
| `0` | Clean pass — every open case rendered. |
| `2` | One or more cases failed in isolation; every other case still rendered. |
| `1` | Hard failure — the run could not start at all (unreadable workspace, invalid monitor config). |

Exit `2` is a **partial success**. Whatever scheduler you use must be able
to express the difference between `1` and `2` — or a single flaky case will
page someone as though nothing ran.

Under `cia monitor watch` the process does not exit between passes, so
per-pass exit codes are not visible to the supervisor. An isolated failure
is recorded in the pass's run document and in the per-pass case outcomes —
check there, or `cia monitor status`, rather than expecting pm2 to flag it.

## Monitor Config

`.chain-insights/monitor/config.json` is operator-owned JSON. Fail-fast
validation: an unreadable or invalid config fails the run loudly rather than
silently monitoring something else.

```json
{
  "intervalSeconds": 3600,
  "render": { "dormant_after_days": 30 }
}
```

Both keys are optional:

- `intervalSeconds` (default `3600`) — the loop delay for `monitor watch`
- `render.dormant_after_days` (default `30`) — the DORMANT threshold

## Related

- Skill `chain-insights-monitoring` — agent-facing routing, case tracking,
  and scheduling, including `references/pm2-scheduling.md`.
- [Investigation workspaces](investigation-workspaces.md) — how a monitor
  workspace relates to an investigation workspace.