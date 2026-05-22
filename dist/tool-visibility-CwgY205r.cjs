//#region src/mcp/tool-visibility.ts
var tool_visibility_exports = /* @__PURE__ */ require("./chunk-CZWwpsFl.cjs").__exportAll({
	HIDDEN_REMOTE_TOOL_NAMES: () => HIDDEN_REMOTE_TOOL_NAMES,
	assertPublicMcpToolName: () => assertPublicMcpToolName,
	isHiddenRemoteToolName: () => isHiddenRemoteToolName,
	visibleRemoteTools: () => visibleRemoteTools
});
const HIDDEN_REMOTE_TOOL_NAMES = new Set([
	"topup",
	"trace_funds",
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
	throw new Error(`MCP tool '${name}' is not exposed by Chain Insights.${name === "trace_funds" ? " Use track_funds instead." : ""}`);
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
