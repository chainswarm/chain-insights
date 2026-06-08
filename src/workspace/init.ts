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

const DEFAULT_DOMAIN_HINTS = ['aml', 'exposure']

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function workspaceJson(workspaceRoot: string): string {
  return JSON.stringify({
    schema: 'chain-insights.workspace.v1',
    name: 'Chain Insights Workspace',
    workspace_root: workspaceRoot,
    default_network: 'bittensor',
    graph_mcp_endpoint: LOCAL_GRAPH_MCP_ENDPOINT,
    artifacts_dir: 'artifacts',
    imports_dir: 'imports',
    reports_dir: 'reports',
    templates_dir: 'templates',
    domain_hints: DEFAULT_DOMAIN_HINTS,
    created_at: todayIso(),
  }, null, 2) + '\n'
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
  preferences (for example \`["aml", "exposure"]\`) and should guide, not constrain,
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

Use \`graph_query_batch\` for schema capture. Prefix current topology reads
with \`USE live_topology\`, historical topology reads with
\`USE archive_topology\`, and fact reads with \`USE facts\`, for example:

\`\`\`bash
cia mcp call graph_query_batch network=<network> 'queries=[{"id":"node_labels","query":"USE live_topology MATCH (n:Address) RETURN \"Address\" AS node_label, count(n) AS sample_count LIMIT 1"},{"id":"archive_flow_sample","query":"USE archive_topology MATCH (:Address)-[f:FLOWS_TO]->(:Address) RETURN f.period_granularity AS granularity, f.amount_sum AS amount_sum LIMIT 20"}]'
\`\`\`

Then update this file with observed labels, relationship types, and allowed
property names for the active network.

Rules:

- Prefer \`graph_query\` and \`graph_query_batch\` for graph-language reads.
- Use \`USE live_topology\` for recent topology, \`USE archive_topology\`
  for historical topology, and \`USE facts\` for labels, features,
  risk scores, assets, and enrichment. Address facts can be reached through
  relationships such as \`(:Address)-[:HAS_FEATURE]->(:AddressFeature)\`.
  Archived money-flow topology is exposed as
  \`(:Address)-[:FLOWS_TO]->(:Address)\` with \`period_granularity\`,
  \`period_start_date\`, and \`period_end_date\` on the relationship.
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

Trace tool chaining:

1. Use \`aml_trace_victim_funds\` when the user gives victim/source addresses.
2. Pass returned \`continuation.candidate_deposit_addresses\` to
   \`aml_trace_deposit_sources\`; do not make victim tracing run deposit traceback
   internally.
3. Pass high-confidence \`continuation.candidate_suspect_addresses\` from
   deposit traceback to \`aml_trace_suspect_funds\`.
4. Use \`aml_trace_suspect_funds\` when the user gives suspected scammer, mule,
   operator, or laundering-ring addresses. \`incident_timestamp_ms\` is
   optional.
5. Use \`aml_address_risk\` for single-address enrichment, and
   \`graph_query_batch\` only when the role-specific tools do not answer the
   exact question.

All trace tools return \`chain-insights.trace.v1\`. Preserve full addresses in
\`input.addresses\`, \`addresses[].address\`, \`edges[].from_address\`,
\`edges[].to_address\`, \`paths[].addresses\`, \`candidate_labels[].address\`,
and \`continuation\` address lists.
`

const SCHEMA_README = `# Runtime Schema Captures

Store graph schema captures here, for example:

\`\`\`text
bittensor.graph-schema.json
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
      throw new Error(`Refusing to overwrite ${filePath}. Re-run with --force to replace workspace files.`)
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
        throw new Error(`Refusing to overwrite ${filePath}. Re-run with --force to replace workspace files.`)
      }
      throw err
    }
  }

  return { workspaceRoot, filesWritten }
}
