const require_chunk = require("./chunk-CZWwpsFl.cjs");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_fs_promises = require("node:fs/promises");
let zod = require("zod");
zod = require_chunk.__toESM(zod, 1);
let node_crypto = require("node:crypto");
//#region src/mcp/artifacts.ts
const GraphArtifactInputSchema = zod.object({
	schema: zod.literal("chain-insights.graph.v1"),
	nodes: zod.array(zod.unknown()),
	edges: zod.array(zod.unknown()),
	flows: zod.array(zod.unknown()),
	edge_anchors: zod.array(zod.unknown())
});
function graphPayloadSchema(graphData) {
	return typeof graphData === "object" && graphData !== null && "schema" in graphData ? String(graphData.schema) : "unknown";
}
async function ensurePrivateDirectory(dir) {
	await (0, node_fs_promises.mkdir)(dir, {
		recursive: true,
		mode: 448
	});
	await (0, node_fs_promises.chmod)(dir, 448);
}
async function writeGraphArtifact(graphData, config) {
	const parsed = GraphArtifactInputSchema.safeParse(graphData);
	if (!parsed.success) {
		const schema = graphPayloadSchema(graphData);
		if (schema !== "chain-insights.graph.v1") throw new Error(`Unsupported graph payload schema: ${schema}`);
		throw new Error("Invalid graph payload: nodes, edges, flows, and edge_anchors must be arrays");
	}
	const id = (0, node_crypto.randomUUID)();
	const artifactDir = node_path.default.join(config.dataDir, "artifacts", id);
	const filePath = node_path.default.join(artifactDir, "graph.json");
	await ensurePrivateDirectory(config.dataDir);
	await ensurePrivateDirectory(node_path.default.join(config.dataDir, "artifacts"));
	await ensurePrivateDirectory(artifactDir);
	await (0, node_fs_promises.writeFile)(filePath, JSON.stringify(parsed.data, null, 2) + "\n", { mode: 384 });
	return {
		schema: parsed.data.schema,
		id,
		path: filePath,
		url: `http://127.0.0.1:${config.serverPort}/artifacts/${id}/graph.json`
	};
}
//#endregion
exports.writeGraphArtifact = writeGraphArtifact;
