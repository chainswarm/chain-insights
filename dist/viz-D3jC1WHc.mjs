import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import { n as truncateGraph } from "./data-extractor-_bW-ndIi.mjs";
import { r as writeVizHtml, t as generateHtml } from "./html-generator-DazwHVyW.mjs";
import { readFile } from "node:fs/promises";
//#region src/viz/index.ts
var viz_exports = /* @__PURE__ */ __exportAll({ generateVisualization: () => generateVisualization });
async function generateVisualization(opts) {
	let rawData;
	if (opts.dataFile) {
		const content = await readFile(opts.dataFile, "utf-8");
		let parsed;
		try {
			parsed = JSON.parse(content);
		} catch {
			throw new Error("Invalid transaction data. The input file must contain a JSON array of transaction objects with `from`, `to`, and `value` fields.");
		}
		const { extractGraphFromJson } = await import("./data-extractor-_bW-ndIi.mjs").then((n) => n.t);
		rawData = extractGraphFromJson(parsed);
	} else if (opts.caseId) {
		const { extractGraphFromCase } = await import("./data-extractor-_bW-ndIi.mjs").then((n) => n.t);
		const extracted = await extractGraphFromCase(opts.caseId);
		if (extracted.nodes.length === 0) throw new Error("No Transaction Data. This case has no evidence with transaction data. Add evidence using `chain-insights evidence add` or provide a JSON file with `chain-insights viz --data <file.json>`.");
		rawData = extracted;
	} else throw new Error("Provide either a case ID or --data <file.json>");
	const data = truncateGraph(rawData);
	const vizId = opts.caseId ? `${opts.caseId}_${Date.now()}` : `adhoc_${Date.now()}`;
	return {
		vizId,
		htmlPath: await writeVizHtml(vizId, generateHtml(data, data.metadata.caseId ? `${data.metadata.caseId} - Money Flow` : "Ad-hoc Visualization"), opts.caseId)
	};
}
//#endregion
export { viz_exports as n, generateVisualization as t };

//# sourceMappingURL=viz-D3jC1WHc.mjs.map