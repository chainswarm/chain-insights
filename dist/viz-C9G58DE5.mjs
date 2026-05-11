import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import { n as truncateGraph } from "./data-extractor-CA4hyiEt.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
//#region src/viz/html-generator.ts
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
	if (caseId) vizDir = path.join(os.homedir(), ".chain-insights", "cases", sanitizePathSegment(caseId), "viz");
	else vizDir = path.join(os.homedir(), ".chain-insights", "viz");
	await mkdir(vizDir, { recursive: true });
	const filePath = path.join(vizDir, `${vizId}.html`);
	await writeFile(filePath, html, { mode: 384 });
	return filePath;
}
//#endregion
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
		const { extractGraphFromJson } = await import("./data-extractor-CA4hyiEt.mjs").then((n) => n.t);
		rawData = extractGraphFromJson(parsed);
	} else if (opts.caseId) {
		const { extractGraphFromCase } = await import("./data-extractor-CA4hyiEt.mjs").then((n) => n.t);
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

//# sourceMappingURL=viz-C9G58DE5.mjs.map