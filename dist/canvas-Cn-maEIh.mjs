import path from "node:path";
import { lstat, mkdir, writeFile } from "node:fs/promises";
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
export { CaseExportOptionsSchema as a, writePrivateFile as c, CaseExportManifestSchema as i, graphNodeId as n, safeFilename as o, graphToCanvas as r, safeSlug as s, entityNotePath as t };

//# sourceMappingURL=canvas-Cn-maEIh.mjs.map