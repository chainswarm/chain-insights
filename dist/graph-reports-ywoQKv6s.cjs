const require_chunk = require("./chunk-CZWwpsFl.cjs");
const require_output_root = require("./output-root-DZV1UJDb.cjs");
const require_graph_normalizer = require("./graph-normalizer-DQMez9_7.cjs");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_fs_promises = require("node:fs/promises");
let zod = require("zod");
zod = require_chunk.__toESM(zod, 1);
let node_crypto = require("node:crypto");
//#region src/mcp/graph-reports.ts
const GraphReportInputSchema = zod.object({
	schema: zod.literal("chain-insights.graph.v1"),
	nodes: zod.array(zod.unknown()),
	edges: zod.array(zod.unknown()),
	flows: zod.array(zod.unknown()).optional(),
	edge_anchors: zod.array(zod.unknown()).optional()
}).passthrough();
function graphPayloadSchema(graphData) {
	return typeof graphData === "object" && graphData !== null && "schema" in graphData ? String(graphData.schema) : "unknown";
}
function sanitizeSlug(slug) {
	return slug.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[._-]+|[._-]+$/g, "") || "graph";
}
function timestampSegment(date = /* @__PURE__ */ new Date()) {
	return date.toISOString().replace(/[-:.]/g, "");
}
function uniqueFilename(slug) {
	const suffix = (0, node_crypto.randomUUID)().replace(/-/g, "").slice(0, 12);
	return `${timestampSegment()}-${sanitizeSlug(slug)}-${suffix}.graph.json`;
}
async function ensurePrivateDirectory(dir) {
	await (0, node_fs_promises.mkdir)(dir, {
		recursive: true,
		mode: 448
	});
	await (0, node_fs_promises.chmod)(dir, 448);
}
async function writeGraphReport(graphData, options) {
	const parsed = GraphReportInputSchema.safeParse(graphData);
	if (!parsed.success) {
		const schema = graphPayloadSchema(graphData);
		if (schema !== "chain-insights.graph.v1") throw new Error(`Unsupported graph payload schema: ${schema}`);
		throw new Error("Invalid graph payload: nodes and edges must be arrays; flows and edge_anchors must be arrays when present");
	}
	const normalized = require_graph_normalizer.normalizeGraphPayload({
		...parsed.data,
		flows: parsed.data.flows ?? [],
		edge_anchors: parsed.data.edge_anchors ?? []
	});
	const paths = require_output_root.workspaceOutputPaths();
	const filename = uniqueFilename(options.slug);
	const filePath = node_path.default.join(paths.reportGraphsRoot, filename);
	await ensurePrivateDirectory(paths.reportsRoot);
	await ensurePrivateDirectory(paths.reportGraphsRoot);
	await (0, node_fs_promises.writeFile)(filePath, JSON.stringify(normalized, null, 2) + "\n", { mode: 384 });
	return {
		schema: normalized.schema,
		filename,
		path: filePath,
		url: `http://127.0.0.1:${options.serverPort}/graph-reports/${filename}`
	};
}
//#endregion
exports.writeGraphReport = writeGraphReport;
