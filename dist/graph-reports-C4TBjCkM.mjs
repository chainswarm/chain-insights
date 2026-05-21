import { n as workspaceOutputPaths } from "./output-root-CmWM7aV2.mjs";
import { t as normalizeGraphPayload } from "./graph-normalizer-Cv9yK9Pg.mjs";
import path from "node:path";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import * as z from "zod";
import { randomUUID } from "node:crypto";
//#region src/mcp/graph-reports.ts
const GraphReportInputSchema = z.object({
	schema: z.literal("chain-insights.graph.v1"),
	nodes: z.array(z.unknown()),
	edges: z.array(z.unknown()),
	flows: z.array(z.unknown()).optional(),
	edge_anchors: z.array(z.unknown()).optional()
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
	const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
	return `${timestampSegment()}-${sanitizeSlug(slug)}-${suffix}.graph.json`;
}
async function ensurePrivateDirectory(dir) {
	await mkdir(dir, {
		recursive: true,
		mode: 448
	});
	await chmod(dir, 448);
}
async function writeGraphReport(graphData, options) {
	const parsed = GraphReportInputSchema.safeParse(graphData);
	if (!parsed.success) {
		const schema = graphPayloadSchema(graphData);
		if (schema !== "chain-insights.graph.v1") throw new Error(`Unsupported graph payload schema: ${schema}`);
		throw new Error("Invalid graph payload: nodes and edges must be arrays; flows and edge_anchors must be arrays when present");
	}
	const normalized = normalizeGraphPayload({
		...parsed.data,
		flows: parsed.data.flows ?? [],
		edge_anchors: parsed.data.edge_anchors ?? []
	});
	const paths = workspaceOutputPaths();
	const filename = uniqueFilename(options.slug);
	const filePath = path.join(paths.reportGraphsRoot, filename);
	await ensurePrivateDirectory(paths.reportsRoot);
	await ensurePrivateDirectory(paths.reportGraphsRoot);
	await writeFile(filePath, JSON.stringify(normalized, null, 2) + "\n", { mode: 384 });
	return {
		schema: normalized.schema,
		filename,
		path: filePath,
		url: `http://127.0.0.1:${options.serverPort}/graph-reports/${filename}`
	};
}
//#endregion
export { writeGraphReport };

//# sourceMappingURL=graph-reports-C4TBjCkM.mjs.map