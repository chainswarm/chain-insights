const require_chunk = require("./chunk-CZWwpsFl.cjs");
let node_fs = require("node:fs");
node_fs = require_chunk.__toESM(node_fs, 1);
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_os = require("node:os");
node_os = require_chunk.__toESM(node_os, 1);
//#region src/workspace/active.ts
function findActiveWorkspace(startDir = process.cwd()) {
	let current = node_path.default.resolve(startDir);
	while (true) {
		const metadataDir = node_path.default.join(current, ".chain-insights");
		const markerPath = node_path.default.join(metadataDir, "workspace.json");
		if (node_fs.default.existsSync(markerPath)) {
			const parsed = JSON.parse(node_fs.default.readFileSync(markerPath, "utf8"));
			if (parsed.schema === "chain-insights.workspace.v1") {
				const root = node_path.default.resolve(parsed.workspace_root ?? current);
				const casesDir = parsed.cases_dir ?? "cases";
				return {
					root,
					metadataDir: node_path.default.join(root, ".chain-insights"),
					casesRoot: node_path.default.resolve(root, casesDir)
				};
			}
		}
		const parent = node_path.default.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}
function activeCasesRoot() {
	return findActiveWorkspace()?.casesRoot ?? node_path.default.join(node_os.default.homedir(), ".chain-insights", "cases");
}
//#endregion
Object.defineProperty(exports, "activeCasesRoot", {
	enumerable: true,
	get: function() {
		return activeCasesRoot;
	}
});
Object.defineProperty(exports, "findActiveWorkspace", {
	enumerable: true,
	get: function() {
		return findActiveWorkspace;
	}
});
