const require_chunk = require("./chunk-CZWwpsFl.cjs");
const require_frontmatter = require("./frontmatter-Birh_UJU.cjs");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_fs_promises = require("node:fs/promises");
let node_os = require("node:os");
node_os = require_chunk.__toESM(node_os, 1);
require("node:crypto");
//#region src/cases/dossier.ts
function caseDir(caseId) {
	return node_path.default.join(node_os.default.homedir(), ".chain-insights", "cases", caseId);
}
function sanitizeAddress(address) {
	return address.replace(/[^a-zA-Z0-9]/g, "").slice(0, 66);
}
const DossierStore = {
	async appendFinding(caseId, address, finding, entityType = "unknown") {
		const safeAddr = sanitizeAddress(address);
		const dossierDir = node_path.default.join(caseDir(caseId), "dossiers");
		await (0, node_fs_promises.mkdir)(dossierDir, { recursive: true });
		const filePath = node_path.default.join(dossierDir, `${safeAddr}.md`);
		const now = (/* @__PURE__ */ new Date()).toISOString();
		let raw;
		let isNew = false;
		try {
			raw = await (0, node_fs_promises.readFile)(filePath, "utf8");
		} catch (err) {
			if (err.code !== "ENOENT") throw err;
			raw = require_frontmatter.serializeFrontmatter({
				address,
				type: entityType,
				firstSeen: now,
				lastSeen: now,
				riskTags: ""
			}, `# Entity: ${address}\n\n## Summary\n\nEntity observed in case ${caseId}.\n\n## Findings\n\n## Links to Evidence\n\n## Related Entities\n\n`);
			isNew = true;
		}
		if (!isNew && raw.includes(finding)) return;
		const { frontmatter, body } = require_frontmatter.parseFrontmatter(raw);
		frontmatter["lastSeen"] = now;
		if (!isNew) frontmatter["type"] = entityType;
		const findingEntry = `- [${now}] ${finding}\n`;
		await (0, node_fs_promises.writeFile)(filePath, require_frontmatter.serializeFrontmatter(frontmatter, body.replace("## Findings\n", `## Findings\n\n${findingEntry}`)), { mode: 384 });
	},
	async get(caseId, address) {
		const safeAddr = sanitizeAddress(address);
		const filePath = node_path.default.join(caseDir(caseId), "dossiers", `${safeAddr}.md`);
		try {
			return require_frontmatter.parseFrontmatter(await (0, node_fs_promises.readFile)(filePath, "utf8"));
		} catch (err) {
			if (err.code === "ENOENT") return null;
			throw err;
		}
	},
	async listSummaries(caseId) {
		const dossierDir = node_path.default.join(caseDir(caseId), "dossiers");
		try {
			const files = await (0, node_fs_promises.readdir)(dossierDir);
			const summaries = [];
			for (const file of files.filter((f) => f.endsWith(".md"))) {
				const { frontmatter } = require_frontmatter.parseFrontmatter(await (0, node_fs_promises.readFile)(node_path.default.join(dossierDir, file), "utf8"));
				summaries.push({
					address: frontmatter["address"] ?? file.replace(".md", ""),
					type: frontmatter["type"] ?? "unknown",
					riskTags: frontmatter["riskTags"] ?? "",
					firstSeen: frontmatter["firstSeen"] ?? "",
					lastSeen: frontmatter["lastSeen"] ?? ""
				});
			}
			return summaries;
		} catch {
			return [];
		}
	}
};
//#endregion
exports.DossierStore = DossierStore;
