const require_chunk = require("./chunk-CZWwpsFl.cjs");
const require_frontmatter = require("./frontmatter-Birh_UJU.cjs");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_fs_promises = require("node:fs/promises");
let node_os = require("node:os");
node_os = require_chunk.__toESM(node_os, 1);
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
		caseId: zod.string().optional(),
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
var data_extractor_exports = /* @__PURE__ */ require_chunk.__exportAll({
	extractGraphFromCase: () => extractGraphFromCase,
	extractGraphFromJson: () => extractGraphFromJson,
	parseEvidenceJson: () => parseEvidenceJson
});
function caseDir(caseId) {
	if (/[/\\]|^\.\.?$/.test(caseId)) throw new Error(`Invalid case ID: ${caseId}`);
	return node_path.default.join(node_os.default.homedir(), ".chain-insights", "cases", caseId);
}
/**
* Extracts all items from ```json code blocks in a markdown string.
* If the parsed value is an array, spreads all items.
* If the parsed value has 'nodes' and 'edges', wraps it as a single item.
* Returns empty array if no JSON blocks found or parsing fails.
*/
function parseEvidenceJson(markdown) {
	const results = [];
	const re = /```json\s*\n([\s\S]*?)```/g;
	let match;
	while ((match = re.exec(markdown)) !== null) {
		const raw = match[1];
		if (!raw) continue;
		try {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) results.push(...parsed);
			else if (parsed !== null && typeof parsed === "object" && "nodes" in parsed && "edges" in parsed) results.push(parsed);
		} catch {}
	}
	return results;
}
function isSimpleTx(item) {
	return item !== null && typeof item === "object" && "from" in item && "to" in item && "value" in item;
}
function isGraphDataLike(input) {
	return input !== null && typeof input === "object" && Array.isArray(input["nodes"]) && Array.isArray(input["edges"]);
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
/**
* Merges two sets of nodes, deduplicating by id.
* For duplicate nodes, sums totalIn, totalOut, txCount; keeps earliest firstSeen, latest lastSeen.
*/
function mergeNodes(existing, incoming) {
	const map = /* @__PURE__ */ new Map();
	for (const node of existing) map.set(node.id, { ...node });
	for (const node of incoming) {
		const prev = map.get(node.id);
		if (prev) map.set(node.id, {
			...prev,
			totalIn: prev.totalIn + node.totalIn,
			totalOut: prev.totalOut + node.totalOut,
			txCount: prev.txCount + node.txCount,
			firstSeen: pickEarlier(prev.firstSeen, node.firstSeen),
			lastSeen: pickLater(prev.lastSeen, node.lastSeen)
		});
		else map.set(node.id, { ...node });
	}
	return [...map.values()];
}
function pickEarlier(a, b) {
	if (!a) return b;
	if (!b) return a;
	return a < b ? a : b;
}
function pickLater(a, b) {
	if (!a) return b;
	if (!b) return a;
	return a > b ? a : b;
}
/**
* Aggregates edges: for duplicate (source, target) pairs, sums value; keeps last txHash/timestamp.
*/
function aggregateEdges(edges) {
	const map = /* @__PURE__ */ new Map();
	for (const edge of edges) {
		const key = `${edge.source}::${edge.target}`;
		const prev = map.get(key);
		if (prev) map.set(key, {
			...edge,
			value: prev.value + edge.value
		});
		else map.set(key, { ...edge });
	}
	return [...map.values()];
}
/**
* Reads evidence files from a case directory, extracts JSON transaction data
* from markdown code blocks, enriches nodes with entity types from dossiers,
* and returns a merged GraphData.
*/
async function extractGraphFromCase(caseId) {
	const evidenceDir = node_path.default.join(caseDir(caseId), "evidence");
	let files = [];
	try {
		files = (await (0, node_fs_promises.readdir)(evidenceDir)).filter((f) => f.endsWith(".md"));
	} catch {
		return GraphData.parse({
			nodes: [],
			edges: [],
			metadata: {
				caseId,
				title: `${caseId} - Money Flow`,
				generatedAt: (/* @__PURE__ */ new Date()).toISOString()
			}
		});
	}
	let allNodes = [];
	let allEdges = [];
	for (const file of files) {
		const { body } = require_frontmatter.parseFrontmatter(await (0, node_fs_promises.readFile)(node_path.default.join(evidenceDir, file), "utf-8"));
		const items = parseEvidenceJson(body);
		if (items.length === 0) continue;
		const graphDataItems = items.filter((item) => isGraphDataLike(item));
		const simpleTxItems = items.filter((item) => isSimpleTx(item));
		if (graphDataItems.length > 0) {
			for (const gd of graphDataItems) try {
				const parsed = GraphData.parse(gd);
				allNodes = mergeNodes(allNodes, parsed.nodes);
				allEdges = [...allEdges, ...parsed.edges];
			} catch {}
			if (simpleTxItems.length > 0) {
				const { nodes, edges } = buildGraphFromSimpleTxs(simpleTxItems);
				allNodes = mergeNodes(allNodes, nodes);
				allEdges = [...allEdges, ...edges];
			}
		} else if (simpleTxItems.length > 0) {
			const { nodes, edges } = buildGraphFromSimpleTxs(simpleTxItems);
			allNodes = mergeNodes(allNodes, nodes);
			allEdges = [...allEdges, ...edges];
		}
	}
	allEdges = aggregateEdges(allEdges);
	try {
		const { DossierStore } = await Promise.resolve().then(() => require("./cases-DCuVrubr.cjs"));
		const dossiers = await DossierStore.listSummaries(caseId);
		const dossierMap = /* @__PURE__ */ new Map();
		for (const d of dossiers) dossierMap.set(d.address, d.type);
		allNodes = allNodes.map((node) => {
			const dossierType = dossierMap.get(node.id);
			if (dossierType && dossierType !== "unknown") {
				const entityType = [
					"eoa",
					"contract",
					"exchange",
					"mixer",
					"unknown"
				].includes(dossierType) ? dossierType : "unknown";
				return {
					...node,
					entityType
				};
			}
			return node;
		});
	} catch {}
	return GraphData.parse({
		nodes: allNodes,
		edges: allEdges,
		metadata: {
			caseId,
			title: `${caseId} - Money Flow`,
			generatedAt: (/* @__PURE__ */ new Date()).toISOString()
		}
	});
}
//#endregion
Object.defineProperty(exports, "data_extractor_exports", {
	enumerable: true,
	get: function() {
		return data_extractor_exports;
	}
});
Object.defineProperty(exports, "truncateGraph", {
	enumerable: true,
	get: function() {
		return truncateGraph;
	}
});
