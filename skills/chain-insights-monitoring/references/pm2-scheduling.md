# Scheduling `cia monitor` with pm2

`cia monitor run` is a one-shot: one pass, then exit. pm2 can own the
schedule with `cron_restart`. One setting is mandatory:

- **`autorestart: false`** — pm2's default treats any process exit as a
  crash and relaunches immediately. A one-shot exits on every successful
  pass, so the default produces a **hot loop** that re-runs the pass
  continuously until someone notices.
- **`cron_restart`** owns the interval — pm2 starts a fresh pass on the
  cron expression, independent of process state.

Between passes pm2 shows the process as `stopped`. That is the expected
steady state for a scheduled one-shot, not a failure.

## Example `ecosystem.config.cjs`

Place this in the monitoring workspace root.

```js
// pm2 runs `cia monitor run` hourly. autorestart: false is what makes the
// one-shot safe under pm2: a finished pass stays finished until the next
// cron_restart tick.
module.exports = {
  apps: [
    {
      name: 'cia-monitor',
      // Globally installed CLI; use an absolute path to a checkout's
      // bin/cli.js instead if you run from source.
      script: 'cia',
      args: 'monitor run',
      // The monitoring workspace root — every monitor command is
      // workspace-relative.
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

If `cia` is not on pm2's `PATH` (a common surprise under a system-managed pm2),
set `script` to the absolute path of the installed `bin/cli.js` and
`interpreter: 'node'`.

## Bring it up

```bash
pm2 start ecosystem.config.cjs
pm2 logs cia-monitor --lines 50
cia monitor status   # `last run` confirms passes are landing
```

A **successful pass prints little** — it appends a line to
`.chain-insights/monitor/logs/monitor-runs.jsonl`. Confirm passes are landing
with `cia monitor status` (`last run`), not by watching the pm2 process
state.

## Reading failures

Per-pass exit codes are visible in the pm2 logs and to whatever wraps the
schedule. Where each failure shows up:

| Failure | Where it shows |
| --- | --- |
| Clean pass | Exit `0`; run document appended to `monitor-runs.jsonl`. |
| Isolated case failure (one case errored, run completed) | Exit `2`; `error` field on the case entry in that pass's run document; `cia monitor status`. |
| Run could not start (bad config, missing workspace) | Exit `1`; error line in the pm2 log. Fix before the next tick — nothing ran. |

## Persistence

Two separate steps — doing only the first is the usual mistake:

```bash
pm2 save                       # persist the current process list
sudo pm2 startup               # print the boot-time init line, then run it
```

`pm2 save` records the process list so `pm2 resurrect` can restore it. It does
**not** make pm2 itself start at boot. `pm2 startup` prints a platform-specific
command to install the init service; run the command it prints, then
`pm2 save` again. Without both, the schedule silently stops at the next reboot.

## Choosing pm2, cron, or a harness

| Option | Choose it when | Cost |
| --- | --- | --- |
| `cron` + `monitor run` | The host already runs cron and you have external log/alert plumbing. Per-pass exit codes (`0`/`2`/`1`) are visible to cron. | No status surface; you own log capture and failure visibility. |
| pm2 `cron_restart` + `monitor run` | You already supervise other processes with pm2 and want one log surface. | `autorestart: false` is mandatory; between passes the process reads `stopped`. |
| Agent harness scheduled tasks | An agent already runs on a schedule in this workspace. | The harness owns cadence and logs. |

Do not run two of these against the same workspace. Passes are idempotent, but
overlapping schedules double the work for no additional coverage.
