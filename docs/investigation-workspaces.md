# Investigation Workspaces

An investigation workspace is a normal directory that contains Chain Insights
workspace output, entities, reports, graphs, published outputs, and templates.
Agents and humans should be able to inspect it with any editor.

## Initialize

```bash
mkdir -p ~/work/chain-insights-investigations
cd ~/work/chain-insights-investigations
cia init .
```

Do not run `cia init` inside an initialized workspace unless replacing
scaffolded files with `--force`. Without `--force`, init refuses to overwrite
known files before it creates directories or writes any files.

## Layout

```text
.chain-insights/              Workspace metadata
.chain-insights/schema/       Runtime graph schema captures
.chain-insights/runtime/      Workspace-local runtime state and debug logs
.chain-insights/runtime-skill/ Workspace-specific agent schema notes
artifacts/                    Tool artifacts, session notes, and evidence manifests
entities/                     Entity notes and indexes
imports/                      External investigation inputs
reports/                      Final or interim analyst reports
reports/graphs/               Canonical graph JSON for visualization
reports/tables/               Compact tabular extracts
published/                    Workspace-generated HTML and handoff-ready bundles
sessions/                     Optional session notes
templates/                    Reusable workspace templates
```

No investigation output belongs under `~/.chain-insights`. That directory is for
local Chain Insights config, wallet, and schema cache state.

## Monitor Workspaces

A monitor workspace is not a different kind of workspace. `cia monitor` runs
inside an ordinary initialized workspace and adds directories alongside the
investigation ones:

```text
detections/                             Findings documents from sweeps and case traces
detections/reviewed/                    Reviewer-stamped copies (the hand-off artifact)
cases/<case-id>/case.json               Case definition
cases/<case-id>/snapshots/              One snapshot per pass that traced this case
reports/monitor/                        Exported curated labels (JSON + CSV)
.chain-insights/monitor/config.json     Monitor configuration
.chain-insights/monitor/runs/           One run document per pass
.chain-insights/monitor/alerts/         Alert stream and acknowledgements
.chain-insights/monitor/reviews/        Review decision records
.chain-insights/monitor/watchlist.json  Watched addresses
.chain-insights/detectors/              Per-detector, per-network scan state
```

The same rules apply: run every command from the workspace root, and no monitor
output belongs under `~/.chain-insights`.

Whether to share one workspace or keep two is a question of lifetime, not
capability:

- **One workspace** when monitoring exists to feed investigation — a tracked
  theft whose case movements you then trace by hand. Case snapshots, findings,
  and your `reports/` analysis sit next to each other and reference each other
  by path.
- **A dedicated monitoring workspace** when the watch is long-running and
  general (a scheduled matrix, a treasury watchlist). It accumulates run
  documents and findings indefinitely, on a schedule; an investigation
  workspace is a bounded piece of work you eventually publish and close. Mixing
  them buries a finished investigation under months of run documents.

Do not point two schedules at the same workspace. Passes are idempotent, but
overlapping schedules double the metered graph spend for no extra coverage.

See [Continuous monitoring](monitoring.md) for the command surface.

## Imports

`imports/` is for user-provided or third-party inputs before they become
workspace evidence.

Examples:

- Exchange support exports
- CSV extracts
- Screenshots
- Raw notes
- Partner reports

Imported files are not automatically evidence. When an import supports an analytic
claim, summarize it into workspace evidence artifacts and retain the original path.

## Templates

`templates/` is for reusable workspace-local report, prompt, and evidence
templates. Templates are optional helpers. They are not persisted evidence until
copied into workspace artifacts.

Fresh workspaces include a `workspace-brief.md` starter template.

## Workspace Evidence

The graph and AML tools write durable workspace artifacts under `artifacts/`
and `reports/` during runtime.

Evidence Markdown is a provenance record, not a raw-data dump. Small JSON is
pretty-printed inline with null fields removed. Large JSON is written under
`reports/tables/` and the evidence file stores a summary plus workspace file
pointers.

`chain-insights.evidence_pointer.v1` entries can reference report files,
`reports/graphs/*.graph.json`, `reports/tables/*.compact-evidence.json`, and
Markdown artifacts.

## Published Outputs

For rendered HTML and handoff-ready workspace outputs, inspect `published/`:

```text
published/<workspace-slug>/
```

The workspace files remain the source of truth for any generated handoff
material.

## Reports and Visualization

Generate an ad hoc visualization from JSON:

```bash
cia viz --data ./sample-transactions.json
```

Generate a visualization from workspace graph state:

```bash
cia viz <source-id>
```

Graph-backed tools store canonical graph JSON under `reports/graphs/`.
Self-contained HTML graph reports and Markdown summaries live under `reports/`.
Compact JSON and CSV outputs live under `reports/tables/`.

The local graph report server starts automatically when a graph report URL is
returned. Graph report URLs use `/graph-reports/<filename>.graph.json`.
