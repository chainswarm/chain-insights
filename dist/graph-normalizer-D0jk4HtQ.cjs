//#region src/viz/graph-normalizer.ts
const GENERIC_GRAPH_LABELS = new Set([
	"Address",
	"Exchange",
	"Miner",
	"Validator",
	"Hotkey",
	"Subnet",
	"IPAddress"
]);
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringArray(value) {
	return Array.isArray(value) ? value.map(String) : [];
}
function unique(values) {
	return [...new Set(values)];
}
function displayLabels(rawLabels, currentLabels) {
	return unique(currentLabels.length > 0 ? currentLabels : rawLabels).filter((label) => !GENERIC_GRAPH_LABELS.has(label));
}
function entityKind(rawLabels, addressType) {
	if (rawLabels.includes("Exchange") || addressType === "exchange") return "exchange_labeled_address";
	if (rawLabels.includes("Validator")) return "validator_address";
	if (rawLabels.includes("Miner")) return "miner_address";
	if (rawLabels.includes("Hotkey")) return "hotkey_address";
	if (rawLabels.includes("Subnet")) return "subnet_address";
	return "address";
}
function normalizeNode(node) {
	if (!isRecord(node)) return {};
	const rawLabels = unique([...stringArray(node["raw_labels"]), ...stringArray(node["labels"])]);
	const normalized = {};
	for (const [key, value] of Object.entries(node)) {
		if ([
			"address_type",
			"risk_level",
			"pattern_flags",
			"raw_labels",
			"labels"
		].includes(key)) continue;
		normalized[key] = value;
	}
	const address = normalized["address"] ?? normalized["id"];
	if (typeof address === "string") normalized["address"] = address;
	normalized["entity_kind"] = typeof node["entity_kind"] === "string" ? node["entity_kind"] : entityKind(rawLabels, node["address_type"]);
	normalized["labels"] = displayLabels(rawLabels, stringArray(node["labels"]));
	normalized["raw_labels"] = rawLabels;
	if (typeof node["risk_level"] === "string") normalized["risk_level"] = node["risk_level"];
	if (Array.isArray(node["pattern_flags"]) && node["pattern_flags"].length > 0) normalized["pattern_flags"] = node["pattern_flags"].map(String);
	return normalized;
}
function normalizeEdge(edge) {
	if (!isRecord(edge)) return {};
	const normalized = { ...edge };
	if (typeof normalized["from_address"] !== "string" && typeof normalized["source"] === "string") normalized["from_address"] = normalized["source"];
	if (typeof normalized["to_address"] !== "string" && typeof normalized["target"] === "string") normalized["to_address"] = normalized["target"];
	return normalized;
}
function normalizeGraphPayload(payload) {
	if (!isRecord(payload) || payload["schema"] !== "chain-insights.graph.v1") throw new Error("Unsupported graph payload schema");
	return {
		...payload,
		schema: "chain-insights.graph.v1",
		nodes: Array.isArray(payload["nodes"]) ? payload["nodes"].map(normalizeNode) : [],
		edges: Array.isArray(payload["edges"]) ? payload["edges"].map(normalizeEdge) : [],
		flows: Array.isArray(payload["flows"]) ? payload["flows"] : [],
		edge_anchors: Array.isArray(payload["edge_anchors"]) ? payload["edge_anchors"] : []
	};
}
//#endregion
Object.defineProperty(exports, "normalizeGraphPayload", {
	enumerable: true,
	get: function() {
		return normalizeGraphPayload;
	}
});
