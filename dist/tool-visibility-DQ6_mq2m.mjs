import { t as __exportAll } from "./rolldown-runtime-D7D4PA-g.mjs";
//#region src/mcp/tool-visibility.ts
var tool_visibility_exports = /* @__PURE__ */ __exportAll({
	HIDDEN_REMOTE_TOOL_NAMES: () => HIDDEN_REMOTE_TOOL_NAMES,
	PUBLIC_MCP_TOOL_ALLOWED_ARGS: () => PUBLIC_MCP_TOOL_ALLOWED_ARGS,
	PUBLIC_MCP_TOOL_REQUIRED_ARGS: () => PUBLIC_MCP_TOOL_REQUIRED_ARGS,
	assertPublicMcpToolName: () => assertPublicMcpToolName,
	isHiddenRemoteToolName: () => isHiddenRemoteToolName,
	validatePublicMcpToolArguments: () => validatePublicMcpToolArguments,
	visibleRemoteTools: () => visibleRemoteTools
});
const HIDDEN_REMOTE_TOOL_NAMES = new Set([
	"topup",
	"address_risk",
	"trace_victim_funds",
	"trace_suspect_funds",
	"trace_deposit_sources",
	"trace_funds",
	"track_funds",
	"network_capabilities",
	"usage_status",
	"balance",
	"help",
	"money_flows_between_exchanges",
	"address_connection_risk",
	"exposure_profile",
	"exposure_quality",
	"exposure_carry",
	"exposure_crowding",
	"exposure_exit_pressure",
	"exposure_correlation",
	"exposure_explain"
]);
const PUBLIC_MCP_TOOL_REQUIRED_ARGS = {
	aml_address_risk: ["address", "network"],
	aml_trace_victim_funds: ["victim_addresses", "network"],
	aml_trace_suspect_funds: ["suspect_addresses", "network"],
	aml_trace_deposit_sources: ["deposit_addresses", "network"],
	graph_query: ["query", "network"],
	graph_query_batch: ["network", "queries"]
};
const PUBLIC_MCP_TOOL_ALLOWED_ARGS = {
	aml_address_risk: [
		"address",
		"network",
		"compare_address",
		"include_attachments"
	],
	aml_trace_victim_funds: [
		"victim_addresses",
		"network",
		"known_suspect_addresses",
		"incident_timestamp_ms",
		"max_hops",
		"include_attachments"
	],
	aml_trace_suspect_funds: [
		"suspect_addresses",
		"network",
		"incident_timestamp_ms",
		"max_hops",
		"include_attachments"
	],
	aml_trace_deposit_sources: [
		"deposit_addresses",
		"network",
		"max_hops",
		"include_attachments"
	],
	graph_query: ["query", "network"],
	graph_query_batch: [
		"network",
		"queries",
		"per_query_timeout_seconds"
	]
};
function isHiddenRemoteToolName(name) {
	return HIDDEN_REMOTE_TOOL_NAMES.has(name);
}
function visibleRemoteTools(tools) {
	return tools.filter((tool) => !isHiddenRemoteToolName(tool.name));
}
function assertPublicMcpToolName(name) {
	if (!isHiddenRemoteToolName(name)) return;
	throw new Error(`MCP tool '${name}' is not exposed by Chain Insights.${name === "trace_funds" ? " Use aml_trace_victim_funds, aml_trace_suspect_funds, or aml_trace_deposit_sources instead." : name === "trace_victim_funds" ? " Use aml_trace_victim_funds instead." : name === "trace_suspect_funds" ? " Use aml_trace_suspect_funds instead." : name === "trace_deposit_sources" ? " Use aml_trace_deposit_sources instead." : name === "track_funds" ? " Use aml_trace_victim_funds instead." : name === "address_risk" ? " Use aml_address_risk instead." : name === "network_capabilities" ? " Use meta_network_capabilities instead." : name === "usage_status" ? " Use meta_usage_status instead." : name === "balance" ? " Use wallet_balance instead." : name === "help" ? " Use meta_help instead." : ""}`);
}
function validatePublicMcpToolArguments(name, args) {
	const allowedArgs = PUBLIC_MCP_TOOL_ALLOWED_ARGS[name];
	if (!allowedArgs) return;
	const unsupportedArgs = Object.keys(args).filter((argName) => !allowedArgs.includes(argName));
	if (unsupportedArgs.length === 0) return;
	throw new Error([`Unsupported argument${unsupportedArgs.length === 1 ? "" : "s"} for ${name}: ${unsupportedArgs.join(", ")}.`, `Allowed arguments: ${allowedArgs.join(", ")}.`].join(" "));
}
//#endregion
export { tool_visibility_exports as i, PUBLIC_MCP_TOOL_ALLOWED_ARGS as n, PUBLIC_MCP_TOOL_REQUIRED_ARGS as r, HIDDEN_REMOTE_TOOL_NAMES as t };

//# sourceMappingURL=tool-visibility-DQ6_mq2m.mjs.map