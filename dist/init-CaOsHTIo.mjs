import path from "node:path";
import { access, mkdir, writeFile } from "node:fs/promises";
//#region src/workspace/init.ts
const WORKSPACE_DIRS = [
	".chain-insights",
	".chain-insights/schema",
	".chain-insights/runtime",
	".chain-insights/runtime/logs",
	".chain-insights/runtime-skill",
	"cases",
	"imports",
	"reports",
	"reports/graphs",
	"reports/tables",
	"templates"
];
function todayIso() {
	return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function workspaceJson(workspaceRoot) {
	return JSON.stringify({
		schema: "chain-insights.workspace.v1",
		name: "Chain Insights Investigations",
		workspace_root: workspaceRoot,
		default_network: "bittensor",
		graph_mcp_endpoint: "https://staging-mcp.chain-insights.ai/mcp",
		cases_dir: "cases",
		imports_dir: "imports",
		reports_dir: "reports",
		templates_dir: "templates",
		created_at: todayIso()
	}, null, 2) + "\n";
}
const README = `# Chain Insights Investigations

This is a workspace for Chain Insights AML investigations.

## Start

\`\`\`bash
chain-insights mcp tools --refresh
chain-insights wallet balance
\`\`\`

## Layout

\`\`\`text
.chain-insights/   Workspace metadata
cases/             Case exports and notes
imports/           External reports, CSVs, screenshots, raw notes
reports/           Final or interim analyst reports
reports/graphs/    Graph JSON for visualization
reports/tables/    Compact tabular extracts
templates/         Reusable case/report templates
.chain-insights/schema/         Runtime graph schema captures
.chain-insights/runtime/        Workspace-local runtime process state and debug logs
.chain-insights/runtime-skill/  Workspace-specific agent schema notes
\`\`\`
`;
const AGENTS = `# Agent Instructions

You are operating inside a Chain Insights investigation workspace.

- Read README.md first.
- If this directory is not initialized, run \`cia init .\` before investigation-producing commands.
- Do not rerun init in an existing workspace unless replacing scaffolding with \`--force\`.
- Read .chain-insights/runtime-skill/SKILL.md before graph queries.
- Preserve full blockchain addresses exactly.
- Do not guess the network for graph queries.
- Capture or refresh graph schema before the first case query.
- Save compact evidence with original graph field names.
- Put canonical graph JSON in reports/graphs/ and analyst tables in reports/tables/.
- Evidence files should summarize and point to graph/table outputs; do not paste large raw JSON blobs into evidence Markdown.
- Investigation output must stay in this initialized workspace.
- Never write cases, evidence, reports, graph JSON, HTML, schema captures, or logs to ~/.chain-insights.
- Keep theories lightweight until evidence supports them.
`;
const CLAUDE = AGENTS;
const CASE_BRIEF = `# Case Brief

## Summary

Status:
Network:
Current Assessment:

## Known Addresses

## Claims To Validate

## Evidence

## Next Steps
`;
const IMPORTS_README = `# External Investigation Inputs

Put user-provided or third-party investigation material here before turning it
into case evidence.

Examples:

- Exchange support exports
- CSV extracts
- Screenshots
- Raw notes
- Partner reports

Files in this directory are inputs, not verified evidence. When an import
supports a claim, summarize it into the case evidence manifest and reference
the original file path.
`;
const TEMPLATES_README = `# Reusable Workspace Templates

Store local report, case, prompt, and evidence templates here.

Templates are optional workspace helpers. They are not evidence and should not
be treated as case state until copied into a case, evidence file, dossier, or
report.
`;
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
- Use \`USE live_topology\` for Memgraph RAM topology, \`USE archive_topology\`
  for StarRocks historical topology, and \`USE facts\` for StarRocks fact
  labels such as \`AddressLabel\`, \`AddressFeature\`,
  \`RiskScore\`, and \`Asset\`. Address facts can be reached through
  relationships such as \`(:Address)-[:HAS_FEATURE]->(:AddressFeature)\`.
  Archived money-flow topology is exposed as
  \`(:Address)-[:FLOWS_TO]->(:Address)\` with \`period_granularity\`,
  \`period_start_date\`, and \`period_end_date\` on the relationship.
- Preserve source schema field names in evidence and generated data files.
- Do not rename, reinterpret, or add unit labels to graph fields unless the
  schema or query result explicitly supports that interpretation.
- Keep evidence compact: select only the fields needed to support the claim.
  Avoid storing whole node or relationship property blobs in evidence unless
  the purpose of the query is schema discovery or debugging.
- Keep analysis products separate from evidence: graph JSON belongs under
  \`reports/graphs/\`, tabular extracts under \`reports/tables/\`, and analyst
  narrative under \`reports/\`.
- Evidence Markdown should be a short provenance record with key facts and
  pointers. Large JSON belongs in \`reports/tables/\`, not inline in evidence.
`;
const SCHEMA_README = `# Runtime Schema Captures

Store graph schema captures here, for example:

\`\`\`text
bittensor.graph-schema.json
\`\`\`

Schema captures should be generated before the first case query in a fresh
workspace, then referenced by evidence, reports, and runtime skill notes.
`;
function workspaceFiles(workspaceRoot) {
	return [
		[".chain-insights/workspace.json", workspaceJson(workspaceRoot)],
		["README.md", README],
		["AGENTS.md", AGENTS],
		["CLAUDE.md", CLAUDE],
		["imports/README.md", IMPORTS_README],
		["templates/README.md", TEMPLATES_README],
		["templates/case-brief.md", CASE_BRIEF],
		[".chain-insights/runtime-skill/SKILL.md", RUNTIME_SKILL],
		[".chain-insights/schema/README.md", SCHEMA_README],
		[".chain-insights/runtime/.keep", ""],
		[".chain-insights/runtime/logs/.keep", ""]
	];
}
async function assertNoFileCollisions(workspaceRoot) {
	for (const [relativePath] of workspaceFiles(workspaceRoot)) {
		const filePath = path.join(workspaceRoot, relativePath);
		try {
			await access(filePath);
			throw new Error(`Refusing to overwrite ${filePath}. Re-run with --force to replace workspace files.`);
		} catch (err) {
			if (err.code === "ENOENT") continue;
			throw err;
		}
	}
}
async function initWorkspace(options) {
	const workspaceRoot = path.resolve(options.targetDir);
	if (!options.force) await assertNoFileCollisions(workspaceRoot);
	for (const dir of WORKSPACE_DIRS) await mkdir(path.join(workspaceRoot, dir), { recursive: true });
	const filesWritten = [];
	const flag = options.force ? "w" : "wx";
	for (const [relativePath, content] of workspaceFiles(workspaceRoot)) {
		const filePath = path.join(workspaceRoot, relativePath);
		try {
			await writeFile(filePath, content, {
				mode: 384,
				flag
			});
			filesWritten.push(relativePath);
		} catch (err) {
			if (err.code === "EEXIST") throw new Error(`Refusing to overwrite ${filePath}. Re-run with --force to replace workspace files.`);
			throw err;
		}
	}
	return {
		workspaceRoot,
		filesWritten
	};
}
//#endregion
export { initWorkspace };

//# sourceMappingURL=init-CaOsHTIo.mjs.map