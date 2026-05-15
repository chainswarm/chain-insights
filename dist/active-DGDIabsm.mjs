import fs from "node:fs";
import path from "node:path";
import os from "node:os";
//#region src/workspace/active.ts
function findActiveWorkspace(startDir = process.cwd()) {
	let current = path.resolve(startDir);
	while (true) {
		const metadataDir = path.join(current, ".chain-insights");
		const markerPath = path.join(metadataDir, "workspace.json");
		if (fs.existsSync(markerPath)) {
			const parsed = JSON.parse(fs.readFileSync(markerPath, "utf8"));
			if (parsed.schema === "chain-insights.workspace.v1") {
				const root = path.resolve(parsed.workspace_root ?? current);
				const casesDir = parsed.cases_dir ?? "cases";
				return {
					root,
					metadataDir: path.join(root, ".chain-insights"),
					casesRoot: path.resolve(root, casesDir)
				};
			}
		}
		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}
function activeCasesRoot() {
	return findActiveWorkspace()?.casesRoot ?? path.join(os.homedir(), ".chain-insights", "cases");
}
//#endregion
export { findActiveWorkspace as n, activeCasesRoot as t };

//# sourceMappingURL=active-DGDIabsm.mjs.map