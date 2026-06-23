import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
//#region src/workspace/active.ts
var active_exports = /* @__PURE__ */ __exportAll({
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
	const artifactsDir = parsed.artifacts_dir ?? "artifacts";
	const domainHints = Array.isArray(parsed.domain_hints) ? parsed.domain_hints.filter((value) => typeof value === "string" && value.trim().length > 0) : [];
	return {
		root: workspaceRoot,
		metadataDir: path.join(workspaceRoot, ".chain-insights"),
		artifactsRoot: path.resolve(workspaceRoot, artifactsDir),
		domainHints
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
function activeDataDir(fallbackDataDir) {
	return findActiveWorkspace()?.root ?? fallbackDataDir ?? path.join(os.homedir(), ".chain-insights");
}
//#endregion
export { findActiveWorkspace as n, active_exports as t };

//# sourceMappingURL=active-BZD4Ttxr.mjs.map