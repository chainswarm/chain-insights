import { a as resolveGraphMcpEndpoint, n as applyMcpAuthHeaders } from "./client-BP01tPOG.mjs";
//#region src/mcp/capabilities.ts
const BITTENSOR_SEMANTIC_NETWORKS = new Set([
	"bittensor",
	"bittensor_evm",
	"bittensor_semantic"
]);
function publicNetworkCapabilities(document) {
	const source = document.networks.find((network) => BITTENSOR_SEMANTIC_NETWORKS.has(network.network));
	return {
		schema: "chain-insights.network-capabilities.v1",
		networks: source ? [{
			network: "bittensor",
			display_name: "Bittensor",
			status: source.status || "live",
			default: source.default !== false,
			layers: {
				facts: { enabled: source.layers.facts?.enabled === true },
				risk: { enabled: source.layers.risk?.enabled === true },
				topology: { enabled: source.layers.topology?.enabled === true }
			},
			tools: {
				graph_query: "available",
				graph_query_batch: "available"
			}
		}] : []
	};
}
function metadataNetworksUrl(endpoint) {
	const url = new URL(endpoint);
	url.pathname = "/metadata/networks";
	url.search = "";
	url.hash = "";
	return url;
}
async function fetchNetworkCapabilities(config) {
	const request = metadataNetworksUrl(resolveGraphMcpEndpoint(config));
	const headers = new Headers();
	const token = config.graphMcpAuthToken?.trim() || config.mcpAuthToken?.trim();
	if (token) applyMcpAuthHeaders(headers, token);
	let response;
	try {
		response = await fetch(request, { headers });
	} catch (err) {
		throw new Error(`network capabilities unavailable at ${request}: ${err.message}`);
	}
	if (!response.ok) throw new Error(`network capabilities unavailable at ${request}: HTTP ${response.status}`);
	const parsed = await response.json();
	if (parsed.schema !== "chain-insights.network-capabilities.v1" || !Array.isArray(parsed.networks)) throw new Error("network capabilities response has unsupported schema");
	return publicNetworkCapabilities(parsed);
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
		"Facts",
		"Risk",
		"Available tools"
	];
	const widths = [
		14,
		10,
		8,
		8,
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
			availableToolsLabel(network)
		]))
	].join("\n");
}
//#endregion
export { fetchNetworkCapabilities, formatNetworkCapabilities };

//# sourceMappingURL=capabilities-CxYrKgOW.mjs.map