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
function availableToolsLabel(network) {
	const tools = Object.entries(network.tools ?? {}).filter(([, status]) => status === "available").map(([name]) => name);
	return tools.length > 0 ? tools.join(", ") : "none";
}
function formatNetworkCapabilities(document) {
	if (document.networks.length === 0) return "No supported networks advertised.";
	const headers = [
		"Network",
		"Topology",
		"Risk",
		"Available tools"
	];
	const widths = [
		14,
		10,
		10,
		54
	];
	const row = (values) => values.map((value, index) => value.padEnd(widths[index])).join("  ");
	return [
		row(headers),
		widths.map((width) => "-".repeat(width)).join("  "),
		...document.networks.map((network) => row([
			network.display_name || network.network,
			layerValue(network, "topology_labels"),
			layerValue(network, "risk_intelligence"),
			availableToolsLabel(network)
		]))
	].join("\n");
}
//#endregion
exports.fetchNetworkCapabilities = fetchNetworkCapabilities;
exports.formatNetworkCapabilities = formatNetworkCapabilities;
