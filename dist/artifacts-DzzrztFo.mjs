import path from "node:path";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import * as z from "zod";
import { randomUUID } from "node:crypto";
//#region src/mcp/artifacts.ts
const GraphArtifactInputSchema = z.object({
	schema: z.literal("chain-insights.graph.v1"),
	nodes: z.array(z.unknown()),
	edges: z.array(z.unknown()),
	flows: z.array(z.unknown()),
	edge_anchors: z.array(z.unknown())
});
function graphPayloadSchema(graphData) {
	return typeof graphData === "object" && graphData !== null && "schema" in graphData ? String(graphData.schema) : "unknown";
}
async function ensurePrivateDirectory(dir) {
	await mkdir(dir, {
		recursive: true,
		mode: 448
	});
	await chmod(dir, 448);
}
async function writeGraphArtifact(graphData, config) {
	const parsed = GraphArtifactInputSchema.safeParse(graphData);
	if (!parsed.success) {
		const schema = graphPayloadSchema(graphData);
		if (schema !== "chain-insights.graph.v1") throw new Error(`Unsupported graph payload schema: ${schema}`);
		throw new Error("Invalid graph payload: nodes, edges, flows, and edge_anchors must be arrays");
	}
	const id = randomUUID();
	const artifactDir = path.join(config.dataDir, "artifacts", id);
	const filePath = path.join(artifactDir, "graph.json");
	await ensurePrivateDirectory(config.dataDir);
	await ensurePrivateDirectory(path.join(config.dataDir, "artifacts"));
	await ensurePrivateDirectory(artifactDir);
	await writeFile(filePath, JSON.stringify(parsed.data, null, 2) + "\n", { mode: 384 });
	return {
		schema: parsed.data.schema,
		id,
		path: filePath,
		url: `http://127.0.0.1:${config.serverPort}/artifacts/${id}/graph.json`
	};
}
//#endregion
export { writeGraphArtifact };

//# sourceMappingURL=artifacts-DzzrztFo.mjs.map