import { n as extractGraphFromCase } from "./data-extractor-DZUJu1Bz.mjs";
import { t as parseFrontmatter } from "./frontmatter-D0ccQnUM.mjs";
import { n as workspaceOutputPaths } from "./output-root-BRhzhhXZ.mjs";
import { t as DossierStore } from "./dossier-Bjpcbcxa.mjs";
import { t as CaseStore } from "./store-CTtqQtaE.mjs";
import { t as EvidenceStore } from "./evidence-D96PTzOQ.mjs";
import "./cases-Cp9DUbEV.mjs";
import { t as normalizeGraphPayload } from "./graph-normalizer-CXP06jKh.mjs";
import path from "node:path";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import * as z from "zod";
import { createHash } from "node:crypto";
//#region src/export/paths.ts
function safeSlug(value) {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "case-export";
}
function safeFilename(value) {
	const parsed = path.parse(value);
	return `${safeSlug(parsed.name)}${parsed.ext.toLowerCase().replace(/[^.a-z0-9]/g, "") || ".md"}`;
}
function assertInsideDirectory(root, candidate) {
	const resolvedRoot = path.resolve(root);
	const resolvedCandidate = path.resolve(candidate);
	const relative = path.relative(resolvedRoot, resolvedCandidate);
	if (relative === "" || !relative.startsWith("..") && !path.isAbsolute(relative)) return;
	throw new Error(`Refusing to write outside export directory: ${candidate}`);
}
async function assertNoSymlink(filePath) {
	try {
		if ((await lstat(filePath)).isSymbolicLink()) throw new Error(`Refusing to write through symlink: ${filePath}`);
	} catch (err) {
		if (err.code === "ENOENT") return;
		throw err;
	}
}
async function writePrivateFile(root, relativePath, content) {
	const filePath = path.join(root, relativePath);
	assertInsideDirectory(root, filePath);
	await mkdir(path.dirname(filePath), {
		recursive: true,
		mode: 448
	});
	await assertNoSymlink(filePath);
	await writeFile(filePath, content, { mode: 384 });
	const bytes = Buffer.byteLength(content, "utf8");
	return {
		path: relativePath,
		sha256: createHash("sha256").update(content).digest("hex"),
		bytes
	};
}
//#endregion
//#region src/export/schema.ts
const CaseExportTargetSchema = z.enum(["obsidian-llmwiki"]);
const CaseExportModeSchema = z.enum([
	"private",
	"partner",
	"public"
]);
const caseIdRegex = /^\d{8}_\d{3}_[a-z0-9][a-z0-9-]*$/;
const CaseExportOptionsSchema = z.object({
	caseId: z.string().regex(caseIdRegex),
	target: CaseExportTargetSchema.default("obsidian-llmwiki"),
	mode: CaseExportModeSchema.default("private"),
	outputDir: z.string().optional()
});
const ExportedFileSchema = z.object({
	path: z.string().min(1),
	sha256: z.string().regex(/^[a-f0-9]{64}$/),
	bytes: z.number().int().nonnegative()
});
const CaseExportManifestSchema = z.object({
	schema: z.literal("chain-insights.case_export.v1"),
	case_id: z.string().regex(caseIdRegex),
	case_name: z.string().min(1),
	exported_at: z.string().datetime(),
	mode: CaseExportModeSchema,
	target: CaseExportTargetSchema,
	source_workspace: z.string().min(1),
	verification: z.object({
		evidence_manifest_verified: z.boolean(),
		verified_at: z.string().datetime(),
		evidence_count: z.number().int().nonnegative()
	}),
	files: z.array(ExportedFileSchema),
	redactions: z.array(z.string()),
	warnings: z.array(z.string())
});
const JsonCanvasNodeSchema = z.object({
	id: z.string().min(1),
	type: z.enum([
		"text",
		"file",
		"link",
		"group"
	]),
	x: z.number(),
	y: z.number(),
	width: z.number().positive(),
	height: z.number().positive(),
	text: z.string().optional(),
	file: z.string().optional(),
	url: z.string().optional(),
	label: z.string().optional(),
	color: z.string().optional()
});
const JsonCanvasEdgeSchema = z.object({
	id: z.string().min(1),
	fromNode: z.string().min(1),
	toNode: z.string().min(1),
	fromSide: z.enum([
		"top",
		"right",
		"bottom",
		"left"
	]).optional(),
	toSide: z.enum([
		"top",
		"right",
		"bottom",
		"left"
	]).optional(),
	toEnd: z.enum(["none", "arrow"]).optional(),
	label: z.string().optional(),
	color: z.string().optional()
});
const JsonCanvasSchema = z.object({
	nodes: z.array(JsonCanvasNodeSchema),
	edges: z.array(JsonCanvasEdgeSchema)
});
//#endregion
//#region src/export/canvas.ts
function roleColor(roles) {
	if (roles.includes("victim")) return "1";
	if (roles.includes("suspect") || roles.includes("scam_candidate")) return "2";
	if (roles.includes("deposit")) return "3";
	if (roles.includes("exchange")) return "5";
	if (roles.includes("service")) return "6";
	return "#808080";
}
function nodeRoles(node) {
	return Array.isArray(node["roles"]) ? node["roles"].map(String) : [];
}
function nodeLabel(node) {
	return String(node["address"] ?? node["id"] ?? "unknown");
}
function graphNodeId(node, index) {
	return String(node["id"] ?? node["address"] ?? `node-${index + 1}`);
}
function entityNotePath(entityId) {
	return `Entities/${safeFilename(entityId)}`;
}
function graphToCanvas(graph) {
	const nodes = [{
		id: "case",
		type: "file",
		file: "Case.md",
		x: 0,
		y: 0,
		width: 360,
		height: 120,
		color: "4"
	}];
	const nodeIdMap = /* @__PURE__ */ new Map();
	graph.nodes.forEach((node, index) => {
		const rawId = graphNodeId(node, index);
		const canvasId = `entity-${index + 1}`;
		nodeIdMap.set(rawId, canvasId);
		nodes.push({
			id: canvasId,
			type: "file",
			file: entityNotePath(rawId),
			x: 420 + index % 4 * 340,
			y: Math.floor(index / 4) * 220,
			width: 300,
			height: 120,
			color: roleColor(nodeRoles(node))
		});
	});
	const edges = graph.edges.flatMap((edge, index) => {
		const from = nodeIdMap.get(String(edge["source"] ?? ""));
		const to = nodeIdMap.get(String(edge["target"] ?? ""));
		if (!from || !to) return [];
		return [{
			id: `edge-${index + 1}`,
			fromNode: from,
			toNode: to,
			fromSide: "right",
			toSide: "left",
			toEnd: "arrow",
			label: String(edge["edge_type"] ?? "related_to")
		}];
	});
	for (const [index, node] of graph.nodes.entries()) edges.push({
		id: `case-link-${index + 1}`,
		fromNode: "case",
		toNode: `entity-${index + 1}`,
		fromSide: "right",
		toSide: "left",
		toEnd: "arrow",
		label: nodeLabel(node)
	});
	return JsonCanvasSchema.parse({
		nodes,
		edges
	});
}
//#endregion
//#region src/export/graph.ts
function isRecord(value) {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
function nodeId(node) {
	return String(node["id"] ?? node["address"] ?? "");
}
function edgeKey(edge) {
	return `${String(edge["source"] ?? "")}->${String(edge["target"] ?? "")}:${String(edge["edge_type"] ?? "related_to")}`;
}
function mergeGraphs(graphs) {
	const nodes = /* @__PURE__ */ new Map();
	const edges = /* @__PURE__ */ new Map();
	for (const graph of graphs) {
		for (const rawNode of graph.nodes) {
			const id = nodeId(rawNode);
			if (id) nodes.set(id, {
				...nodes.get(id) ?? {},
				...rawNode,
				id
			});
		}
		for (const rawEdge of graph.edges) {
			if (typeof rawEdge["source"] !== "string" || typeof rawEdge["target"] !== "string") continue;
			edges.set(edgeKey(rawEdge), {
				...edges.get(edgeKey(rawEdge)) ?? {},
				...rawEdge
			});
		}
	}
	return {
		schema: "chain-insights.graph.v1",
		nodes: [...nodes.values()],
		edges: [...edges.values()],
		flows: graphs.flatMap((graph) => graph.flows),
		edge_anchors: graphs.flatMap((graph) => graph.edge_anchors),
		metadata: {
			source: "case-export",
			graph_count: graphs.length,
			generated_at: (/* @__PURE__ */ new Date()).toISOString()
		}
	};
}
async function loadCaseExportGraph(caseId) {
	const paths = workspaceOutputPaths();
	const files = await readdir(paths.reportGraphsRoot).catch(() => []);
	const graphs = [];
	for (const file of files.filter((name) => name.endsWith(".graph.json")).sort()) {
		const parsed = JSON.parse(await readFile(path.join(paths.reportGraphsRoot, file), "utf8"));
		if (isRecord(parsed) && parsed["schema"] === "chain-insights.graph.v1") graphs.push(normalizeGraphPayload(parsed));
	}
	if (graphs.length > 0) return mergeGraphs(graphs);
	const fallback = await extractGraphFromCase(caseId);
	return normalizeGraphPayload({
		schema: "chain-insights.graph.v1",
		nodes: fallback.nodes,
		edges: fallback.edges,
		flows: [],
		edge_anchors: [],
		metadata: fallback.metadata
	});
}
//#endregion
//#region src/export/markdown.ts
function frontmatter(values) {
	const lines = ["---"];
	for (const [key, value] of Object.entries(values)) if (Array.isArray(value)) {
		lines.push(`${key}:`);
		for (const item of value) lines.push(`  - ${JSON.stringify(String(item))}`);
	} else lines.push(`${key}: ${JSON.stringify(value)}`);
	lines.push("---", "");
	return lines.join("\n");
}
function renderReadme(caseName) {
	return [
		`# ${caseName} Export`,
		"",
		"Open this directory as an Obsidian vault or give it to an LLMWiki-style knowledge workflow.",
		"",
		"Start with:",
		"",
		"- `Case.md`",
		"- `Agent Console.md`",
		"- `LLMWIKI.md`",
		"- `graph.chain-insights.json` when present",
		""
	].join("\n");
}
function renderCaseMarkdown(input) {
	return frontmatter({
		type: "chain-insights-case",
		case_id: input.caseInfo.id,
		status: input.caseInfo.status,
		tags: input.caseInfo.tags,
		contains_sensitive_data: input.mode !== "public"
	}) + [
		`# ${input.caseInfo.name}`,
		"",
		`Case ID: \`${input.caseInfo.id}\``,
		`Status: ${input.caseInfo.status}`,
		`Evidence manifest: ${input.evidenceVerified ? "verified" : "failed"}`,
		`Evidence files: ${input.evidenceCount}`,
		`Entities: ${input.entityCount}`,
		"",
		"## Summary",
		"",
		input.caseInfo.description || "No description recorded.",
		"",
		"## Start Here",
		"",
		"- [[Agent Console]]",
		"- [[LLMWIKI]]",
		"- [[Sources/evidence-manifest]]",
		""
	].join("\n");
}
function renderAgentConsole(caseName) {
	return [
		"# Agent Console",
		"",
		`Case: [[Case|${caseName}]]`,
		"",
		"## Reading Order",
		"",
		"1. [[Case]]",
		"2. [[LLMWIKI]]",
		"3. `graph.chain-insights.json`",
		"4. [[Sources/evidence-manifest]]",
		"5. Entity and evidence notes linked from the case.",
		"",
		"## Agent Prompts",
		"",
		"- [[Prompts/Codex]]",
		"- [[Prompts/Claude-Code]]",
		"- [[Prompts/ChatGPT]]",
		"",
		"## Rules",
		"",
		"- Treat Chain Insights case evidence and manifests as canonical.",
		"- Use Chain Insights tools for fresh graph facts.",
		"- Preserve full blockchain addresses exactly unless this is a public redacted export.",
		""
	].join("\n");
}
function renderLlmWiki() {
	return [
		"# LLMWiki Entry",
		"",
		"This directory is a Chain Insights case export.",
		"",
		"Canonical machine files:",
		"",
		"- `manifest.chain-insights.json`",
		"- `graph.chain-insights.json`",
		"- `Graph.canvas`",
		"",
		"Human and agent notes:",
		"",
		"- `Case.md`",
		"- `Agent Console.md`",
		"- `Entities/`",
		"- `Evidence/`",
		"- `Prompts/`",
		""
	].join("\n");
}
function renderLlmsTxt() {
	return [
		"# Chain Insights Case Export",
		"",
		"Read these files first:",
		"- Case.md",
		"- Agent Console.md",
		"- graph.chain-insights.json",
		"- Entities/",
		"- Evidence/",
		"",
		"Source of truth:",
		"- manifest.chain-insights.json",
		"- Sources/evidence-manifest.md",
		""
	].join("\n");
}
function renderPrompt(agentName) {
	return [
		`# ${agentName} Case Prompt`,
		"",
		"You are reading a Chain Insights case export.",
		"",
		"Treat `manifest.chain-insights.json`, `Sources/evidence-manifest.md`, and original case evidence as canonical.",
		"Use generated prose for orientation, not as a replacement for evidence.",
		"Use Chain Insights MCP tools for fresh graph facts when available.",
		""
	].join("\n");
}
//#endregion
//#region src/export/redaction.ts
const EVM_ADDRESS_RE = /\b0x[a-fA-F0-9]{40}\b/g;
const SUBSTRATE_ADDRESS_RE = /\b5[1-9A-HJ-NP-Za-km-z]{20,64}\b/g;
const SECRET_PATTERNS = [
	/\bci_test_[A-Za-z0-9_-]+\b/g,
	/\b(?:privateKey|walletPrivateKey|secret|token|authorization)\s*[:=]\s*["']?[^"'\s]+/gi,
	/\b0x[a-fA-F0-9]{64}\b/g
];
function createRedactor(mode) {
	const aliases = /* @__PURE__ */ new Map();
	const redactions = /* @__PURE__ */ new Set();
	function aliasFor(address) {
		const existing = aliases.get(address);
		if (existing) return existing;
		const alias = `addr_${String(aliases.size + 1).padStart(3, "0")}`;
		aliases.set(address, alias);
		redactions.add(`aliased:${alias}`);
		return alias;
	}
	function redactSecrets(input) {
		let output = input;
		for (const pattern of SECRET_PATTERNS) output = output.replace(pattern, () => {
			redactions.add("secret");
			return "[redacted-secret]";
		});
		return output;
	}
	function text(input) {
		let output = redactSecrets(input);
		if (mode === "public") {
			output = output.replace(SUBSTRATE_ADDRESS_RE, (match) => aliasFor(match));
			output = output.replace(EVM_ADDRESS_RE, (match) => aliasFor(match));
		}
		return output;
	}
	function value(input) {
		if (typeof input === "string") return text(input);
		if (Array.isArray(input)) return input.map((item) => value(item));
		if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).map(([key, entry]) => [key, value(entry)]));
		return input;
	}
	return {
		text,
		value,
		aliasFor,
		redactions: () => [...redactions].sort()
	};
}
//#endregion
//#region src/export/index.ts
async function readEvidence(caseId) {
	const paths = workspaceOutputPaths();
	const dir = path.join(paths.casesRoot, caseId, "evidence");
	const files = await readdir(dir).catch(() => []);
	const docs = [];
	for (const filename of files.filter((file) => file.endsWith(".md")).sort()) {
		const { frontmatter, body } = parseFrontmatter(await readFile(path.join(dir, filename), "utf8"));
		docs.push({
			id: frontmatter["id"] || filename.replace(/\.md$/, ""),
			filename,
			source: frontmatter["source"] || "unknown",
			timestamp: frontmatter["timestamp"] || "",
			body
		});
	}
	return docs;
}
async function writeFiles(root, entries) {
	const written = [];
	for (const [relativePath, content] of entries) written.push(await writePrivateFile(root, relativePath, content));
	return written;
}
async function exportCase(rawOptions) {
	const options = CaseExportOptionsSchema.parse(rawOptions);
	const workspace = workspaceOutputPaths();
	const caseInfo = await CaseStore.get(options.caseId);
	const redactor = createRedactor(options.mode);
	const evidenceVerification = await EvidenceStore.verifyManifest(options.caseId);
	const evidenceDocs = await readEvidence(options.caseId);
	const dossiers = await DossierStore.listSummaries(options.caseId);
	const graph = redactor.value(await loadCaseExportGraph(options.caseId));
	const canvas = graphToCanvas(graph);
	const outputRoot = path.resolve(options.outputDir ?? path.join(workspace.root, "published", safeSlug(caseInfo.name)));
	await mkdir(outputRoot, {
		recursive: true,
		mode: 448
	});
	const entries = [
		["README.md", renderReadme(redactor.text(caseInfo.name))],
		["Case.md", renderCaseMarkdown({
			caseInfo: {
				id: caseInfo.id,
				name: redactor.text(caseInfo.name),
				status: caseInfo.status,
				tags: caseInfo.tags,
				description: redactor.text(caseInfo.description)
			},
			mode: options.mode,
			evidenceVerified: evidenceVerification.ok,
			evidenceCount: evidenceVerification.count,
			entityCount: dossiers.length
		})],
		["LLMWIKI.md", renderLlmWiki()],
		["llms.txt", renderLlmsTxt()],
		["Agent Console.md", renderAgentConsole(redactor.text(caseInfo.name))],
		["Prompts/Codex.md", renderPrompt("Codex")],
		["Prompts/Claude-Code.md", renderPrompt("Claude Code")],
		["Prompts/ChatGPT.md", renderPrompt("ChatGPT")],
		["Sources/evidence-manifest.md", `# Evidence Manifest\n\nVerified: ${evidenceVerification.ok ? "yes" : "no"}\nEvidence files: ${evidenceVerification.count}\n`],
		["Sources/reports-index.md", "# Reports Index\n\nGraph and report artifacts are exported when present.\n"],
		["graph.chain-insights.json", JSON.stringify(graph, null, 2) + "\n"],
		["Graph.canvas", JSON.stringify(canvas, null, 2) + "\n"]
	];
	for (const evidence of evidenceDocs) entries.push([path.join("Evidence", safeFilename(evidence.id)), redactor.text([
		`# Evidence: ${evidence.source}`,
		"",
		`Source file: \`${evidence.filename}\``,
		`Captured: ${evidence.timestamp || "unknown"}`,
		"",
		evidence.body,
		""
	].join("\n"))]);
	const entityPaths = /* @__PURE__ */ new Set();
	for (const dossier of dossiers) {
		const entityId = options.mode === "public" ? redactor.aliasFor(dossier.address) : dossier.address;
		const entityPath = path.join("Entities", safeFilename(entityId));
		entityPaths.add(entityPath);
		entries.push([entityPath, redactor.text([
			`# Entity: ${entityId}`,
			"",
			`Type: ${dossier.type}`,
			`First seen: ${dossier.firstSeen || "unknown"}`,
			`Last seen: ${dossier.lastSeen || "unknown"}`,
			`Risk tags: ${dossier.riskTags || "none"}`,
			""
		].join("\n"))]);
	}
	for (const [index, node] of graph.nodes.entries()) {
		const entityId = graphNodeId(node, index);
		const entityPath = entityNotePath(entityId);
		if (entityPaths.has(entityPath)) continue;
		entityPaths.add(entityPath);
		entries.push([entityPath, [
			`# Entity: ${entityId}`,
			"",
			`Address: ${String(node["address"] ?? entityId)}`,
			`Roles: ${Array.isArray(node["roles"]) ? node["roles"].map(String).join(", ") || "none" : "none"}`,
			`Node type: ${String(node["node_type"] ?? "unknown")}`,
			"",
			"## Graph Links",
			"",
			"- [[Graph.canvas]]",
			""
		].join("\n")]);
	}
	const files = await writeFiles(outputRoot, entries);
	const exportedAt = (/* @__PURE__ */ new Date()).toISOString();
	const manifest = CaseExportManifestSchema.parse({
		schema: "chain-insights.case_export.v1",
		case_id: caseInfo.id,
		case_name: redactor.text(caseInfo.name),
		exported_at: exportedAt,
		mode: options.mode,
		target: options.target,
		source_workspace: workspace.root,
		verification: {
			evidence_manifest_verified: evidenceVerification.ok,
			verified_at: exportedAt,
			evidence_count: evidenceVerification.count
		},
		files,
		redactions: redactor.redactions(),
		warnings: evidenceVerification.ok ? [] : [`Evidence manifest failed: ${(evidenceVerification.tampered ?? []).join(", ")}`]
	});
	const manifestFile = await writePrivateFile(outputRoot, "manifest.chain-insights.json", JSON.stringify(manifest, null, 2) + "\n");
	return {
		manifestPath: path.join(outputRoot, manifestFile.path),
		outputDir: outputRoot,
		fileCount: files.length + 1,
		warnings: manifest.warnings,
		nextFile: "Agent Console.md"
	};
}
//#endregion
export { exportCase };

//# sourceMappingURL=export-BqTCO9lP.mjs.map