const require_chunk = require("./chunk-DakpK96I.cjs");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_fs_promises = require("node:fs/promises");
let zod = require("zod");
zod = require_chunk.__toESM(zod, 1);
let node_crypto = require("node:crypto");
//#region src/export/paths.ts
function safeSlug(value) {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "case-export";
}
function safeFilename(value) {
	const parsed = node_path.default.parse(value);
	return `${safeSlug(parsed.name)}${parsed.ext.toLowerCase().replace(/[^.a-z0-9]/g, "") || ".md"}`;
}
function assertInsideDirectory(root, candidate) {
	const resolvedRoot = node_path.default.resolve(root);
	const resolvedCandidate = node_path.default.resolve(candidate);
	const relative = node_path.default.relative(resolvedRoot, resolvedCandidate);
	if (relative === "" || !relative.startsWith("..") && !node_path.default.isAbsolute(relative)) return;
	throw new Error(`Refusing to write outside export directory: ${candidate}`);
}
async function assertNoSymlink(filePath) {
	try {
		if ((await (0, node_fs_promises.lstat)(filePath)).isSymbolicLink()) throw new Error(`Refusing to write through symlink: ${filePath}`);
	} catch (err) {
		if (err.code === "ENOENT") return;
		throw err;
	}
}
async function writePrivateFile(root, relativePath, content) {
	const filePath = node_path.default.join(root, relativePath);
	assertInsideDirectory(root, filePath);
	await (0, node_fs_promises.mkdir)(node_path.default.dirname(filePath), {
		recursive: true,
		mode: 448
	});
	await assertNoSymlink(filePath);
	await (0, node_fs_promises.writeFile)(filePath, content, { mode: 384 });
	const bytes = Buffer.byteLength(content, "utf8");
	return {
		path: relativePath,
		sha256: (0, node_crypto.createHash)("sha256").update(content).digest("hex"),
		bytes
	};
}
//#endregion
//#region src/export/schema.ts
const CaseExportTargetSchema = zod.enum(["obsidian-llmwiki"]);
const CaseExportModeSchema = zod.enum([
	"private",
	"partner",
	"public"
]);
const caseIdRegex = /^\d{8}_\d{3}_[a-z0-9][a-z0-9-]*$/;
const CaseExportOptionsSchema = zod.object({
	caseId: zod.string().regex(caseIdRegex),
	target: CaseExportTargetSchema.default("obsidian-llmwiki"),
	mode: CaseExportModeSchema.default("private"),
	outputDir: zod.string().optional()
});
const ExportedFileSchema = zod.object({
	path: zod.string().min(1),
	sha256: zod.string().regex(/^[a-f0-9]{64}$/),
	bytes: zod.number().int().nonnegative()
});
const CaseExportManifestSchema = zod.object({
	schema: zod.literal("chain-insights.case_export.v1"),
	case_id: zod.string().regex(caseIdRegex),
	case_name: zod.string().min(1),
	exported_at: zod.string().datetime(),
	mode: CaseExportModeSchema,
	target: CaseExportTargetSchema,
	source_workspace: zod.string().min(1),
	verification: zod.object({
		evidence_manifest_verified: zod.boolean(),
		verified_at: zod.string().datetime(),
		evidence_count: zod.number().int().nonnegative()
	}),
	files: zod.array(ExportedFileSchema),
	redactions: zod.array(zod.string()),
	warnings: zod.array(zod.string())
});
const JsonCanvasNodeSchema = zod.object({
	id: zod.string().min(1),
	type: zod.enum([
		"text",
		"file",
		"link",
		"group"
	]),
	x: zod.number(),
	y: zod.number(),
	width: zod.number().positive(),
	height: zod.number().positive(),
	text: zod.string().optional(),
	file: zod.string().optional(),
	url: zod.string().optional(),
	label: zod.string().optional(),
	color: zod.string().optional()
});
const JsonCanvasEdgeSchema = zod.object({
	id: zod.string().min(1),
	fromNode: zod.string().min(1),
	toNode: zod.string().min(1),
	fromSide: zod.enum([
		"top",
		"right",
		"bottom",
		"left"
	]).optional(),
	toSide: zod.enum([
		"top",
		"right",
		"bottom",
		"left"
	]).optional(),
	toEnd: zod.enum(["none", "arrow"]).optional(),
	label: zod.string().optional(),
	color: zod.string().optional()
});
const JsonCanvasSchema = zod.object({
	nodes: zod.array(JsonCanvasNodeSchema),
	edges: zod.array(JsonCanvasEdgeSchema)
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
Object.defineProperty(exports, "CaseExportManifestSchema", {
	enumerable: true,
	get: function() {
		return CaseExportManifestSchema;
	}
});
Object.defineProperty(exports, "CaseExportOptionsSchema", {
	enumerable: true,
	get: function() {
		return CaseExportOptionsSchema;
	}
});
Object.defineProperty(exports, "entityNotePath", {
	enumerable: true,
	get: function() {
		return entityNotePath;
	}
});
Object.defineProperty(exports, "graphNodeId", {
	enumerable: true,
	get: function() {
		return graphNodeId;
	}
});
Object.defineProperty(exports, "graphToCanvas", {
	enumerable: true,
	get: function() {
		return graphToCanvas;
	}
});
Object.defineProperty(exports, "safeFilename", {
	enumerable: true,
	get: function() {
		return safeFilename;
	}
});
Object.defineProperty(exports, "safeSlug", {
	enumerable: true,
	get: function() {
		return safeSlug;
	}
});
Object.defineProperty(exports, "writePrivateFile", {
	enumerable: true,
	get: function() {
		return writePrivateFile;
	}
});
