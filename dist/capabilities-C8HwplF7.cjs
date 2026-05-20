const require_client = require("./client-D4fZgIaO.cjs");
//#region src/mcp/capabilities.ts
function metadataNetworksUrl(endpoint) {
	const url = new URL(endpoint);
	url.pathname = "/metadata/networks";
	url.search = "";
	url.hash = "";
	return url;
}
async function fetchNetworkCapabilities(config) {
	const request = metadataNetworksUrl(require_client.resolveGraphMcpEndpoint(config));
	const headers = new Headers();
	const token = config.graphMcpAuthToken?.trim() || config.mcpAuthToken?.trim();
	if (token) {
		headers.set("X-MCP-Debug-Token", token);
		headers.set("Authorization", `Bearer ${token}`);
	}
	const response = await fetch(request, { headers });
	if (!response.ok) throw new Error(`network capabilities unavailable at ${request}: HTTP ${response.status}`);
	const parsed = await response.json();
	if (parsed.schema !== "chain-insights.network-capabilities.v1" || !Array.isArray(parsed.networks)) throw new Error("network capabilities response has unsupported schema");
	return parsed;
}
function layerValue(network, layer) {
	if (!network.layers[layer]?.enabled) return "no";
	return "yes";
}
function retentionLabel(network) {
	const retention = network.layers["topology_labels"]?.retention;
	if (!retention) return "unknown";
	if (retention.mode === "rolling_window" && retention.window_days) {
		if (retention.window_days % 365 === 0) return `${retention.window_days / 365}y rolling`;
		return `${retention.window_days}d rolling`;
	}
	if (retention.mode === "expanding_then_rolling" && retention.window_days) {
		if (retention.window_days % 365 === 0) return `growing to ${retention.window_days / 365}y`;
		return `growing to ${retention.window_days}d`;
	}
	if (retention.mode === "full_history") return "full history";
	if (retention.mode === "bounded_range") return "bounded";
	return retention.mode || "unknown";
}
function freshnessLabel(network) {
	const blocksBehind = network.coverage?.blocks_behind_tip;
	if (typeof blocksBehind === "number") return `${blocksBehind} blocks behind`;
	const maxAge = network.freshness?.max_data_age_seconds;
	if (typeof maxAge === "number") return `${Math.round(maxAge / 60)} min old`;
	return "unknown";
}
function aggregationLabel(network) {
	const materializations = network.aggregations?.["transfers"]?.filter((materialization) => materialization.enabled) ?? [];
	if (materializations.length === 0) return "unknown";
	return materializations.map((materialization) => {
		if (materialization.level === "daily") return "day";
		if (materialization.level === "monthly") return "month";
		if (materialization.level === "yearly") return "year";
		return materialization.level;
	}).join("/");
}
function formatNetworkCapabilities(document) {
	if (document.networks.length === 0) return "No supported networks advertised.";
	const headers = [
		"Network",
		"Topology",
		"Risk",
		"Retention",
		"Transfers",
		"Freshness"
	];
	const widths = [
		14,
		10,
		10,
		14,
		19,
		18
	];
	const row = (values) => values.map((value, index) => value.padEnd(widths[index])).join("  ");
	return [
		row(headers),
		widths.map((width) => "-".repeat(width)).join("  "),
		...document.networks.map((network) => row([
			network.display_name || network.network,
			layerValue(network, "topology_labels"),
			layerValue(network, "risk_intelligence"),
			retentionLabel(network),
			aggregationLabel(network),
			freshnessLabel(network)
		]))
	].join("\n");
}
//#endregion
exports.fetchNetworkCapabilities = fetchNetworkCapabilities;
exports.formatNetworkCapabilities = formatNetworkCapabilities;
