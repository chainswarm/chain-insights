import { t as __exportAll } from "./rolldown-runtime-D7D4PA-g.mjs";
import { n as workspaceOutputPaths } from "./output-root-BK4pdjyz.mjs";
import { r as writeVizHtml, t as generateHtml } from "./html-generator-D4fX71hI.mjs";
import path from "node:path";
import { readFile } from "node:fs/promises";
import * as z from "zod";
//#region src/viz/graph-model.ts
const EntityType = z.enum([
	"eoa",
	"contract",
	"exchange",
	"mixer",
	"unknown"
]);
const RiskLevel = z.enum([
	"low",
	"medium",
	"high",
	"critical",
	"unknown"
]);
const GraphNode = z.object({
	id: z.string().min(1),
	label: z.string().optional(),
	entityType: EntityType.default("unknown"),
	riskLevel: RiskLevel.default("unknown"),
	totalIn: z.number().default(0),
	totalOut: z.number().default(0),
	txCount: z.number().int().default(0),
	firstSeen: z.string().optional(),
	lastSeen: z.string().optional()
});
const GraphEdge = z.object({
	source: z.string().min(1),
	target: z.string().min(1),
	value: z.number(),
	txHash: z.string().optional(),
	blockNumber: z.number().int().optional(),
	timestamp: z.string().optional()
});
const GraphData = z.object({
	nodes: z.array(GraphNode),
	edges: z.array(GraphEdge),
	metadata: z.object({
		title: z.string().default("Money Flow"),
		generatedAt: z.string(),
		truncated: z.boolean().default(false),
		totalNodes: z.number().int().optional(),
		hiddenNodes: z.number().int().optional()
	})
});
const MAX_NODES = 100;
function truncateGraph(data) {
	if (data.nodes.length <= MAX_NODES) return data;
	const kept = [...data.nodes].sort((a, b) => b.totalIn + b.totalOut - (a.totalIn + a.totalOut)).slice(0, MAX_NODES);
	const keptIds = new Set(kept.map((n) => n.id));
	return {
		nodes: kept,
		edges: data.edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target)),
		metadata: {
			...data.metadata,
			truncated: true,
			totalNodes: data.nodes.length,
			hiddenNodes: data.nodes.length - MAX_NODES
		}
	};
}
//#endregion
//#region src/viz/data-extractor.ts
function isSimpleTx(item) {
	return item !== null && typeof item === "object" && "from" in item && "to" in item && "value" in item;
}
function isGraphDataLike(input) {
	return input !== null && typeof input === "object" && Array.isArray(input["nodes"]) && Array.isArray(input["edges"]);
}
function compactEvidenceToSimpleTxs(item) {
	const compact = item;
	if (!compact || typeof compact !== "object" || compact.schema !== "chain-insights.compact_evidence.v1" || !Array.isArray(compact.outgoing_flows)) return [];
	return compact.outgoing_flows.filter((flow) => typeof flow.src === "string" && typeof flow.dst === "string" && typeof flow.amount_sum === "number").map((flow) => ({
		from: flow.src,
		to: flow.dst,
		value: flow.amount_sum,
		txHash: flow.first_tx_id
	}));
}
/**
* Converts simple [{from, to, value}] transaction arrays into graph nodes.
* Computes totalIn, totalOut, txCount per node from edges.
*/
function buildGraphFromSimpleTxs(items) {
	const edges = items.map((tx) => GraphEdge.parse({
		source: tx.from,
		target: tx.to,
		value: tx.value,
		txHash: tx.txHash,
		blockNumber: tx.blockNumber,
		timestamp: tx.timestamp
	}));
	const addresses = /* @__PURE__ */ new Set();
	for (const tx of items) {
		addresses.add(tx.from);
		addresses.add(tx.to);
	}
	const totals = {};
	for (const addr of addresses) totals[addr] = {
		totalIn: 0,
		totalOut: 0,
		txCount: 0
	};
	for (const tx of items) {
		const out = totals[tx.from];
		const inp = totals[tx.to];
		if (out) {
			out.totalOut += tx.value;
			out.txCount += 1;
		}
		if (inp) {
			inp.totalIn += tx.value;
			inp.txCount += 1;
		}
	}
	return {
		nodes: [...addresses].map((addr) => GraphNode.parse({
			id: addr,
			entityType: "unknown",
			riskLevel: "unknown",
			totalIn: totals[addr]?.totalIn ?? 0,
			totalOut: totals[addr]?.totalOut ?? 0,
			txCount: totals[addr]?.txCount ?? 0
		})),
		edges
	};
}
/**
* Handles two input formats:
* 1. Full GraphData object (has nodes + edges) — parse with Zod
* 2. Array of {from, to, value, ...} transaction objects — auto-derive nodes
*
* Throws "Invalid transaction data" for any other input.
*/
function extractGraphFromJson(input) {
	if (isGraphDataLike(input)) return GraphData.parse(input);
	if (Array.isArray(input)) {
		const simpleTxs = [];
		for (const item of input) if (isSimpleTx(item)) simpleTxs.push(item);
		else simpleTxs.push(...compactEvidenceToSimpleTxs(item));
		const { nodes, edges } = buildGraphFromSimpleTxs(simpleTxs);
		return GraphData.parse({
			nodes,
			edges,
			metadata: {
				title: "Money Flow",
				generatedAt: (/* @__PURE__ */ new Date()).toISOString()
			}
		});
	}
	throw new Error("Invalid transaction data. The input file must contain a JSON array of transaction objects with `from`, `to`, and `value` fields.");
}
//#endregion
//#region src/viz/index.ts
var viz_exports = /* @__PURE__ */ __exportAll({ generateVisualization: () => generateVisualization });
function sanitizeSourceId(sourceId) {
	if (!/^[A-Za-z0-9._-]+$/.test(sourceId) || sourceId.includes("..")) throw new Error(`Invalid visualization source ID: ${sourceId}`);
	return sourceId;
}
async function generateVisualization(opts) {
	let rawData;
	let vizId;
	let title;
	if (opts.dataFile) {
		const content = await readFile(opts.dataFile, "utf-8");
		let parsed;
		try {
			parsed = JSON.parse(content);
		} catch {
			throw new Error("Invalid transaction data. The input file must contain a JSON array of transaction objects with `from`, `to`, and `value` fields.");
		}
		rawData = extractGraphFromJson(parsed);
		vizId = `adhoc_${Date.now()}`;
		title = "Ad-hoc Visualization";
	} else if (opts.sourceId) {
		const sourceId = sanitizeSourceId(opts.sourceId);
		const paths = workspaceOutputPaths();
		const content = await readFile(path.join(paths.reportGraphsRoot, `${sourceId}.graph.json`), "utf-8");
		rawData = JSON.parse(content);
		vizId = sourceId;
		title = `${sourceId} - Workspace Graph`;
	} else throw new Error("Provide either a visualization source ID or --data <file.json>");
	const html = generateHtml(truncateGraph(rawData), title);
	const htmlPath = await writeVizHtml(vizId, html);
	return {
		vizId,
		htmlPath
	};
}
//#endregion
export { viz_exports as n, generateVisualization as t };

//# sourceMappingURL=viz-D8umSF-t.mjs.map