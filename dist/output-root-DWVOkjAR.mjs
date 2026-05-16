import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import { r as findActiveWorkspace } from "./active-DhZAbOKJ.mjs";
import path from "node:path";
//#region src/workspace/output-root.ts
var output_root_exports = /* @__PURE__ */ __exportAll({
	NO_WORKSPACE_ERROR: () => NO_WORKSPACE_ERROR,
	requireWorkspaceRoot: () => requireWorkspaceRoot,
	workspaceOutputPaths: () => workspaceOutputPaths
});
const NO_WORKSPACE_ERROR = "No Chain Insights workspace found. Run: cia init .";
function requireWorkspaceRoot(startDir = process.cwd()) {
	const workspace = findActiveWorkspace(startDir);
	if (!workspace) throw new Error(NO_WORKSPACE_ERROR);
	return workspace.root;
}
function workspaceOutputPaths(workspaceRoot = requireWorkspaceRoot()) {
	const root = path.resolve(workspaceRoot);
	return {
		root,
		metadataDir: path.join(root, ".chain-insights"),
		schemaDir: path.join(root, ".chain-insights", "schema"),
		runtimeDir: path.join(root, ".chain-insights", "runtime"),
		casesRoot: path.join(root, "cases"),
		reportsRoot: path.join(root, "reports"),
		reportGraphsRoot: path.join(root, "reports", "graphs"),
		reportTablesRoot: path.join(root, "reports", "tables"),
		artifactsRoot: path.join(root, "artifacts"),
		logsRoot: path.join(root, "logs")
	};
}
//#endregion
export { workspaceOutputPaths as n, output_root_exports as t };

//# sourceMappingURL=output-root-DWVOkjAR.mjs.map