const require_chunk = require("./chunk-CZWwpsFl.cjs");
const require_output_root = require("./output-root-qSCyj2Tl.cjs");
let node_url = require("node:url");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_fs = require("node:fs");
let node_fs_promises = require("node:fs/promises");
//#region src/viz/html-generator.ts
var html_generator_exports = /* @__PURE__ */ require_chunk.__exportAll({
	generateHtml: () => generateHtml,
	generateInlineGraphHtml: () => generateInlineGraphHtml,
	transformToGraphHtml: () => transformToGraphHtml,
	writeVizHtml: () => writeVizHtml
});
const __dirname$1 = node_path.default.dirname((0, node_url.fileURLToPath)(require("url").pathToFileURL(__filename).href));
const template = (0, node_fs.readFileSync)(node_path.default.resolve(__dirname$1, "templates", "graph.html"), "utf-8");
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
	const paths = require_output_root.workspaceOutputPaths();
	const vizDir = node_path.default.join(paths.publishedRoot, "viz");
	sanitizePathSegment(vizId);
	await (0, node_fs_promises.mkdir)(vizDir, { recursive: true });
	const filePath = node_path.default.join(vizDir, `${vizId}.html`);
	await (0, node_fs_promises.writeFile)(filePath, html, { mode: 384 });
	return filePath;
}
//#endregion
Object.defineProperty(exports, "generateHtml", {
	enumerable: true,
	get: function() {
		return generateHtml;
	}
});
Object.defineProperty(exports, "html_generator_exports", {
	enumerable: true,
	get: function() {
		return html_generator_exports;
	}
});
Object.defineProperty(exports, "writeVizHtml", {
	enumerable: true,
	get: function() {
		return writeVizHtml;
	}
});
