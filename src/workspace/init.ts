import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { LOCAL_GRAPH_MCP_ENDPOINT } from '../config/mcp-endpoint.js'

export interface InitWorkspaceOptions {
  targetDir: string
  force?: boolean
}

export interface InitWorkspaceResult {
  workspaceRoot: string
  filesWritten: string[]
}

const WORKSPACE_DIRS = [
  '.chain-insights',
  '.chain-insights/schema',
  '.chain-insights/runtime',
  '.chain-insights/runtime/logs',
  '.chain-insights/runtime-skill',
  'artifacts',
  'entities',
  'imports',
  'reports',
  'reports/graphs',
  'reports/tables',
  'sessions',
  'templates',
  'published',
]

const DEFAULT_DOMAIN_HINTS = ['aml']

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function workspaceJson(workspaceRoot: string): string {
  return (
    JSON.stringify(
      {
        schema: 'chain-insights.workspace.v1',
        name: 'Chain Insights Workspace',
        workspace_root: workspaceRoot,
        default_network: 'robinhood',
        graph_mcp_endpoint: LOCAL_GRAPH_MCP_ENDPOINT,
        artifacts_dir: 'artifacts',
        imports_dir: 'imports',
        reports_dir: 'reports',
        templates_dir: 'templates',
        domain_hints: DEFAULT_DOMAIN_HINTS,
        created_at: todayIso(),
      },
      null,
      2
    ) + '\n'
  )
}

const README = `# Chain Insights Workspace

This is a generic Chain Insights workspace.
Use any editor or agent tooling you want to review reports, artifacts, entity
notes, graphs, and published bundles alongside the Chain Insights runtime
metadata.

## Start

\`\`\`bash
chain-insights mcp tools --refresh
chain-insights wallet ready --check-only
\`\`\`

## Layout

\`\`\`text
.chain-insights/   Workspace metadata
artifacts/         Tool-generated artifacts and durable workspace records
entities/          Entity notes and indexes
imports/           External reports, CSVs, screenshots, raw notes
reports/           Final or interim analyst reports
reports/graphs/    Graph JSON for visualization
reports/tables/    Compact tabular extracts
sessions/          Optional session notes
templates/         Reusable workspace templates
published/         Published bundles and handoff-ready exports
.chain-insights/schema/         Runtime graph schema captures
.chain-insights/runtime/        Workspace-local runtime process state and debug logs
.chain-insights/runtime-skill/  Workspace-specific agent schema notes
\`\`\`
`

const AGENTS = `# Agent Instructions

You are operating inside a Chain Insights workspace.

- Read README.md first.
- If this directory is not initialized, run \`cia init .\` before persistence-producing commands.
- Do not rerun init in an existing workspace unless replacing scaffolding with \`--force\`.
- Read .chain-insights/runtime-skill/SKILL.md before graph queries.
- Preserve full blockchain addresses exactly.
- Do not guess the network for graph queries.
- Capture or refresh graph schema before the first graph workflow.
- \`domain_hints\` in \`.chain-insights/workspace.json\` are optional advisory workflow
  preferences (for example \`["aml"]\`) and should guide, not constrain,
  tool selection.
- Save compact artifacts with original graph field names.
- Put canonical graph JSON in reports/graphs/ and analyst tables in reports/tables/.
- Markdown reports should summarize and point to graph/table outputs; do not paste large raw JSON blobs into reports.
- Workspace output must stay in this initialized workspace.
- Never write artifacts, reports, graph JSON, HTML, schema captures, or logs to ~/.chain-insights.
- Keep theories lightweight until evidence supports them.
`

const CLAUDE = AGENTS

const CASE_BRIEF = `# Workspace Brief

## Summary

Status:
Network:
Current Assessment:

## Known Addresses

## Claims To Validate

## Evidence

## Next Steps
`

const IMPORTS_README = `# External Investigation Inputs

Put user-provided or third-party material here before turning it into durable
workspace outputs.

Examples:

- Exchange support exports
- CSV extracts
- Screenshots
- Raw notes
- Partner reports

Files in this directory are inputs, not verified evidence. When an import
supports a claim, summarize it into a workspace report or artifact note and
reference the original file path.
`

const TEMPLATES_README = `# Reusable Workspace Templates

Store local report, prompt, artifact, and note templates here.

Templates are optional workspace helpers. They are not evidence and should not
be treated as durable workspace state until copied into an artifact, report,
entity note, or session note.
`

const RUNTIME_SKILL = `---
name: chain-insights-runtime-schema
description: Workspace-local Chain Insights runtime schema notes. Refresh this after connecting to a graph MCP endpoint.
---

# Runtime Graph Schema

Before the first investigation query, capture the live graph schema into:

\`\`\`text
.chain-insights/schema/<network>.graph-schema.json
\`\`\`

Use \`graph_query_batch\` for schema capture. Prefix topology reads with
\`USE topology\` (address/FLOWS_TO/LINKED graph, unified recent+historical)
and fact reads with \`USE facts\`, for example:

\`\`\`bash
cia mcp call graph_query_batch network=<network> 'queries=[{"id":"node_labels","query":"USE topology MATCH (n:Address) RETURN \"Address\" AS node_label, count(n) AS sample_count LIMIT 1"},{"id":"flow_sample","query":"USE topology MATCH (:Address)-[f:FLOWS_TO]->(:Address) RETURN f.amount_usd_sum AS amount_usd_sum, f.tx_count AS tx_count LIMIT 20"},{"id":"linked_sample","query":"USE topology MATCH (a:Address)-[l:LINKED]-(b:Address) RETURN a.address AS address, b.address AS linked_address, l.basis AS basis, l.confidence AS confidence LIMIT 20"}]'
\`\`\`

Then update this file with observed labels, relationship types, and allowed
property names for the active network.

The address-grain graph schema:

- Call \`meta_network_capabilities\` first. Pass \`network=\` exactly as
  GraphRAG advertised it. CIA does not pick a default network.
  Address format follows that network. Every topology node is
  \`(:Address {address, network})\`, keyed by the raw chain-native
  \`address\`. There is no separate identity key and no member-address
  satellite: the address IS the graph node.
- \`(:Address)-[:LINKED]-(:Address)\` is an **undirected** ownership-overlay
  edge (\`basis\` \`derived\`/\`associated\`, plus \`confidence\`,
  \`source_event\`, \`declared_owner\`) asserting the two addresses are
  controlled by the same actor. \`LINKED\` is the ownership edge within the
  advertised network — a same-network query traces
  (\`LINKED\` or \`FLOWS_TO\`) with no network switch. Walk
  one visible \`LINKED\` hop to surface actor-level exposure; never treat
  linked addresses
  as a single collapsed node. \`LINKED\` is served on the topology graph
  only.
- Other Address properties: \`labels\` (array) and \`is_exchange\`
  (sparse true/null traversal hint). Labels and per-label risk live on the
  address node: \`label_risk\` is a list of \`{label, risk_level,
  updated_timestamp}\` maps, one per current label row.
- Address nodes carry a risk verdict for quick triage
  (\`risk_score\` float, \`risk_level\` string) plus base activity rollups:
  \`degree_in\`/\`degree_out\`/\`degree_total\` (distinct counterparty
  addresses), \`tx_in_count\`/\`tx_out_count\`/\`tx_total_count\`,
  \`total_in_usd\`/\`total_out_usd\`/\`total_volume_usd\`, \`net_flow_usd\`
  (in minus out; positive = net receiver) — all computed from external
  flows only — and \`first_activity_timestamp\`/
  \`last_activity_timestamp\`/\`activity_span_days\`, which include all
  flows (self-loops included). FLOWS_TO edges carry \`tx_count\`,
  \`amount_usd_sum\`, \`avg_tx_size_usd\` (understates when
  \`price_coverage_ratio\` < 1), \`first_seen_timestamp\`/
  \`last_seen_timestamp\`, \`first_tx_id\`/\`last_tx_id\`, and
  \`price_coverage_ratio\`.
  Lifetime aggregates are the only serving window.
- Money flow is \`(:Address)-[:FLOWS_TO]->(:Address)\`. Public AML tools
  accept the raw blockchain address directly — there is no resolution step.
- The risk verdict lives on topology nodes (\`risk_score\`/\`risk_level\`),
  and labels and per-label risk live on the address node (\`labels\` array
  + \`label_risk\` entries). \`USE facts\` serves bounded individual
  transfer rows and, until P3, address features. Facts address keys match
  topology \`address\` values exactly. Do not read \`ml_*\`,
  \`confluence_score\`, or \`pattern_flags\` off topology nodes — those
  properties do not exist.
- \`(from:Address)-[t:TRANSFER]->(to:Address)\` on \`USE facts\` returns
  individual transfer rows (not aggregates) from \`facts_transfers_view\`,
  with edge properties \`amount\`, \`amount_usd\`, \`asset_symbol\`,
  \`asset_contract\`, \`tx_id\`, \`block_height\`, \`block_timestamp\`,
  \`event_index\`, \`edge_index\`, \`price_usd\`, and \`price_missing\`.
  Every TRANSFER query (row-select or a \`count()\`/\`sum()\` aggregate)
  requires an indexed predicate — address equality on either endpoint or
  \`WHERE t.tx_id = "..."\` — a bare \`LIMIT\` alone is rejected. Lifetime
  address metrics (degrees, totals, activity window) are node properties on
  \`USE topology\`.

Rules:

- Prefer \`graph_query\` and \`graph_query_batch\` for graph-language reads.
- The graph choice stays inside the query via \`USE ...\`; there is no
  tool argument to select a graph.
- Use \`USE topology\` for topology (the address/FLOWS_TO/LINKED graph,
  covering unified recent and full historical activity in one graph, plus
  the node \`risk_score\`/\`risk_level\` verdict, and labels + per-label
  risk) and \`USE facts\` for features, assets, and enrichment.
  The \`LINKED\` ownership overlay is served on the topology graph only.
- Preserve source schema field names in generated data files.
- Do not rename, reinterpret, or add unit labels to graph fields unless the
  schema or query result explicitly supports that interpretation.
- Keep persisted outputs compact: select only the fields needed to support the claim.
  Avoid storing whole node or relationship property blobs unless
  the purpose of the query is schema discovery or debugging.
- When using BFS, fixed-depth traversal fallbacks, or any manual \`FLOWS_TO\`
  traversal, treat exchange hot wallets as terminal endpoints only. Do not
  expand from, through, or classify exchange nodes as deposit, suspect, or
  intermediate candidates. In Cypher, require every non-terminal traversal node
  to satisfy \`is_exchange IS NULL\`; only the final exchange endpoint should
  satisfy \`is_exchange IS NOT NULL\`.
- Keep analysis products separate from summary notes: graph JSON belongs under
  \`reports/graphs/\`, tabular extracts under \`reports/tables/\`, and analyst
  narrative under \`reports/\`.
- Markdown reports should be short provenance records with key facts and
  pointers. Large JSON belongs in \`reports/tables/\`, not inline in reports.

AML tool guidance:

1. Use \`aml_address_risk\` for single-address enrichment and optional
   comparison with another address.
2. Use \`graph_query_batch\` only when the high-level tools do not answer the
   exact question, and \`graph_query\` for single read-only queries.

\`aml_address_risk\` takes a raw blockchain address as input directly — there
is no identity-resolution step — and returns \`chain-insights.result.v1\`. Preserve
full blockchain addresses in the summary and all workspace artifacts.
`

const SCHEMA_README = `# Runtime Schema Captures

Store graph schema captures here, for example:

\`\`\`text
robinhood.graph-schema.json
\`\`\`

Schema captures should be generated before the first graph workflow in a fresh
workspace, then referenced by artifacts, reports, and runtime skill notes.
`

function workspaceFiles(workspaceRoot: string): Array<[string, string]> {
  return [
    ['.chain-insights/workspace.json', workspaceJson(workspaceRoot)],
    ['README.md', README],
    ['AGENTS.md', AGENTS],
    ['CLAUDE.md', CLAUDE],
    ['imports/README.md', IMPORTS_README],
    ['templates/README.md', TEMPLATES_README],
    ['templates/workspace-brief.md', CASE_BRIEF],
    ['.chain-insights/runtime-skill/SKILL.md', RUNTIME_SKILL],
    ['.chain-insights/schema/README.md', SCHEMA_README],
    ['.chain-insights/runtime/.keep', ''],
    ['.chain-insights/runtime/logs/.keep', ''],
  ]
}

async function assertNoFileCollisions(workspaceRoot: string): Promise<void> {
  for (const [relativePath] of workspaceFiles(workspaceRoot)) {
    const filePath = path.join(workspaceRoot, relativePath)
    try {
      await access(filePath)
      throw new Error(
        `Refusing to overwrite ${filePath}. Re-run with --force to replace workspace files.`
      )
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        continue
      }
      throw err
    }
  }
}

export async function initWorkspace(options: InitWorkspaceOptions): Promise<InitWorkspaceResult> {
  const workspaceRoot = path.resolve(options.targetDir)
  if (!options.force) {
    await assertNoFileCollisions(workspaceRoot)
  }

  for (const dir of WORKSPACE_DIRS) {
    await mkdir(path.join(workspaceRoot, dir), { recursive: true })
  }

  const filesWritten: string[] = []
  const flag = options.force ? 'w' : 'wx'
  for (const [relativePath, content] of workspaceFiles(workspaceRoot)) {
    const filePath = path.join(workspaceRoot, relativePath)
    try {
      await writeFile(filePath, content, { mode: 0o600, flag })
      filesWritten.push(relativePath)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(
          `Refusing to overwrite ${filePath}. Re-run with --force to replace workspace files.`
        )
      }
      throw err
    }
  }

  return { workspaceRoot, filesWritten }
}
