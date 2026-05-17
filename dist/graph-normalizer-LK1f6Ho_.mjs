//#region src/viz/graph-normalizer.ts
const GRAPH_TYPE_LABELS = new Set([
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
function displayLabels(currentLabels) {
	return unique(currentLabels).filter((label) => !GRAPH_TYPE_LABELS.has(label));
}
function hasLabel(labels, expected) {
	return labels.some((label) => label.toLowerCase() === expected);
}
function normalizeRole(role, labels, addressType) {
	if (role === "source_exchange") return "exchange";
	if (role === "deposit_candidate") return "deposit";
	if (typeof role === "string" && role.length > 0) return role;
	if (hasLabel(labels, "exchange") || addressType === "exchange") return "exchange";
	if (addressType === "deposit") return "deposit";
	return null;
}
function normalizeNode(node) {
	if (!isRecord(node)) return {};
	const labels = stringArray(node["labels"]);
	const normalized = {};
	for (const [key, value] of Object.entries(node)) {
		if ([
			"address_type",
			"risk_level",
			"pattern_flags",
			"raw_labels",
			"labels",
			"entity_kind",
			"role"
		].includes(key)) continue;
		normalized[key] = value;
	}
	const address = normalized["address"] ?? normalized["id"];
	if (typeof address === "string") normalized["address"] = address;
	normalized["labels"] = displayLabels(labels);
	const role = normalizeRole(node["role"], labels, node["address_type"]);
	if (role) normalized["role"] = role;
	if (typeof node["risk_level"] === "string") normalized["risk_level"] = node["risk_level"];
	if (!Array.isArray(node["flags"]) && Array.isArray(node["pattern_flags"]) && node["pattern_flags"].length > 0) normalized["flags"] = node["pattern_flags"].map(String);
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
export { normalizeGraphPayload as t };

//# sourceMappingURL=graph-normalizer-LK1f6Ho_.mjs.map