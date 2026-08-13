# Scheduling `cia monitor` with pm2

The recommended standing-watch setup is **pm2 supervising `cia monitor
watch`**. Each tool does the one job it is built for:

- `cia monitor watch` owns the **loop** — it re-runs a monitoring pass on the
  interval configured in `.chain-insights/monitor/config.json`
  (`intervalSeconds`, or `--interval <seconds>`, floor 60s). A failed pass
  does not kill the loop: `watch` logs it and keeps looping.
- pm2 owns **process lifetime** — restart on crash, one log surface, one
  status command, boot persistence. If the loop dies, pm2 restarts it, and
  `watch` resumes cleanly: a killed and restarted watch loses no state and
  re-renders nothing over unchanged cases.

Under this pairing `pm2 list` means what it appears to mean: **`online` =
healthy**, and a climbing restart counter = the loop itself is dying
(something structural — bad config, missing workspace — since failed passes
do not end the loop).

## Example `ecosystem.config.cjs`

Place this in the monitoring workspace root.

```js
// pm2 supervises `cia monitor watch` — a long-running loop that re-runs a
// monitoring pass on the interval configured in
// .chain-insights/monitor/config.json (intervalSeconds).
module.exports = {
  apps: [
    {
      name: 'cia-monitor',
      // Globally installed CLI; use an absolute path to a checkout's
      // bin/cli.js instead if you run from source.
      script: 'cia',
      args: 'monitor watch',
      // The monitoring workspace root — every monitor command is
      // workspace-relative.
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

If `cia` is not on pm2's `PATH` (a common surprise under a system-managed pm2),
set `script` to the absolute path of the installed `bin/cli.js` and
`interpreter: 'node'`.

## Bring it up

```bash
pm2 start ecosystem.config.cjs
pm2 list                        # online = healthy
pm2 logs cia-monitor --lines 50
```

`watch` runs its first pass immediately on start, then sleeps for the
interval. A **successful pass prints nothing** — it appends a line to
`.chain-insights/monitor/logs/monitor-runs.jsonl`. Confirm passes are
landing with `cia monitor status` (`last run`), not by watching the pm2
log.

## Reading failures

Per-pass exit codes are **not visible** under `watch` — the process never
exits between passes. Where each failure shows up:

| Failure | Where it shows |
| --- | --- |
| Isolated case failure (one case errored, run completed) | `error` field on the case entry in that pass's run document; `cia monitor status`. |
| Whole pass failed | `[monitor] run failed: …` line in the pm2 log; loop continues. |
| Loop itself dying | pm2 restart counter climbs; `errored` after `max_restarts`. Read the error log — this is structural, not a flaky case. |

## Persistence

Two separate steps — doing only the first is the usual mistake:

```bash
pm2 save                       # persist the current process list
sudo pm2 startup               # print the boot-time init line, then run it
```

`pm2 save` records the process list so `pm2 resurrect` can restore it. It does
**not** make pm2 itself start at boot. `pm2 startup` prints a platform-specific
command to install the init service; run the command it prints, then
`pm2 save` again. Without both, the watch silently stops at the next reboot.

## Choosing pm2 + watch, cron, or bare watch

| Option | Choose it when | Cost |
| --- | --- | --- |
| **pm2 + `monitor watch`** | You want a supervised standing watch: crash restart, one log surface, one status command, boot persistence. | pm2 installed; one config file. |
| `cron` + `monitor run` | The host already runs cron and you have external log/alert plumbing. Per-pass exit codes (`0`/`2`/`1`) are visible to cron. | No status surface; you own log capture and failure visibility. |
| bare `cia monitor watch` | Interactive session, ad-hoc coverage for a few hours. | Dies with the shell; nothing restarts it. |

Do not run two of these against the same workspace. Passes are idempotent, but
overlapping schedules double the work for no additional coverage.

## Do not pair pm2 with `monitor run`

The tempting hybrid — pm2 launching the one-shot `monitor run` via
`cron_restart` — is the worst of both worlds and one setting away from an
expensive failure. pm2's default treats any process exit as a crash and
relaunches immediately; a one-shot exits on every successful pass, so without
`autorestart: false` the default produces a **hot loop** that re-runs the
pass continuously until someone notices. Between passes the process shows `stopped`, which reads as broken.
If you want pm2, supervise `watch`; if you want one-shots, use cron.
