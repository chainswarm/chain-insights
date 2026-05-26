const require_chunk = require("./chunk-CZWwpsFl.cjs");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_fs = require("node:fs");
node_fs = require_chunk.__toESM(node_fs, 1);
let node_os = require("node:os");
node_os = require_chunk.__toESM(node_os, 1);
//#region src/workspace/active.ts
var active_exports = /* @__PURE__ */ require_chunk.__exportAll({
	activeCasesRoot: () => activeCasesRoot,
	activeDataDir: () => activeDataDir,
	findActiveWorkspace: () => findActiveWorkspace
});
function workspaceFromRoot(rootCandidate) {
	const root = node_path.default.resolve(rootCandidate);
	const metadataDir = node_path.default.join(root, ".chain-insights");
	const markerPath = node_path.default.join(metadataDir, "workspace.json");
	if (!node_fs.default.existsSync(markerPath)) return null;
	const parsed = JSON.parse(node_fs.default.readFileSync(markerPath, "utf8"));
	if (parsed.schema !== "chain-insights.workspace.v1") return null;
	const workspaceRoot = node_path.default.resolve(parsed.workspace_root ?? root);
	const casesDir = parsed.cases_dir ?? "cases";
	return {
		root: workspaceRoot,
		metadataDir: node_path.default.join(workspaceRoot, ".chain-insights"),
		casesRoot: node_path.default.resolve(workspaceRoot, casesDir)
	};
}
function findActiveWorkspace(startDir = process.cwd()) {
	const envWorkspace = process.env["CHAIN_INSIGHTS_WORKSPACE"]?.trim();
	if (envWorkspace) {
		const active = workspaceFromRoot(envWorkspace);
		if (active) return active;
	}
	let current = node_path.default.resolve(startDir);
	while (true) {
		const active = workspaceFromRoot(current);
		if (active) return active;
		const parent = node_path.default.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}
function activeCasesRoot() {
	return findActiveWorkspace()?.casesRoot ?? node_path.default.join(node_os.default.homedir(), ".chain-insights", "cases");
}
function activeDataDir(fallbackDataDir) {
	return findActiveWorkspace()?.root ?? fallbackDataDir ?? node_path.default.join(node_os.default.homedir(), ".chain-insights");
}
//#endregion
Object.defineProperty(exports, "activeCasesRoot", {
	enumerable: true,
	get: function() {
		return activeCasesRoot;
	}
});
Object.defineProperty(exports, "active_exports", {
	enumerable: true,
	get: function() {
		return active_exports;
	}
});
Object.defineProperty(exports, "findActiveWorkspace", {
	enumerable: true,
	get: function() {
		return findActiveWorkspace;
	}
});
