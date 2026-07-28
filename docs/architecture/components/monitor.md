# monitor

Entrypoint: `src/monitor` · Language: typescript · Tests: `tests/monitor/`

## Purpose

`cia monitor` is the standing-watch surface over the detection machinery.
It re-runs detector sweeps and case traces on a schedule, diffs each result
against the last, and surfaces the difference. Every result stays a plain
file in the workspace. Nothing becomes a label until a human approves it.

Wired as the `monitor` command group in `src/cli.ts`. Files:
`runner`, `tracker`, `cases`, `review`, `alerts`, `export`, `watchlist`,
`watchlist-run`, `probe`, `init`, `store`, `report`, `config`, `paths`,
`jsonl`, `atomic`, `lock`, `closable`, `label-probe` (all `.ts`), plus the
case-render pipeline `render/{index,mermaid,trace-io,verdict,dossier,notes}.ts`.

## Profiles

Two profiles (`resolvedProfile` / `resolvedTraceMode` in
`src/monitor/config.ts` resolve both so every existing config literal stays
type-valid):

- `profile: 'operator'` (default) — runs the detector × network matrix on
  `intervalSeconds`.
- `profile: 'victim'` (victim lane) — runs zero detector cells and traces
  its one case only when new activity is observed. `trace_mode` defaults to
  `on_movement` for this profile, `interval` otherwise.

`cia monitor init victim --case-id --network --seed ...`
(`src/monitor/init.ts`) bootstraps a fresh workspace in one command: case
first, managed watchlist second, `config.json` last as the commit point. A
crash mid-init never leaves a configured monitor missing its case.

## Reads

- `config.json` monitor config (profiles, intervals, detector matrix,
  `render.dormant_after_days` — default 30).
- Case files, watchlist.json, snapshot files (`*.snapshot.json`).
- Append-only logs: `logs/probe-cursors.jsonl`, `logs/watchlist-hits.jsonl`.
- Chain Insights Graph via `graph_query` / `graph_query_batch` only.

## Writes

- Findings documents under `detections/`, snapshots, run documents.
- Rendered case output under `published/cases/<case_id>/`: `dossier.md`,
  bounded mermaid flow, per-address notes, timeline.
- Render state in `.chain-insights/monitor/render-state.json`.
- Reviewer-stamped decision copies under `detections/reviewed/`.
- Curated-label export (`chain-insights.curated-labels.v1` schema) via
  `cia monitor export labels`.

## Flow

1. **Trace gating** (`runMonitorOnce` in `src/monitor/runner.ts`): in
   `on_movement` mode an open case is traced only if it has no prior
   snapshot, has `dirty_since_timestamp` set, or `--force-trace` was passed.
   Otherwise the cell records `trace_skipped_reason: 'no_activity'` so a
   quiet monitor still reads as healthy.
2. **Activity probe** (`src/monitor/probe.ts`): one `graph_query_batch` per
   distinct watched network for `last_activity_timestamp > $cursor` over
   every watched address. Per-shard rows merge client-side by MAX. A hit's
   `source_ref` is `"<address>|<last_activity_timestamp>"`. Per-network
   cursors persist in `logs/probe-cursors.jsonl` (last line wins) as a pure
   cost optimization — dedup against `watchlist_hits` is what prevents
   re-alerts, so a stale cursor can never fire a duplicate alert. A probe
   hit on a case-managed entry calls `markCaseDirty`
   (`src/monitor/cases.ts`), the gate that lets `on_movement` mode trace
   that case in the same pass.
3. **Cluster auto-watchlist** (`syncManagedWatchlist` in
   `src/monitor/watchlist.ts`, called from `src/monitor/tracker.ts` after
   every successful trace): refreshes each case's
   `managed_by: "case:<id>"` entries to the current corridor (seeds plus
   candidate intermediates/deposit endpoints), excluding
   `exchange_terminal` addresses (always active — watching them would turn
   the tripwire into a constant alarm). Manual entries and other cases'
   entries are never touched.
4. **Case render** (`renderCase` in `src/monitor/render/index.ts`, the
   runner's optional hook after the trace pass): on a changed case (sha256
   over the latest snapshot, `case.json`, and the case's alert count —
   `caseRenderKey`) it re-traces both roles over the case seeds and writes
   `published/cases/<case_id>/dossier.md` (ACTIVE/DORMANT headline from
   `verdict.ts`, computed from newest-edge epoch-millisecond timestamps
   against `render.dormant_after_days`), a bounded mermaid flow, notes, and
   a timeline. An unchanged case is skipped with
   `skipped_reason: 'unchanged'`.

## Invariants

- **One-shot core.** `cia monitor run` is one pass, then exit. Deliberate:
  one-shot idempotent core, never a stateful service. The recommended
  standing-watch pairing is pm2 supervising `cia monitor watch`
  (`autorestart: true`; `watch` owns the loop, pm2 owns process lifetime).
  Pairing pm2 with one-shot `monitor run` via `cron_restart` is an
  anti-pattern: one missing `autorestart: false` and pm2 treats every clean
  exit as a crash and hot-loops the full detector matrix against metered
  graph allowance. Plain `cron` + `monitor run` remains fine.
- **Exit codes** (`monitor run` / cron only): `0` clean; `2` isolated cell
  failure (pass completed, at least one cell errored —
  `MONITOR_EXIT_ISOLATED`); `1` the run could not start. Under
  `monitor watch` the process never exits between passes; an isolated cell
  failure lands on the cell entry in the pass's run document and in
  `cia monitor status` — check there, not the supervisor's process state.
- **Config fallback.** The default matrix (four detectors ×
  `bittensor`/`bittensor_evm`) applies only when the config file is missing.
  An unreadable or invalid config throws — it must never silently fall back.
- **Window modes.** `address-poisoning` is `incremental` (advances a scan
  checkpoint). `fake-token`, `mixer`, `attack-attribution` are `full-state`
  (no checkpoint; an emitted-findings key set under
  `.chain-insights/detectors/<detector>.<network>.emitted.json`,
  `src/detection/emitted-state.ts`). An unchanged run legitimately emits
  zero findings — the anti-backlog design, not a broken sweep. `--full`
  (on `cia detect`, never on `monitor run`) resets emitted state.
- **Review is the only path to a label.** Approve writes a reviewer-stamped
  copy under `detections/reviewed/`; the original findings document is
  never modified. `cia monitor export labels` (`src/monitor/export.ts`)
  emits the frozen `chain-insights.curated-labels.v1` schema
  (`CURATED_LABELS_SCHEMA`) from effective approve decisions only, one row
  per (address, label). Case-doc roles map `seed`→`scam_seed`,
  `candidate_intermediate`→`mule`, `candidate_deposit`→`deposit_endpoint`
  (`ROLE_LABELS`, keyed off `CASE_CLUSTER_ROLES`); lane-A detector docs
  keep their own classification with an empty `case_id`. `decision_id` is
  the content-addressed decision filename stem, so downstream importers can
  dedup full-snapshot re-exports.
- **Closable cases** (`caseClosableStatus` in `src/monitor/closable.ts`):
  a case becomes closable once it has at least one effective approve
  decision (`labeled`) AND its managed watchlist entries recorded no
  activity-probe hit within `render.dormant_after_days` (`dormant`). Both
  conditions compute from canonical files only, so the status is correct
  even against a freshly rebuilt store. Closing stays a human action —
  `closeCase` deliberately keeps the case's managed watchlist entries as
  the post-close dormancy tripwire. A later hit on a managed entry of a
  closed case fires a `case_reactivated` alert (`reactivationAlerts` in
  `src/monitor/watchlist-run.ts`, deduped via the watchlist-hits log).
  There is no auto-reopen.
- **Empty documents.** Empty findings documents are written and replayed by
  `monitor rebuild` as provenance, but are not queued as pending review
  work.

## Run

```bash
cia monitor run        # one pass over the detector matrix and open cases
cia monitor watch      # loop run on intervalSeconds without an external scheduler
cia monitor status     # cells, cases, pending reviews, unacked alerts, last run
```

## Verify

```bash
npm test -- tests/monitor
```
