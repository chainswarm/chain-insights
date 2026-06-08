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

The graph and exposure tools write durable workspace artifacts under `artifacts/`
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
