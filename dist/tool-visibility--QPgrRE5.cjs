//#region src/mcp/tool-visibility.ts
var tool_visibility_exports = /* @__PURE__ */ require("./chunk-DakpK96I.cjs").__exportAll({
	HIDDEN_REMOTE_TOOL_NAMES: () => HIDDEN_REMOTE_TOOL_NAMES,
	assertPublicMcpToolName: () => assertPublicMcpToolName,
	isHiddenRemoteToolName: () => isHiddenRemoteToolName,
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
	"scam_topology",
	"money_flows_between_exchanges",
	"address_connection_risk"
]);
function isHiddenRemoteToolName(name) {
	return HIDDEN_REMOTE_TOOL_NAMES.has(name);
}
function visibleRemoteTools(tools) {
	return tools.filter((tool) => !isHiddenRemoteToolName(tool.name));
}
function assertPublicMcpToolName(name) {
	if (!isHiddenRemoteToolName(name)) return;
	throw new Error(`MCP tool '${name}' is not exposed by Chain Insights.${name === "trace_funds" ? " Use aml_trace_victim_funds, aml_trace_suspect_funds, or aml_trace_deposit_sources instead." : name === "trace_victim_funds" ? " Use aml_trace_victim_funds instead." : name === "trace_suspect_funds" ? " Use aml_trace_suspect_funds instead." : name === "trace_deposit_sources" ? " Use aml_trace_deposit_sources instead." : name === "track_funds" ? " Use aml_trace_victim_funds instead." : name === "scam_topology" ? " Use aml_trace_suspect_funds instead." : name === "address_risk" ? " Use aml_address_risk instead." : ""}`);
}
//#endregion
Object.defineProperty(exports, "HIDDEN_REMOTE_TOOL_NAMES", {
	enumerable: true,
	get: function() {
		return HIDDEN_REMOTE_TOOL_NAMES;
	}
});
Object.defineProperty(exports, "tool_visibility_exports", {
	enumerable: true,
	get: function() {
		return tool_visibility_exports;
	}
});
