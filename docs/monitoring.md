# Continuous Monitoring

`cia monitor` turns Chain Insights from a one-shot investigation tool into a
standing view of your cases. It re-renders each open case's dossier on a
schedule. The typical operator is a **theft victim** watching their own stolen
funds, or an analyst tracking a scam cluster over time.

Everything lands as plain files in the workspace. Nothing is pushed anywhere:
render output stays local until the operator exports or publishes it.

## Victim Quick Start (stolen funds)

One command takes you from "my wallet was drained" to a configured,
tracked case:

```bash
cia init .
cia monitor init victim --case-id my-theft --network robinhood \
  --seed 0xYourDrainedWallet... --note "drained 2026-07-27"
cia monitor run     # first pass: renders the dossier
```

`monitor init victim` writes the minimal config (every key defaults),
creates the stolen-funds case, and refuses to overwrite an existing monitor
config. Editing an initialized workspace is a direct config edit, never a
re-init. To keep the dossier fresh, schedule `cia monitor run` — see
"Scheduling" below.

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
| `cia monitor render` | Re-render all open cases, or one case by id; `--force` re-renders unchanged cases |
| `cia monitor status` | Open cases and the timestamp of the last run |
| `cia monitor init victim` | Bootstrap the victim profile (case + config in one command) |
| `cia monitor case add` | Register a case with one or more seed addresses |
| `cia monitor case list` | List cases (open by default; `--all` includes closed) |
| `cia monitor case add-seed` | Add seed addresses to an open case (timestamped, idempotent) |
| `cia monitor case remove-seed` | Remove seed addresses from an open case (idempotent) |
| `cia monitor case close` | Close a case; passes skip it |

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
leave half-written state. There is no built-in loop: an external scheduler
owns the interval.

| Option | Choose it when | Cost |
| --- | --- | --- |
| `cron` + `monitor run` | The host already runs cron. Per-pass exit codes (`0`/`2`/`1`) are visible to cron. | You own log capture and failure visibility. |
| pm2 `cron_restart` + `monitor run` | You already supervise other processes with pm2 and want one log surface. | `autorestart: false` is mandatory — see below. |
| Agent harness scheduled tasks | An agent already runs on a schedule in this workspace. | The harness owns cadence and logs. |

Do not run two of these against the same workspace. Passes are idempotent, but
overlapping schedules double the work for no extra coverage.

### cron

```text
0 * * * * cd /path/to/workspace && cia monitor run
```

Per-pass exit codes are visible to cron (`0` clean, `2` isolated case
failure, `1` run failed) — wire them to whatever alerting the host already
has.

### pm2

pm2 can launch the one-shot on a `cron_restart` schedule. One setting is
mandatory: **`autorestart: false`**. Without it pm2 treats every clean exit
as a crash and immediately relaunches — a hot loop instead of a scheduled
pass.

```js
// pm2 runs `cia monitor run` hourly. autorestart: false is what makes the
// one-shot safe under pm2: a finished pass stays finished until the next
// cron_restart tick.
module.exports = {
  apps: [
    {
      name: 'cia-monitor',
      // Globally installed CLI; use an absolute path to a checkout's
      // bin/cli.js plus `interpreter: 'node'` if you run from source, or if
      // `cia` is not on pm2's PATH.
      script: 'cia',
      args: 'monitor run',
      // The monitoring workspace root.
      cwd: './',
      autorestart: false,
      cron_restart: '0 * * * *',
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
pm2 logs cia-monitor --lines 50
cia monitor status   # `last run` confirms passes are landing
```

Between passes pm2 shows the process as `stopped` — that is the expected
state for a scheduled one-shot, not a failure. A successful pass writes a run
document under `.chain-insights/monitor/logs/monitor-runs.jsonl`; check
`cia monitor status` for `last run`, not the pm2 process state.

Persistence needs **two** separate steps; doing only the first is the usual
mistake:

```bash
pm2 save           # persist the process list so `pm2 resurrect` can restore it
sudo pm2 startup   # prints a platform-specific boot line — run what it prints
```

`pm2 save` does not make pm2 itself start at boot. Run the command
`pm2 startup` prints, then `pm2 save` again. Without both, the schedule stops
silently at the next reboot.

## Storage Model

Everything monitor writes is plain, human-readable JSON in the workspace:

```text
cases/<case-id>/case.json                The case definition (seeds, seed events, timestamps)
.chain-insights/monitor/config.json      Monitor configuration (render)
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

## Monitor Config

`.chain-insights/monitor/config.json` is operator-owned JSON. Fail-fast
validation: an unreadable or invalid config fails the run loudly rather than
silently monitoring something else.

```json
{
  "render": { "dormant_after_days": 30 }
}
```

Every key is optional:

- `render.dormant_after_days` (default `30`) — the DORMANT threshold

## Related

- Skill `chain-insights-monitoring` — agent-facing routing, case tracking,
  and scheduling, including `references/pm2-scheduling.md`.
- [Investigation workspaces](investigation-workspaces.md) — how a monitor
  workspace relates to an investigation workspace.