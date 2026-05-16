import { n as workspaceOutputPaths } from "./output-root-DWVOkjAR.mjs";
import { t as normalizeGraphPayload } from "./graph-normalizer-P1QS2eOC.mjs";
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
	if (!GraphArtifactInputSchema.safeParse(graphData).success) {
		const schema = graphPayloadSchema(graphData);
		if (schema !== "chain-insights.graph.v1") throw new Error(`Unsupported graph payload schema: ${schema}`);
		throw new Error("Invalid graph payload: nodes, edges, flows, and edge_anchors must be arrays");
	}
	const normalized = normalizeGraphPayload(graphData);
	const id = randomUUID();
	const paths = workspaceOutputPaths();
	const artifactDir = path.join(paths.artifactsRoot, id);
	const filePath = path.join(artifactDir, "graph.json");
	await ensurePrivateDirectory(paths.artifactsRoot);
	await ensurePrivateDirectory(artifactDir);
	await writeFile(filePath, JSON.stringify(normalized, null, 2) + "\n", { mode: 384 });
	return {
		schema: normalized.schema,
		id,
		path: filePath,
		url: `http://127.0.0.1:${config.serverPort}/artifacts/${id}/graph.json`
	};
}
//#endregion
export { writeGraphArtifact };

//# sourceMappingURL=artifacts-im5bHRkf.mjs.map