require("./chunk-CZWwpsFl.cjs");
let node_net = require("node:net");
//#region src/config/mcp-endpoint.ts
const LOOPBACK_HOSTS = new Set([
	"localhost",
	"127.0.0.1",
	"::1",
	"[::1]"
]);
const LOCAL_GRAPH_MCP_ENDPOINT = "http://127.0.0.1:8012/mcp";
const LOCAL_LEGACY_MCP_ENDPOINT = "http://127.0.0.1:4000";
function isLoopbackHost(hostname) {
	const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
	if (LOOPBACK_HOSTS.has(normalized)) return true;
	if ((0, node_net.isIP)(normalized) !== 4) return false;
	return normalized.split(".")[0] === "127";
}
function isKubernetesServiceHost(hostname) {
	return hostname.toLowerCase().endsWith(".svc.cluster.local");
}
function graphMcpEndpointEnvOverride() {
	const envEndpoint = process.env.CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT?.trim() || process.env.GRAPH_MCP_ENDPOINT?.trim();
	return envEndpoint ? validateMcpEndpoint(envEndpoint, "graphMcpEndpoint") : void 0;
}
function validateMcpEndpoint(value, key) {
	const trimmed = value.trim();
	if (!trimmed) throw new Error(`${key} must be a non-empty absolute URL.`);
	let parsed;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new Error(`${key} must be an absolute URL (example: https://mcp.example.com/mcp or http://127.0.0.1:8012/mcp).`);
	}
	if (parsed.username || parsed.password) throw new Error(`${key} must not include URL credentials.`);
	if (parsed.search || parsed.hash) throw new Error(`${key} must not include query parameters or URL fragments.`);
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error(`${key} must use either https:// or http://.`);
	if (parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname) && !isKubernetesServiceHost(parsed.hostname)) throw new Error(`${key} must use https:// for remote hosts. http:// is allowed only for localhost, loopback addresses, or Kubernetes *.svc.cluster.local service DNS.`);
	return trimmed;
}
//#endregion
Object.defineProperty(exports, "LOCAL_GRAPH_MCP_ENDPOINT", {
	enumerable: true,
	get: function() {
		return LOCAL_GRAPH_MCP_ENDPOINT;
	}
});
Object.defineProperty(exports, "LOCAL_LEGACY_MCP_ENDPOINT", {
	enumerable: true,
	get: function() {
		return LOCAL_LEGACY_MCP_ENDPOINT;
	}
});
Object.defineProperty(exports, "graphMcpEndpointEnvOverride", {
	enumerable: true,
	get: function() {
		return graphMcpEndpointEnvOverride;
	}
});
Object.defineProperty(exports, "validateMcpEndpoint", {
	enumerable: true,
	get: function() {
		return validateMcpEndpoint;
	}
});
