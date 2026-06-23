import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import { n as findActiveWorkspace } from "./active-BZD4Ttxr.mjs";
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
		artifactsRoot: path.join(root, "artifacts"),
		entitiesRoot: path.join(root, "entities"),
		sessionsRoot: path.join(root, "sessions"),
		publishedRoot: path.join(root, "published"),
		reportsRoot: path.join(root, "reports"),
		reportGraphsRoot: path.join(root, "reports", "graphs"),
		reportTablesRoot: path.join(root, "reports", "tables"),
		logsRoot: path.join(root, ".chain-insights", "runtime", "logs")
	};
}
//#endregion
export { workspaceOutputPaths as n, output_root_exports as t };

//# sourceMappingURL=output-root-DWSzNmRP.mjs.map