import { t as LOCAL_GRAPH_MCP_ENDPOINT } from "./mcp-endpoint-QQ5Lbqc2.mjs";
import path from "node:path";
import { access, mkdir, writeFile } from "node:fs/promises";
//#region src/workspace/init.ts
const WORKSPACE_DIRS = [
	".chain-insights",
	".chain-insights/schema",
	".chain-insights/runtime",
	".chain-insights/runtime/logs",
	".chain-insights/runtime-skill",
	"artifacts",
	"entities",
	"imports",
	"reports",
	"reports/graphs",
	"reports/tables",
	"sessions",
	"templates",
	"published"
];
const DEFAULT_DOMAIN_HINTS = ["aml"];
function todayIso() {
	return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function workspaceJson(workspaceRoot) {
	return JSON.stringify({
		schema: "chain-insights.workspace.v1",
		name: "Chain Insights Workspace",
		workspace_root: workspaceRoot,
		default_network: "bittensor",
		graph_mcp_endpoint: LOCAL_GRAPH_MCP_ENDPOINT,
		artifacts_dir: "artifacts",
		imports_dir: "imports",
		reports_dir: "reports",
		templates_dir: "templates",
		domain_hints: DEFAULT_DOMAIN_HINTS,
		created_at: todayIso()
	}, null, 2) + "\n";
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
`;
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
`;
const CLAUDE = AGENTS;
const CASE_BRIEF = `# Workspace Brief

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
`;
const TEMPLATES_README = `# Reusable Workspace Templates

Store local report, prompt, artifact, and note templates here.

Templates are optional workspace helpers. They are not evidence and should not
be treated as durable workspace state until copied into an artifact, report,
entity note, or session note.
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
cia mcp call graph_query_batch network=<network> 'queries=[{"id":"node_labels","query":"USE live_topology MATCH (n:Identity) RETURN \"Identity\" AS node_label, count(n) AS sample_count LIMIT 1"},{"id":"archive_flow_sample","query":"USE archive_topology MATCH (:Identity)-[f:FLOWS_TO]->(:Identity) RETURN f.period_granularity AS granularity, f.amount_usd_sum AS amount_usd_sum LIMIT 20"},{"id":"archive_member_address_sample","query":"USE archive_topology MATCH (i:Identity)-[:HAS_ADDRESS]->(m:Address) RETURN i.identity_id AS identity_id, m.address AS member_address, m.network AS member_network LIMIT 20"}]'
\`\`\`

Then update this file with observed labels, relationship types, and allowed
property names for the active network.

The slim identity graph schema:

- Every topology node is \`(:Identity)\`, keyed by \`identity_id\` in the
  canonical prefixed form \`<network>:<canonical_address>\` (for example
  \`bittensor:0x1874a43d7c6d888f9eda3d22a3a49704e3cadb24\`). Satellite
  \`(:Address)\` nodes exist only for member-address lookup. There is no
  \`network\` property; each network has its own graph.
- Identity nodes carry no member-address list property. Member-address
  forms (the canonical 0x form, plus the SS58 substrate form when the
  identity has a substrate source) live exclusively on the satellite
  \`(:Address {address, network})\` nodes reached via
  \`(:Identity)-[:HAS_ADDRESS]->(:Address)\`. Enumerate an identity's
  member forms with:
  \`MATCH (i:Identity {identity_id: $id})-[:HAS_ADDRESS]->(m:Address)
  RETURN m.address, m.network\`. Use those satellite forms to report the
  human-recognizable address forms; never invent address conversions.
- Resolve any member address form (0x or SS58) to its identity through
  the indexed exact lookup:
  \`MATCH (m:Address {address: $input})<-[:HAS_ADDRESS]-(i:Identity)
  RETURN i.identity_id LIMIT 1\`. \`:Address(address)\` is unique and
  index-backed.
- Other Identity properties: \`labels\` (array) and \`is_exchange\`
  (sparse true/null traversal hint).
- Identity nodes carry a slim live risk verdict for quick triage
  (\`risk_score\` float, \`risk_level\` string) plus base activity rollups:
  \`degree_in\`/\`degree_out\`/\`degree_total\` (distinct counterparty
  identities), \`tx_in_count\`/\`tx_out_count\`/\`tx_total_count\`,
  \`total_in_usd\`/\`total_out_usd\`/\`total_volume_usd\`, \`net_flow_usd\`
  (in minus out; positive = net receiver) — all computed from external
  flows only — and \`first_activity_timestamp\`/
  \`last_activity_timestamp\`/\`activity_span_days\`, which include all
  flows (self-loops included). Movement between an identity's own member
  forms is excluded from the degree/count/USD rollups and exposed
  separately as
  \`internal_tx_count\`/\`internal_volume_usd\` (sparse: absent when zero,
  like \`is_exchange\`). FLOWS_TO edges carry \`tx_count\`,
  \`amount_usd_sum\`, \`avg_tx_size_usd\` (understates when
  \`price_coverage_ratio\` < 1), \`first_seen_timestamp\`/
  \`last_seen_timestamp\`, \`first_tx_id\`/\`last_tx_id\`,
  \`dominant_asset\` (largest USD share), and \`price_coverage_ratio\`.
  Lifetime aggregates are the only serving window.
- Money flow is \`(:Identity)-[:FLOWS_TO]->(:Identity)\`. Public AML tools
  accept blockchain/member addresses and resolve them to identity-grain
  topology internally.
- Detailed, provenanced scoring comes from \`USE facts\`. ML risk with
  model versions and processing dates:
  \`(:Identity)-[:HAS_RISK_SCORE]->(:RiskScore)\`; label risk:
  \`(:Identity)-[:HAS_LABEL]->(:AddressLabel)\`; lifetime metrics:
  \`(:Identity)-[:HAS_FEATURE]->(:AddressFeature)\`. Facts identity keys
  match live \`identity_id\` values exactly. Node \`risk_score\`/
  \`risk_level\` are quick-triage verdicts only; do not read \`ml_*\`,
  \`confluence_score\`, or \`pattern_flags\` off topology nodes — those
  properties do not exist.

Rules:

- Prefer \`graph_query\` and \`graph_query_batch\` for graph-language reads.
- Do not use legacy \`topology_scope\` arguments to choose a graph. If an
  older endpoint surfaces that argument, treat it as compatibility routing
  only. The live/archive/facts graph choice stays inside the query via
  \`USE ...\`.
- Use \`USE live_topology\` for recent topology, \`USE archive_topology\`
  for historical topology, and \`USE facts\` for labels, features,
  risk scores, assets, and enrichment. Archived money-flow topology is
  exposed as \`(:Identity)-[:FLOWS_TO]->(:Identity)\` with
  \`period_granularity\`, \`period_start_date\`, and \`period_end_date\` on
  the relationship. Archive member-address lookup is exposed as
  \`(:Identity)-[:HAS_ADDRESS]->(:Address)\` with \`Address.address\` and
  member-ledger \`Address.network\` projected for member-address resolution.
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

All trace tools take blockchain/member addresses as inputs, resolve them to
canonical identity keys internally, and return \`chain-insights.trace.v1\`.
Preserve full blockchain addresses in
\`input.addresses\`, \`addresses[].address\`, \`edges[].from_address\`,
\`edges[].to_address\`, \`paths[].addresses\`, \`candidate_labels[].address\`,
and \`continuation\` address lists. Preserve canonical identity mappings only
inside explicit \`identity_resolution\` audit metadata.
`;
const SCHEMA_README = `# Runtime Schema Captures

Store graph schema captures here, for example:

\`\`\`text
bittensor.graph-schema.json
\`\`\`

Schema captures should be generated before the first graph workflow in a fresh
workspace, then referenced by artifacts, reports, and runtime skill notes.
`;
function workspaceFiles(workspaceRoot) {
	return [
		[".chain-insights/workspace.json", workspaceJson(workspaceRoot)],
		["README.md", README],
		["AGENTS.md", AGENTS],
		["CLAUDE.md", CLAUDE],
		["imports/README.md", IMPORTS_README],
		["templates/README.md", TEMPLATES_README],
		["templates/workspace-brief.md", CASE_BRIEF],
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

//# sourceMappingURL=init-DKOjfiUH.mjs.map