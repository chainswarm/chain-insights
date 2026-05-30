const require_chunk = require("./chunk-DakpK96I.cjs");
const require_data_extractor = require("./data-extractor-DS4rzy3M.cjs");
const require_html_generator = require("./html-generator-Bx3UcLTB.cjs");
let node_fs_promises = require("node:fs/promises");
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
		const { extractGraphFromJson } = await Promise.resolve().then(() => require("./data-extractor-DS4rzy3M.cjs")).then((n) => n.data_extractor_exports);
		rawData = extractGraphFromJson(parsed);
	} else if (opts.caseId) {
		const { extractGraphFromCase } = await Promise.resolve().then(() => require("./data-extractor-DS4rzy3M.cjs")).then((n) => n.data_extractor_exports);
		const extracted = await extractGraphFromCase(opts.caseId);
		if (extracted.nodes.length === 0) throw new Error("No Transaction Data. This case has no evidence with transaction data. Add evidence using `chain-insights evidence add` or provide a JSON file with `chain-insights viz --data <file.json>`.");
		rawData = extracted;
	} else throw new Error("Provide either a case ID or --data <file.json>");
	const data = require_data_extractor.truncateGraph(rawData);
	const vizId = opts.caseId ? `${opts.caseId}_${Date.now()}` : `adhoc_${Date.now()}`;
	return {
		vizId,
		htmlPath: await require_html_generator.writeVizHtml(vizId, require_html_generator.generateHtml(data, data.metadata.caseId ? `${data.metadata.caseId} - Money Flow` : "Ad-hoc Visualization"), opts.caseId)
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
