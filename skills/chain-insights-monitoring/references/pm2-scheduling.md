# Scheduling `cia monitor` with pm2

`cia monitor run` performs **one pass and exits**. That is deliberate: the
monitor core is one-shot and idempotent, never a stateful service, so any
scheduler can drive it and a killed process cannot leave half-written state.

It also means pm2 is not being used the way pm2 is usually used. pm2 is not
keeping a server alive here — **pm2 supplies only the schedule**.

## The one flag that matters

```js
autorestart: false,
cron_restart: '0 * * * *',
```

`autorestart: false` is not optional. pm2's default is to treat *any* process
exit as a crash and relaunch immediately. A one-shot exits on every successful
pass, so with the default pm2 relaunches it instantly, forever — a hot loop
that runs the full detector matrix continuously and burns metered graph
allowance until someone notices. With `autorestart: false`, pm2 launches the
process only when `cron_restart` fires, and a clean exit is just a finished
pass.

## Exit codes under pm2

| Exit | `pm2 list` shows | Meaning |
| --- | --- | --- |
| `0` | `stopped` | Clean pass. |
| `2` | `errored` | **Isolated cell failure** — the pass completed, at least one cell did not. |
| `1` | `errored` | The run could not start at all. |

`errored` in `pm2 list` after an exit-2 pass is the **intended
alerting-of-last-resort**, not a broken deploy. It is how a partial pass becomes
visible without a webhook. Distinguish `1` from `2` by reading the log: exit `2`
prints `[monitor] <cell> FAILED: …` lines and the pass summary; exit `1` prints
a single startup error and no summary.

Do not "fix" a persistently `errored` process by removing `autorestart: false`.
That trades one visible failing cell for an invisible hot loop.

## Example `ecosystem.config.cjs`

Place this in the monitoring workspace and use paths appropriate to your host.

```js
// pm2 process definition for a scheduled `cia monitor` pass.
//
// `cia monitor run` is a ONE-SHOT: one pass, then exit. pm2 supplies only the
// schedule:
//   autorestart: false  -> a clean exit is a finished pass, not a crash
//   cron_restart        -> launch one pass at the top of every hour
//
// Exit codes: 0 = clean, 2 = isolated cell failure (pass completed, a cell did
// not), 1 = the run could not start. pm2 surfaces non-zero exits in
// `pm2 list` / `pm2 logs` — the intended alerting-of-last-resort.
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
pm2 list                       # cia-monitor, stopped between passes
pm2 logs cia-monitor --lines 50
```

`pm2 start` launches the pass once immediately, then hands scheduling to
`cron_restart`. Confirm that first pass in the logs before walking away.

Force a pass outside the schedule:

```bash
pm2 restart cia-monitor
```

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

## Choosing pm2, cron, or `watch`

| Option | Choose it when | Cost |
| --- | --- | --- |
| `cia monitor watch` | Interactive session, ad-hoc coverage for a few hours. | Dies with the shell; no per-pass exit-code visibility; a hard failure ends the loop. |
| `cron` | The host already runs cron and you have external log/alert plumbing. | No status surface; you own log capture and failure visibility. |
| **pm2** | You want per-pass logs, a `pm2 list` status surface, boot persistence, and non-zero exits made visible with no extra plumbing. | One config file, and `autorestart: false` is mandatory. |

Do not run two of these against the same workspace. Passes are idempotent, but
overlapping schedules double the metered graph spend for no additional
coverage.
