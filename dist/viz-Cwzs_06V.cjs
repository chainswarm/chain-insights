const require_chunk = require("./chunk-CZWwpsFl.cjs");
const require_output_root = require("./output-root-qSCyj2Tl.cjs");
const require_html_generator = require("./html-generator-DeTV9DFI.cjs");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_fs_promises = require("node:fs/promises");
let zod = require("zod");
zod = require_chunk.__toESM(zod, 1);
//#region src/viz/graph-model.ts
const EntityType = zod.enum([
	"eoa",
	"contract",
	"exchange",
	"mixer",
	"unknown"
]);
const RiskLevel = zod.enum([
	"low",
	"medium",
	"high",
	"critical",
	"unknown"
]);
const GraphNode = zod.object({
	id: zod.string().min(1),
	label: zod.string().optional(),
	entityType: EntityType.default("unknown"),
	riskLevel: RiskLevel.default("unknown"),
	totalIn: zod.number().default(0),
	totalOut: zod.number().default(0),
	txCount: zod.number().int().default(0),
	firstSeen: zod.string().optional(),
	lastSeen: zod.string().optional()
});
const GraphEdge = zod.object({
	source: zod.string().min(1),
	target: zod.string().min(1),
	value: zod.number(),
	txHash: zod.string().optional(),
	blockNumber: zod.number().int().optional(),
	timestamp: zod.string().optional()
});
const GraphData = zod.object({
	nodes: zod.array(GraphNode),
	edges: zod.array(GraphEdge),
	metadata: zod.object({
		title: zod.string().default("Money Flow"),
		generatedAt: zod.string(),
		truncated: zod.boolean().default(false),
		totalNodes: zod.number().int().optional(),
		hiddenNodes: zod.number().int().optional()
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
	return compact.outgoing_flows.filter((flow) => typeof flow.src === "string" && typeof flow.dst === "string" && typeof flow.amount_usd_sum === "number").map((flow) => ({
		from: flow.src,
		to: flow.dst,
		value: flow.amount_usd_sum,
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
var viz_exports = /* @__PURE__ */ require_chunk.__exportAll({ generateVisualization: () => generateVisualization });
function sanitizeSourceId(sourceId) {
	if (!/^[A-Za-z0-9._-]+$/.test(sourceId) || sourceId.includes("..")) throw new Error(`Invalid visualization source ID: ${sourceId}`);
	return sourceId;
}
async function generateVisualization(opts) {
	let rawData;
	let vizId;
	let title;
	if (opts.dataFile) {
		const content = await (0, node_fs_promises.readFile)(opts.dataFile, "utf-8");
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
		const paths = require_output_root.workspaceOutputPaths();
		const content = await (0, node_fs_promises.readFile)(node_path.default.join(paths.reportGraphsRoot, `${sourceId}.graph.json`), "utf-8");
		rawData = JSON.parse(content);
		vizId = sourceId;
		title = `${sourceId} - Workspace Graph`;
	} else throw new Error("Provide either a visualization source ID or --data <file.json>");
	const html = require_html_generator.generateHtml(truncateGraph(rawData), title);
	const htmlPath = await require_html_generator.writeVizHtml(vizId, html);
	return {
		vizId,
		htmlPath
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
