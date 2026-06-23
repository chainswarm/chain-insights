import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
//#region src/mcp/usage-status.ts
var usage_status_exports = /* @__PURE__ */ __exportAll({
	isMissingUsageStatusToolError: () => isMissingUsageStatusToolError,
	primitiveBackendUsageStatus: () => primitiveBackendUsageStatus,
	usageStatusText: () => usageStatusText
});
function primitiveBackendUsageStatus(endpoint) {
	return {
		schema: "chain-insights.result.v1",
		tool: "meta_usage_status",
		facts: {
			usage: {
				mode: "primitive_graph_backend",
				quota_enforced: false,
				usage_status_tool: "unavailable"
			},
			backend: {
				endpoint,
				reason: "The graph backend exposes primitive graph tools but no usage_status quota tool."
			}
		},
		hint: "This backend does not expose Chain Insights quota telemetry; local devkit calls are treated as unmetered by Chain Insights."
	};
}
function usageStatusText(result) {
	return JSON.stringify(result, null, 2);
}
function isMissingUsageStatusToolError(err) {
	const message = String(err.message ?? err).toLowerCase();
	return message.includes("unknown tool") || message.includes("tool not found") || message.includes("method not found") || message.includes("usage_status");
}
//#endregion
export { usage_status_exports as n, primitiveBackendUsageStatus as t };

//# sourceMappingURL=usage-status-Chnej2I9.mjs.map