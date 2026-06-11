import { t as __exportAll } from "./rolldown-runtime-D7D4PA-g.mjs";
import { n as workspaceOutputPaths } from "./output-root-BK4pdjyz.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
//#region src/viz/html-generator.ts
var html_generator_exports = /* @__PURE__ */ __exportAll({
	generateHtml: () => generateHtml,
	generateInlineGraphHtml: () => generateInlineGraphHtml,
	transformToGraphHtml: () => transformToGraphHtml,
	writeVizHtml: () => writeVizHtml
});
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const template = readFileSync(path.resolve(__dirname, "templates", "graph.html"), "utf-8");
const ENTITY_TO_ROLE = {
	eoa: "search",
	contract: "intermediary",
	exchange: "exchange",
	mixer: "intermediary",
	unknown: null
};
function transformToGraphHtml(data) {
	return {
		nodes: data.nodes.map((n) => ({
			address: n.id,
			node_kind: n.entityType === "exchange" ? "exchange" : "wallet",
			labels: n.label ? [n.label] : [],
			flow_in_usd: n.totalIn,
			flow_out_usd: n.totalOut,
			role: ENTITY_TO_ROLE[n.entityType] ?? null,
			risk_level: n.riskLevel === "unknown" ? null : n.riskLevel,
			pattern_flags: []
		})),
		edges: data.edges.map((e) => ({
			source: e.source,
			target: e.target,
			usd_amount: e.value,
			tx_count: 1,
			edge_type: "flows_to"
		})),
		metadata: { title: data.metadata.title }
	};
}
function generateHtml(data, _title) {
	return generateInlineGraphHtml(transformToGraphHtml(data));
}
function generateInlineGraphHtml(data) {
	const inlineScript = `<script>var INLINE_DATA = ${JSON.stringify(data).replaceAll("<\/script>", "<\\/script>")};<\/script>`;
	return template.replace("</body>", `${inlineScript}\n</body>`);
}
function sanitizePathSegment(segment) {
	if (/[/\\]|^\.\.?$/.test(segment)) throw new Error(`Invalid path segment: ${segment}`);
	return segment;
}
async function writeVizHtml(vizId, html) {
	const paths = workspaceOutputPaths();
	const vizDir = path.join(paths.publishedRoot, "viz");
	sanitizePathSegment(vizId);
	await mkdir(vizDir, { recursive: true });
	const filePath = path.join(vizDir, `${vizId}.html`);
	await writeFile(filePath, html, { mode: 384 });
	return filePath;
}
//#endregion
export { html_generator_exports as n, writeVizHtml as r, generateHtml as t };

//# sourceMappingURL=html-generator-DjWagEB5.mjs.map