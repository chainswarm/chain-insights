const require_chunk = require("./chunk-CZWwpsFl.cjs");
const require_active = require("./active-cWS-i7UB.cjs");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
//#region src/workspace/output-root.ts
var output_root_exports = /* @__PURE__ */ require_chunk.__exportAll({
	NO_WORKSPACE_ERROR: () => NO_WORKSPACE_ERROR,
	requireWorkspaceRoot: () => requireWorkspaceRoot,
	workspaceOutputPaths: () => workspaceOutputPaths
});
const NO_WORKSPACE_ERROR = "No Chain Insights workspace found. Run: cia init .";
function requireWorkspaceRoot(startDir = process.cwd()) {
	const workspace = require_active.findActiveWorkspace(startDir);
	if (!workspace) throw new Error(NO_WORKSPACE_ERROR);
	return workspace.root;
}
function workspaceOutputPaths(workspaceRoot = requireWorkspaceRoot()) {
	const root = node_path.default.resolve(workspaceRoot);
	return {
		root,
		metadataDir: node_path.default.join(root, ".chain-insights"),
		schemaDir: node_path.default.join(root, ".chain-insights", "schema"),
		runtimeDir: node_path.default.join(root, ".chain-insights", "runtime"),
		casesRoot: node_path.default.join(root, "cases"),
		reportsRoot: node_path.default.join(root, "reports"),
		reportGraphsRoot: node_path.default.join(root, "reports", "graphs"),
		reportTablesRoot: node_path.default.join(root, "reports", "tables"),
		logsRoot: node_path.default.join(root, ".chain-insights", "runtime", "logs")
	};
}
//#endregion
Object.defineProperty(exports, "output_root_exports", {
	enumerable: true,
	get: function() {
		return output_root_exports;
	}
});
Object.defineProperty(exports, "workspaceOutputPaths", {
	enumerable: true,
	get: function() {
		return workspaceOutputPaths;
	}
});
