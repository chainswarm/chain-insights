const require_client = require("./client-D0Bnl2S5.cjs");
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
	let response;
	try {
		response = await fetch(request, { headers });
	} catch (err) {
		throw new Error(`network capabilities unavailable at ${request}: ${err.message}`);
	}
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
function shortDate(value) {
	if (!value) return "";
	return value.slice(0, 10);
}
function datasetLabel(network) {
	const coverage = network.coverage;
	if (!coverage) return "unknown";
	const blockRange = coverage.from_block !== void 0 && coverage.to_block !== void 0 ? `${coverage.from_block}..${coverage.to_block}` : "blocks unknown";
	const dateRange = coverage.from_timestamp && coverage.to_timestamp ? `${shortDate(coverage.from_timestamp)}..${shortDate(coverage.to_timestamp)}` : "dates unknown";
	if (blockRange === "blocks unknown" && dateRange === "dates unknown") return "unknown";
	return `${blockRange} / ${dateRange}`;
}
function formatNetworkCapabilities(document) {
	if (document.networks.length === 0) return "No supported networks advertised.";
	const headers = [
		"Network",
		"Topology",
		"Facts",
		"Risk",
		"Dataset",
		"Available tools"
	];
	const widths = [
		14,
		10,
		8,
		8,
		38,
		64
	];
	const row = (values) => values.map((value, index) => value.padEnd(widths[index])).join("  ");
	return [
		row(headers),
		widths.map((width) => "-".repeat(width)).join("  "),
		...document.networks.map((network) => row([
			network.display_name || network.network,
			layerValue(network, "topology"),
			layerValue(network, "facts"),
			layerValue(network, "risk"),
			datasetLabel(network),
			availableToolsLabel(network)
		]))
	].join("\n");
}
//#endregion
exports.fetchNetworkCapabilities = fetchNetworkCapabilities;
exports.formatNetworkCapabilities = formatNetworkCapabilities;
