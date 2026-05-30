const require_data_extractor = require("./data-extractor-DS4rzy3M.cjs");
const require_frontmatter = require("./frontmatter-Dvqa5HX6.cjs");
const require_output_root = require("./output-root-YIbl6PwF.cjs");
const require_dossier = require("./dossier-BXy57V4-.cjs");
const require_store = require("./store-CQhU8dz8.cjs");
const require_evidence = require("./evidence-CvEesemA.cjs");
require("./cases-Bz_9XKEw.cjs");
const require_canvas = require("./canvas-p-oKCMjc.cjs");
const require_graph_normalizer = require("./graph-normalizer-DbjlbMpz.cjs");
let node_path = require("node:path");
let node_fs_promises = require("node:fs/promises");
//#region src/vault/schema.ts
const VAULT_DIRS = [
	".obsidian",
	"Canvases",
	"Entities",
	"Evidence",
	"published"
];
//#endregion
//#region src/vault/markdown.ts
function yamlString(value) {
	return JSON.stringify(value);
}
function frontmatter(values) {
	const lines = ["---"];
	for (const [key, value] of Object.entries(values)) if (Array.isArray(value)) {
		lines.push(`${key}:`);
		for (const item of value) lines.push(`  - ${yamlString(item)}`);
	} else lines.push(`${key}: ${typeof value === "boolean" ? String(value) : yamlString(value)}`);
	lines.push("---", "");
	return lines.join("\n");
}
function renderLiveCaseNote(input) {
	return frontmatter({
		type: "chain-insights-case",
		case_id: input.id,
		status: input.status,
		tags: input.tags,
		contains_sensitive_data: true,
		source_of_truth: `cases/${input.id}/`
	}) + [
		`# ${input.name}`,
		"",
		input.description,
		"",
		"## Live Workspace",
		"",
		`Status: ${input.status}`,
		`Evidence files: ${input.evidenceCount}`,
		`Evidence manifest verified: ${input.evidenceVerified ? "yes" : "no"}`,
		`Entities: ${input.entityCount}`,
		"",
		"## Navigation",
		"",
		"- [[Agent Console]]",
		"- [[Graph.canvas]]",
		"- [[Cases]]",
		`- [[cases/${input.id}/Evidence|Evidence]]`,
		`- [[cases/${input.id}/Entities|Entities]]`,
		"- [[Graphs]]",
		""
	].join("\n");
}
function renderCaseAgentConsole(input) {
	return frontmatter({
		type: "chain-insights-case-agent-console",
		case_id: input.id,
		contains_sensitive_data: true
	}) + [
		`# Agent Console: ${input.name}`,
		"",
		`Canonical case state: \`cases/${input.id}/\``,
		"",
		"## Case Files",
		"",
		"- [[Case]]",
		"- [[Graph.canvas]]",
		`- [[cases/${input.id}/Evidence|Evidence]]`,
		`- [[cases/${input.id}/Entities|Entities]]`,
		"",
		"## Current Counts",
		"",
		`- Evidence files: ${input.evidenceCount}`,
		`- Entities: ${input.entityCount}`,
		`- Manifest verified: ${input.evidenceVerified ? "yes" : "no"}`,
		""
	].join("\n");
}
function renderCaseEvidenceIndex(input, evidence) {
	return frontmatter({
		type: "chain-insights-case-evidence-index",
		case_id: input.id,
		contains_sensitive_data: true
	}) + [
		`# Evidence: ${input.name}`,
		"",
		`Canonical evidence directory: \`cases/${input.id}/evidence/\``,
		`Evidence files: ${input.evidenceCount}`,
		`Manifest verified: ${input.evidenceVerified ? "yes" : "no"}`,
		"",
		"## Evidence Notes",
		"",
		...evidence.length > 0 ? evidence.map((item) => `- [[${item.notePath.replace(/\.md$/, "")}|${item.id}]] (${item.source})`) : ["No evidence files recorded yet."],
		""
	].join("\n");
}
function renderEvidenceNote(input, caseId) {
	return frontmatter({
		type: "chain-insights-evidence",
		case_id: caseId,
		evidence_id: input.id,
		source: input.source,
		source_file: `cases/${caseId}/evidence/${input.filename}`,
		contains_sensitive_data: true
	}) + [
		`# Evidence: ${input.source}`,
		"",
		`Evidence ID: \`${input.id}\``,
		`Source file: \`cases/${caseId}/evidence/${input.filename}\``,
		`Captured: ${input.timestamp || "unknown"}`,
		`Query params: ${input.queryParams || "none"}`,
		"",
		"## Case",
		"",
		`- [[cases/${caseId}/Case|${caseId}]]`,
		"",
		"## Body",
		"",
		input.body.trim() || "No evidence body recorded.",
		""
	].join("\n");
}
function renderCaseEntityIndex(input, entities) {
	return frontmatter({
		type: "chain-insights-case-entity-index",
		case_id: input.id,
		contains_sensitive_data: true
	}) + [
		`# Entities: ${input.name}`,
		"",
		`Canonical dossier directory: \`cases/${input.id}/dossiers/\``,
		`Entities: ${entities.length}`,
		"",
		"## Entity Notes",
		"",
		...entities.length > 0 ? entities.map((item) => `- [[${item.notePath.replace(/\.md$/, "")}|${item.label}]] (${item.entityType})`) : ["No entities recorded yet."],
		""
	].join("\n");
}
function renderEntityNote(address, caseId, entityType) {
	return frontmatter({
		type: "chain-insights-entity",
		case_id: caseId,
		address,
		entity_type: entityType,
		contains_sensitive_data: true
	}) + [
		`# Entity: ${address}`,
		"",
		`Address: ${address}`,
		`Type: ${entityType}`,
		"",
		"## Cases",
		"",
		`- [[cases/${caseId}/Case|${caseId}]]`,
		""
	].join("\n");
}
function renderVaultHome() {
	return frontmatter({
		type: "chain-insights-vault-home",
		product: "Chain Insights",
		contains_sensitive_data: true
	}) + [
		"# Chain Insights Vault",
		"",
		"Chain Insights is an AML investigation CLI and MCP proxy layered on GraphRAG MCP.",
		"",
		"## Start Here",
		"",
		"- [[Cases]]",
		"- [[Entities]]",
		"- [[Evidence]]",
		"- [[Graphs]]",
		"- [[Agent Console]]",
		""
	].join("\n");
}
function renderRootIndex(title, type, links) {
	return frontmatter({
		type,
		product: "Chain Insights",
		contains_sensitive_data: true
	}) + [
		`# ${title}`,
		"",
		...links.map((link) => `- [[${link}]]`),
		""
	].join("\n");
}
function renderRootAgentConsole() {
	return frontmatter({
		type: "chain-insights-agent-console",
		product: "Chain Insights",
		contains_sensitive_data: true
	}) + [
		"# Agent Console",
		"",
		"Use Chain Insights case evidence as canonical local state and GraphRAG MCP for fresh graph facts.",
		"",
		"## Reading Order",
		"",
		"1. [[Home]]",
		"2. [[Cases]]",
		"3. [[Entities]]",
		"4. [[Evidence]]",
		"5. [[Graphs]]",
		""
	].join("\n");
}
function renderObsidianAppConfig() {
	return JSON.stringify({
		useMarkdownLinks: false,
		newLinkFormat: "shortest",
		alwaysUpdateLinks: true
	}, null, 2) + "\n";
}
function renderObsidianGraphConfig() {
	return JSON.stringify({
		"collapse-filter": true,
		search: "",
		showTags: true,
		showAttachments: true,
		hideUnresolved: false,
		showOrphans: true
	}, null, 2) + "\n";
}
function renderObsidianTemplatesConfig() {
	return JSON.stringify({
		folder: "",
		dateFormat: "YYYY-MM-DD",
		timeFormat: "HH:mm"
	}, null, 2) + "\n";
}
function renderVaultGitignore() {
	return [
		"# Chain Insights local runtime state",
		".chain-insights/runtime/",
		"",
		"# Obsidian local UI state",
		".obsidian/workspace.json",
		".obsidian/workspace-mobile.json",
		".obsidian/workspaces.json",
		"",
		"# Private export bundles are local by default",
		"published/",
		""
	].join("\n");
}
//#endregion
//#region src/vault/index.ts
const VAULT_FILES = [
	{
		path: ".obsidian/app.json",
		content: renderObsidianAppConfig()
	},
	{
		path: ".obsidian/graph.json",
		content: renderObsidianGraphConfig()
	},
	{
		path: ".obsidian/templates.json",
		content: renderObsidianTemplatesConfig()
	},
	{
		path: ".gitignore",
		content: renderVaultGitignore()
	},
	{
		path: "Home.md",
		content: renderVaultHome()
	},
	{
		path: "Cases.md",
		content: renderRootIndex("Cases", "chain-insights-vault-cases-index", ["Home", "Agent Console"])
	},
	{
		path: "Entities.md",
		content: renderRootIndex("Entities", "chain-insights-vault-entities-index", [
			"Home",
			"Cases",
			"Evidence"
		])
	},
	{
		path: "Evidence.md",
		content: renderRootIndex("Evidence", "chain-insights-vault-evidence-index", [
			"Home",
			"Cases",
			"Entities"
		])
	},
	{
		path: "Graphs.md",
		content: renderRootIndex("Graphs", "chain-insights-vault-graphs-index", [
			"Home",
			"Cases",
			"Entities",
			"Evidence"
		])
	},
	{
		path: "Agent Console.md",
		content: renderRootAgentConsole()
	},
	{
		path: "Canvases/README.md",
		content: renderRootIndex("Canvases", "chain-insights-vault-canvases-readme", ["Home", "Graphs"])
	},
	{
		path: "Entities/README.md",
		content: renderRootIndex("Entities Folder", "chain-insights-vault-entities-readme", ["Entities", "Cases"])
	},
	{
		path: "Evidence/README.md",
		content: renderRootIndex("Evidence Folder", "chain-insights-vault-evidence-readme", ["Evidence", "Cases"])
	}
];
async function scaffoldVault(options) {
	const workspaceRoot = (0, node_path.resolve)(options.workspaceRoot);
	const force = options.force === true;
	if (!force) await assertNoVaultFileCollisions(workspaceRoot);
	for (const dir of VAULT_DIRS) await (0, node_fs_promises.mkdir)((0, node_path.join)(workspaceRoot, dir), { recursive: true });
	const filesWritten = [];
	for (const file of VAULT_FILES) {
		await writeVaultFile(workspaceRoot, file, force);
		filesWritten.push(file.path);
	}
	return {
		workspaceRoot,
		filesWritten
	};
}
async function refreshCaseVault(options) {
	const workspace = require_output_root.workspaceOutputPaths();
	const force = options.force === true;
	const [caseInfo, evidenceVerification, evidence, dossiers, graph] = await Promise.all([
		require_store.CaseStore.get(options.caseId),
		require_evidence.EvidenceStore.verifyManifest(options.caseId),
		readCaseEvidence(options.caseId),
		require_dossier.DossierStore.listSummaries(options.caseId),
		loadLiveCaseGraph(options.caseId)
	]);
	const caseSummary = {
		id: caseInfo.id,
		name: caseInfo.name,
		status: caseInfo.status,
		tags: caseInfo.tags,
		description: caseInfo.description,
		evidenceCount: evidenceVerification.count,
		evidenceVerified: evidenceVerification.ok,
		entityCount: dossiers.length
	};
	const canvasGraph = {
		...graph,
		nodes: mergeDossierNodes(graph.nodes, dossiers)
	};
	const canvas = graphToCaseVaultCanvas(require_canvas.graphToCanvas(canvasGraph), caseInfo.id, canvasGraph.nodes);
	const evidenceSummaries = evidence.map((evidenceDoc) => ({
		...evidenceDoc,
		notePath: `Evidence/${require_canvas.safeFilename(`${evidenceDoc.filename.replace(/\.md$/, "")}-${caseInfo.id}`)}`
	}));
	const entityFiles = entityFilesForCase(caseInfo.id, canvasGraph.nodes, dossiers);
	const entitySummaries = [...entityFiles.values()].map((entry) => entry.summary).sort((left, right) => left.label.localeCompare(right.label));
	const files = [
		{
			path: `cases/${caseInfo.id}/Case.md`,
			content: renderLiveCaseNote(caseSummary)
		},
		{
			path: `cases/${caseInfo.id}/Agent Console.md`,
			content: renderCaseAgentConsole(caseSummary)
		},
		{
			path: `cases/${caseInfo.id}/Evidence.md`,
			content: renderCaseEvidenceIndex(caseSummary, evidenceSummaries)
		},
		{
			path: `cases/${caseInfo.id}/Entities.md`,
			content: renderCaseEntityIndex(caseSummary, entitySummaries)
		},
		{
			path: `cases/${caseInfo.id}/Graph.canvas`,
			content: JSON.stringify(canvas, null, 2) + "\n"
		},
		...evidenceSummaries.map((evidenceDoc) => ({
			path: evidenceDoc.notePath,
			content: renderEvidenceNote(evidenceDoc, caseInfo.id)
		})),
		...[...entityFiles.values()].map((entry) => ({
			path: entry.summary.notePath,
			content: entry.content
		}))
	];
	if (!force) await assertNoFileCollisions(workspace.root, files);
	const filesWritten = [];
	for (const file of files) {
		await writeVaultFile(workspace.root, file, force);
		filesWritten.push(file.path);
	}
	return {
		caseId: caseInfo.id,
		filesWritten,
		nextFile: `cases/${caseInfo.id}/Case.md`
	};
}
async function assertNoVaultFileCollisions(workspaceRoot) {
	await assertNoFileCollisions(workspaceRoot, VAULT_FILES);
}
async function assertNoFileCollisions(workspaceRoot, files) {
	for (const file of files) try {
		await (0, node_fs_promises.access)((0, node_path.join)(workspaceRoot, file.path));
		throw new Error(`Refusing to overwrite existing vault file: ${file.path}`);
	} catch (error) {
		if (isNotFoundError(error)) continue;
		throw error;
	}
}
async function writeVaultFile(workspaceRoot, file, force) {
	try {
		const filePath = (0, node_path.join)(workspaceRoot, file.path);
		await (0, node_fs_promises.mkdir)((0, node_path.dirname)(filePath), { recursive: true });
		await (0, node_fs_promises.writeFile)(filePath, file.content, {
			encoding: "utf8",
			flag: force ? "w" : "wx"
		});
	} catch (error) {
		if (!force && isFileExistsError(error)) throw new Error(`Refusing to overwrite existing vault file: ${file.path}`);
		throw error;
	}
}
function isFileExistsError(error) {
	return error instanceof Error && "code" in error && error.code === "EEXIST";
}
function isNotFoundError(error) {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function mergeDossierNodes(graphNodes, dossiers) {
	const nodesById = /* @__PURE__ */ new Map();
	const aliases = /* @__PURE__ */ new Map();
	graphNodes.forEach((node, index) => {
		const id = String(node["id"] ?? node["address"] ?? `node-${index + 1}`);
		nodesById.set(id, node);
		aliases.set(id, id);
		if (typeof node["address"] === "string") aliases.set(node["address"], id);
	});
	for (const dossier of dossiers) {
		const existingId = aliases.get(dossier.address);
		if (existingId) {
			const existing = nodesById.get(existingId);
			if (existing) nodesById.set(existingId, enrichDossierNode(existing, dossier.type));
		} else nodesById.set(dossier.address, {
			id: dossier.address,
			address: dossier.address,
			node_type: dossier.type,
			roles: [dossier.type]
		});
	}
	return [...nodesById.values()];
}
async function readCaseEvidence(caseId) {
	const evidenceDir = (0, node_path.join)(require_output_root.workspaceOutputPaths().casesRoot, caseId, "evidence");
	const files = await (0, node_fs_promises.readdir)(evidenceDir).catch(() => []);
	const docs = [];
	for (const filename of files.filter((file) => file.endsWith(".md")).sort()) {
		const { frontmatter, body } = require_frontmatter.parseFrontmatter(await (0, node_fs_promises.readFile)((0, node_path.join)(evidenceDir, filename), "utf8"));
		docs.push({
			id: frontmatter["id"] || filename.replace(/\.md$/, ""),
			filename,
			source: frontmatter["source"] || "unknown",
			timestamp: frontmatter["timestamp"] || "",
			queryParams: frontmatter["queryParams"] || "",
			body
		});
	}
	return docs;
}
function entityFilesForCase(caseId, graphNodes, dossiers) {
	const files = /* @__PURE__ */ new Map();
	for (const [index, node] of graphNodes.entries()) {
		const label = entityLabelForGraphNode(node, index);
		const entityType = String(node["entityType"] ?? node["node_type"] ?? node["nodeType"] ?? "unknown");
		const notePath = `Entities/${require_canvas.safeFilename(label)}`;
		files.set(notePath, {
			summary: {
				label,
				notePath,
				entityType
			},
			content: renderEntityNote(label, caseId, entityType)
		});
	}
	for (const dossier of dossiers) {
		const notePath = `Entities/${require_canvas.safeFilename(dossier.address)}`;
		files.set(notePath, {
			summary: {
				label: dossier.address,
				notePath,
				entityType: dossier.type
			},
			content: renderEntityNote(dossier.address, caseId, dossier.type)
		});
	}
	return files;
}
function entityLabelForGraphNode(node, index) {
	return String(node["address"] ?? node["id"] ?? `node-${index + 1}`);
}
function graphToCaseVaultCanvas(canvas, caseId, graphNodes) {
	return {
		nodes: canvas.nodes.map((node) => {
			if (node.id === "case" && node.type === "file") return {
				...node,
				file: `cases/${caseId}/Case.md`
			};
			const entityIndex = /^entity-(\d+)$/.exec(node.id)?.[1];
			if (node.type === "file" && entityIndex) {
				const graphNode = graphNodes[Number(entityIndex) - 1];
				if (graphNode) return {
					...node,
					file: `Entities/${require_canvas.safeFilename(entityLabelForGraphNode(graphNode, Number(entityIndex) - 1))}`
				};
			}
			return node;
		}),
		edges: canvas.edges
	};
}
async function loadLiveCaseGraph(caseId) {
	const graph = await require_data_extractor.extractGraphFromCase(caseId);
	return require_graph_normalizer.normalizeGraphPayload({
		schema: "chain-insights.graph.v1",
		nodes: graph.nodes,
		edges: graph.edges,
		flows: [],
		edge_anchors: [],
		metadata: graph.metadata
	});
}
function enrichDossierNode(node, dossierType) {
	const enriched = { ...node };
	if (typeof enriched["node_type"] !== "string" || enriched["node_type"] === "unknown") enriched["node_type"] = dossierType;
	if (!Array.isArray(enriched["roles"]) || enriched["roles"].length === 0) enriched["roles"] = [dossierType];
	return enriched;
}
//#endregion
exports.assertNoVaultFileCollisions = assertNoVaultFileCollisions;
exports.refreshCaseVault = refreshCaseVault;
exports.scaffoldVault = scaffoldVault;
