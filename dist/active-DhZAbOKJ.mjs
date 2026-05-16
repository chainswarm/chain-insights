import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
//#region src/workspace/active.ts
var active_exports = /* @__PURE__ */ __exportAll({
	activeCasesRoot: () => activeCasesRoot,
	activeDataDir: () => activeDataDir,
	findActiveWorkspace: () => findActiveWorkspace
});
function workspaceFromRoot(rootCandidate) {
	const root = path.resolve(rootCandidate);
	const metadataDir = path.join(root, ".chain-insights");
	const markerPath = path.join(metadataDir, "workspace.json");
	if (!fs.existsSync(markerPath)) return null;
	const parsed = JSON.parse(fs.readFileSync(markerPath, "utf8"));
	if (parsed.schema !== "chain-insights.workspace.v1") return null;
	const workspaceRoot = path.resolve(parsed.workspace_root ?? root);
	const casesDir = parsed.cases_dir ?? "cases";
	return {
		root: workspaceRoot,
		metadataDir: path.join(workspaceRoot, ".chain-insights"),
		casesRoot: path.resolve(workspaceRoot, casesDir)
	};
}
function findActiveWorkspace(startDir = process.cwd()) {
	const envWorkspace = process.env["CHAIN_INSIGHTS_WORKSPACE"]?.trim();
	if (envWorkspace) {
		const active = workspaceFromRoot(envWorkspace);
		if (active) return active;
	}
	let current = path.resolve(startDir);
	while (true) {
		const active = workspaceFromRoot(current);
		if (active) return active;
		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}
function activeCasesRoot() {
	return findActiveWorkspace()?.casesRoot ?? path.join(os.homedir(), ".chain-insights", "cases");
}
function activeDataDir(fallbackDataDir) {
	return findActiveWorkspace()?.root ?? fallbackDataDir ?? path.join(os.homedir(), ".chain-insights");
}
//#endregion
export { active_exports as n, findActiveWorkspace as r, activeCasesRoot as t };

//# sourceMappingURL=active-DhZAbOKJ.mjs.map