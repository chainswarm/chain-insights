import { t as __exportAll } from "./rolldown-runtime-D7D4PA-g.mjs";
//#region src/mcp/tool-visibility.ts
var tool_visibility_exports = /* @__PURE__ */ __exportAll({
	HIDDEN_REMOTE_TOOL_NAMES: () => HIDDEN_REMOTE_TOOL_NAMES,
	assertPublicMcpToolName: () => assertPublicMcpToolName,
	isHiddenRemoteToolName: () => isHiddenRemoteToolName,
	visibleRemoteTools: () => visibleRemoteTools
});
const HIDDEN_REMOTE_TOOL_NAMES = new Set([
	"topup",
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
	throw new Error(`MCP tool '${name}' is not exposed by Chain Insights.${name === "trace_funds" ? " Use trace_victim_funds, trace_suspect_funds, or trace_deposit_sources instead." : name === "track_funds" ? " Use trace_victim_funds instead." : name === "scam_topology" ? " Use trace_suspect_funds instead." : ""}`);
}
//#endregion
export { tool_visibility_exports as n, HIDDEN_REMOTE_TOOL_NAMES as t };

//# sourceMappingURL=tool-visibility-BpyZHRBi.mjs.map