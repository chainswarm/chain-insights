const require_chunk = require("./chunk-CZWwpsFl.cjs");
const require_data_extractor = require("./data-extractor-y-p_N4Qq.cjs");
let node_fs = require("node:fs");
let node_url = require("node:url");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_fs_promises = require("node:fs/promises");
let node_os = require("node:os");
node_os = require_chunk.__toESM(node_os, 1);
//#region src/viz/html-generator.ts
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
			address_type: n.entityType === "exchange" ? "exchange" : "wallet",
			labels: n.label ? [n.label] : [],
			flow_in_usd: n.totalIn,
			flow_out_usd: n.totalOut,
			role: ENTITY_TO_ROLE[n.entityType] ?? null,
			risk_level: n.riskLevel === "unknown" ? null : n.riskLevel,
			pattern_flags: []
		})),
		edges: data.edges.map((e) => ({
			from_address: e.source,
			to_address: e.target,
			usd_amount: e.value,
			tx_count: 1,
			type: "FLOWS_TO"
		})),
		metadata: { title: data.metadata.title }
	};
}
function generateHtml(data, _title) {
	const graphHtmlData = transformToGraphHtml(data);
	const inlineScript = `<script>var INLINE_DATA = ${JSON.stringify(graphHtmlData).replaceAll("<\/script>", "<\\/script>")};<\/script>`;
	return template.replace("</body>", `${inlineScript}\n</body>`);
}
function sanitizePathSegment(segment) {
	if (/[/\\]|^\.\.?$/.test(segment)) throw new Error(`Invalid path segment: ${segment}`);
	return segment;
}
async function writeVizHtml(vizId, html, caseId) {
	let vizDir;
	if (caseId) vizDir = node_path.default.join(node_os.default.homedir(), ".chain-insights", "cases", sanitizePathSegment(caseId), "viz");
	else vizDir = node_path.default.join(node_os.default.homedir(), ".chain-insights", "viz");
	await (0, node_fs_promises.mkdir)(vizDir, { recursive: true });
	const filePath = node_path.default.join(vizDir, `${vizId}.html`);
	await (0, node_fs_promises.writeFile)(filePath, html, { mode: 384 });
	return filePath;
}
//#endregion
//#region src/viz/index.ts
var viz_exports = /* @__PURE__ */ require_chunk.__exportAll({ generateVisualization: () => generateVisualization });
async function generateVisualization(opts) {
	let rawData;
	if (opts.dataFile) {
		const content = await (0, node_fs_promises.readFile)(opts.dataFile, "utf-8");
		let parsed;
		try {
			parsed = JSON.parse(content);
		} catch {
			throw new Error("Invalid transaction data. The input file must contain a JSON array of transaction objects with `from`, `to`, and `value` fields.");
		}
		const { extractGraphFromJson } = await Promise.resolve().then(() => require("./data-extractor-y-p_N4Qq.cjs")).then((n) => n.data_extractor_exports);
		rawData = extractGraphFromJson(parsed);
	} else if (opts.caseId) {
		const { extractGraphFromCase } = await Promise.resolve().then(() => require("./data-extractor-y-p_N4Qq.cjs")).then((n) => n.data_extractor_exports);
		const extracted = await extractGraphFromCase(opts.caseId);
		if (extracted.nodes.length === 0) throw new Error("No Transaction Data. This case has no evidence with transaction data. Add evidence using `chain-insights evidence add` or provide a JSON file with `chain-insights viz --data <file.json>`.");
		rawData = extracted;
	} else throw new Error("Provide either a case ID or --data <file.json>");
	const data = require_data_extractor.truncateGraph(rawData);
	const vizId = opts.caseId ? `${opts.caseId}_${Date.now()}` : `adhoc_${Date.now()}`;
	return {
		vizId,
		htmlPath: await writeVizHtml(vizId, generateHtml(data, data.metadata.caseId ? `${data.metadata.caseId} - Money Flow` : "Ad-hoc Visualization"), opts.caseId)
	};
}
//#endregion
Object.defineProperty(exports, "generateVisualization", {
	enumerable: true,
	get: function() {
		return generateVisualization;
	}
});
Object.defineProperty(exports, "viz_exports", {
	enumerable: true,
	get: function() {
		return viz_exports;
	}
});
