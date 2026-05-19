import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import { t as parseFrontmatter } from "./frontmatter-D8wWCeOa.mjs";
import { t as activeCasesRoot } from "./active-BSrxLKwn.mjs";
import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
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
		caseId: z.string().optional(),
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
var data_extractor_exports = /* @__PURE__ */ __exportAll({
	extractGraphFromCase: () => extractGraphFromCase,
	extractGraphFromJson: () => extractGraphFromJson,
	parseEvidenceJson: () => parseEvidenceJson
});
function caseDir(caseId) {
	if (/[/\\]|^\.\.?$/.test(caseId)) throw new Error(`Invalid case ID: ${caseId}`);
	return path.join(activeCasesRoot(), caseId);
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
	if (results.length > 0) return results;
	const rawJson = extractEmbeddedJson(markdown);
	if (rawJson) try {
		const parsed = JSON.parse(rawJson);
		if (Array.isArray(parsed)) return parsed;
		if (parsed !== null && typeof parsed === "object") return [parsed];
	} catch {}
	return results;
}
function extractEmbeddedJson(text) {
	const trimmed = text.trim();
	const start = [...trimmed].map((char, index) => char === "{" || char === "[" ? index : -1).find((index) => index >= 0);
	if (start === void 0) return null;
	return trimmed.slice(start);
}
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
	const evidenceDir = path.join(caseDir(caseId), "evidence");
	let files = [];
	try {
		files = (await readdir(evidenceDir)).filter((f) => f.endsWith(".md"));
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
		const { body } = parseFrontmatter(await readFile(path.join(evidenceDir, file), "utf-8"));
		const items = parseEvidenceJson(body);
		if (items.length === 0) continue;
		const graphDataItems = items.filter((item) => isGraphDataLike(item));
		const simpleTxItems = items.flatMap((item) => {
			if (isSimpleTx(item)) return [item];
			return compactEvidenceToSimpleTxs(item);
		});
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
		const { DossierStore } = await import("./cases-By7INiOa.mjs");
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
export { truncateGraph as n, data_extractor_exports as t };

//# sourceMappingURL=data-extractor-DFzsa5CS.mjs.map