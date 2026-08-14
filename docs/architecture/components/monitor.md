# monitor

Entrypoint: `src/monitor` · Language: typescript · Tests: `tests/monitor/`

## Purpose

`cia monitor` is the standing-view surface over investigation cases. It
re-renders each open case's dossier, one cron-safe pass at a time. The case
document (`cases/<id>/case.json`) is canonical; the dossier, per-address
notes, and timeline are derived output. Everything stays a plain file in the
workspace.

Wired as the `monitor` command group in `src/cli.ts` (run, render,
status, init, case). Files: `runner`, `cases`, `config`, `init`,
`report`, `paths`, `atomic`, `lock` (all `.ts`), plus the
case-render pipeline `render/{index,mermaid,verdict,dossier,notes}.ts`.

## Profiles

`cia monitor init victim --case-id --network --seed ...`
(`src/monitor/init.ts`) bootstraps a case-tracking workspace in one command:
case first, `config.json` last as the commit point. A crash mid-init never
leaves a configured monitor missing its case. The `victim` profile is the
only supported init profile; operators edit `config.json` directly for
anything else.

## Reads

- `config.json` monitor config (`render.dormant_after_days` — default 30).
- Case files under `cases/<case-id>/case.json` (open cases only).
- Append-only run log `logs/monitor-runs.jsonl` (last line wins on read).

## Writes

- Rendered case output under `published/cases/<case_id>/`: `dossier.md`,
  bounded mermaid flow, per-address notes, timeline.
- Render state in `.chain-insights/monitor/render-state.json` (per-case
  sha256 content keys).
- One JSON line per pass appended to
  `.chain-insights/monitor/logs/monitor-runs.jsonl`.
- Run lock at the workspace root (`.cia-monitor.lock`).

## Flow

1. **Run lock** (`acquireRunLock` in `src/monitor/lock.ts`): a second pass
   while one is active exits immediately — `[monitor] already running`.
2. **One pass per open case** (`runMonitorOnce` in `src/monitor/runner.ts`):
   list open cases, then render each dossier from its case document
   (`renderCaseFromDoc` in `src/monitor/render/index.ts`). No MCP client,
   no graph reads, no re-trace — freshness is a case-doc content key.
3. **Content-keyed render**: a case whose `case.json` digest is unchanged
   since the last render is skipped with `skipped_reason: 'unchanged'`
   (or `'closed'` for a closed case). `--force` bypasses the key.
4. **Commit point**: the CLI appends the run document to
   `logs/monitor-runs.jsonl` (in `src/cli.ts`) only after every case
   outcome is recorded, so a killed pass reads as last-pass-with-errors,
   never as a newer clean pass.

## Invariants

- **One-shot core.** `cia monitor run` is one pass, then exit. Deliberate:
  one-shot idempotent core, never a stateful service. There is no built-in
  loop — an external scheduler owns the interval (cron, pm2
  `cron_restart` with `autorestart: false`, or an agent harness's scheduled
  tasks). Under pm2, `autorestart: false` is mandatory: the default treats
  every clean exit as a crash and hot-loops passes.
- **Exit codes**: `0` clean; `2` isolated case
  failure (pass completed, at least one case errored —
  `MONITOR_EXIT_ISOLATED`); `1` the run could not start.
- **Config fallback.** The default config applies
  only when the config file is missing. An unreadable or invalid config
  throws — it must never silently fall back.
- **Case-ID safety.** Every case ID is validated against
  `^[a-z0-9][a-z0-9-]{1,63}$` before any path join
  (`assertCaseId` in `src/monitor/cases.ts`) — `case.json` paths can never
  be reached through a traversal id.
- **Seed-grain persistence.** Seeds, `seeds_added_at_timestamp`, and
  `seed_events` are recorded on `case.json`; `add-seed` / `remove-seed` are
  idempotent, refuse on a closed case, and never leave a case with zero
  seeds.
- **Closed cases are historical records.** The runner walks only open
  cases. Closing is human-only; there is no reopen path.
- **Dormancy verdict.** DORMANT/ACTIVE is computed from the case document
  record (`verdict.ts`) against `render.dormant_after_days`; it is a
  state-color, not an event.

## Run

```bash
cia monitor run            # one pass over open cases
cia monitor status         # open cases and the last run
cia monitor render         # render one or all open cases from case documents
```

## Verify

```bash
npm test -- tests/monitor
```