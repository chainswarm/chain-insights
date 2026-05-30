# Investigation Workspaces

An investigation workspace is a normal directory and Obsidian-compatible vault
that contains Chain Insights case state, live notes, evidence, reports, graph
payloads, imports, templates, and runtime schema notes. Agents and humans
should be able to inspect it with a normal editor.

## Initialize

```bash
mkdir -p ~/work/chain-insights-investigations
cd ~/work/chain-insights-investigations
cia init .
```

Do not run `cia init` inside an existing workspace unless replacing scaffolded
files with `--force`. Without `--force`, init refuses to overwrite known
workspace files before it creates directories or writes any files.

## Layout

```text
.chain-insights/              Workspace metadata
.chain-insights/schema/       Runtime graph schema captures
.chain-insights/runtime/      Workspace-local runtime state and debug logs
.chain-insights/runtime-skill/ Workspace-specific agent schema notes
.obsidian/                    Obsidian vault settings
Canvases/                     Obsidian Canvas graph review files
Entities/                     Live entity notes and indexes
Evidence/                     Live evidence notes and indexes
cases/                        Case exports and notes
imports/                      External investigation inputs
reports/                      Final or interim analyst reports
reports/graphs/               Canonical graph JSON for visualization
reports/tables/               Compact tabular extracts
published/                    Shareable Obsidian, LLM Wiki, and agent export bundles
templates/                    Reusable case and report templates
```

No investigation output belongs under `~/.chain-insights`. That directory is
for local Chain Insights config, wallet, and schema cache state.

## Imports

`imports/` is for user-provided or third-party inputs before they become case
evidence.

Examples:

- Exchange support exports
- CSV extracts
- Screenshots
- Raw notes
- Partner reports

Imported files are not automatically evidence. When an import supports a claim,
summarize it into the case evidence manifest and reference the original path.

## Templates

`templates/` is for reusable workspace-local case, report, prompt, and evidence
templates. Templates are optional helpers. They are not case state until copied
into a case, evidence file, dossier, or report.

Fresh workspaces include a `case-brief.md` starter template.

## Cases

Open and manage cases:

```bash
cia case open "Exchange deposit clustering" \
  --tags aml,bittensor \
  --description "Trace high-risk source funds into exchange entities"

cia case list
cia case activate <case-id>
cia case suspend <case-id>
cia case close <case-id>
```

Use `cia case show <case-id>` to show saved case context, evidence count,
dossier summaries, and recent session notes.

Refresh live Obsidian vault notes after case evidence, dossiers, or sessions
change:

```bash
cia case vault refresh <case-id>
cia case vault refresh <case-id> --force
```

Open the workspace in Obsidian:

```bash
cia obsidian open .
```

## Evidence

Append evidence:

```bash
cia case evidence add <case-id> \
  --source graph_query_batch \
  --query-params "network=bittensor" \
  --content "$(cat compact-result.json)"
```

Evidence Markdown is a provenance record, not a raw-data dump. Small JSON is
pretty-printed inline with null fields removed. Large JSON is written under
`reports/tables/` and the evidence file stores a summary plus a pointer.

Verify evidence integrity:

```bash
cia case evidence verify <case-id>
```

Graph-backed tools can write `chain-insights.evidence_pointer.v1` entries that
point to report files. The evidence file should keep the claim, source tool,
original query parameters, compact facts, and workspace-local file pointers.

## Knowledge Exports

For normal local review, use the live vault notes:

```bash
cia case vault refresh <case-id> --force
```

Export a verified case bundle only when sharing, handing off to a partner,
ingesting into LLM Wiki, or archiving a checkpoint:

```bash
cia case evidence verify <case-id>
cia case export <case-id> --target obsidian-llmwiki --mode private
```

Open `published/<case-slug>/` as a portable Obsidian vault, or give it to LLM
Wiki, Codex, Claude Code, or ChatGPT as the case context. The case manifest
remains the source of truth for the export.

For install commands, Obsidian opening steps, LLM Wiki ingestion, and agent
prompts, see [Obsidian vault workflow](obsidian-vault.md) and
[Knowledge exports](knowledge-exports.md).

## Dossiers

Maintain an entity dossier:

```bash
cia case dossier update <case-id> 5... \
  --type unknown \
  --finding "Appears in the graph address sample; continue risk screening."
```

Dossiers are durable analyst notes about addresses or entities. Tools do not
auto-populate dossiers unless they explicitly call the dossier workflow.

## Sessions

Start and end investigation sessions:

```bash
cia case session start <case-id>
cia case session end <case-id> \
  --findings "Initial topology query returned exchange deposit candidates." \
  --next-steps "Run focused graph_query_batch probes."
```

Use sessions to record what changed during a work period and what the next
agent should do. Session notes complement evidence; they do not replace it.

## Reports And Visualization

Generate an ad hoc visualization from JSON:

```bash
cia viz --data ./sample-transactions.json
```

Generate a visualization for a case:

```bash
cia viz <case-id>
```

Graph-backed tools store canonical graph JSON under `reports/graphs/`.
Self-contained HTML graph reports and Markdown summaries live under `reports/`.
Compact JSON and CSV outputs live under `reports/tables/`.

The local graph report server starts automatically when a graph report URL is
returned. Graph report URLs use `/graph-reports/<filename>.graph.json`.
