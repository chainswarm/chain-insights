import { n as serializeFrontmatter, t as parseFrontmatter } from "./frontmatter-DpU9_CTC.mjs";
import { n as workspaceOutputPaths } from "./output-root-DWVOkjAR.mjs";
import path from "node:path";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import "node:crypto";
//#region src/cases/dossier.ts
function caseDir(caseId) {
	return path.join(workspaceOutputPaths().casesRoot, caseId);
}
function sanitizeAddress(address) {
	return address.replace(/[^a-zA-Z0-9]/g, "").slice(0, 66);
}
const DossierStore = {
	async appendFinding(caseId, address, finding, entityType = "unknown") {
		const safeAddr = sanitizeAddress(address);
		const dossierDir = path.join(caseDir(caseId), "dossiers");
		await mkdir(dossierDir, { recursive: true });
		const filePath = path.join(dossierDir, `${safeAddr}.md`);
		const now = (/* @__PURE__ */ new Date()).toISOString();
		let raw;
		let isNew = false;
		try {
			raw = await readFile(filePath, "utf8");
		} catch (err) {
			if (err.code !== "ENOENT") throw err;
			raw = serializeFrontmatter({
				address,
				type: entityType,
				firstSeen: now,
				lastSeen: now,
				riskTags: ""
			}, `# Entity: ${address}\n\n## Summary\n\nEntity observed in case ${caseId}.\n\n## Findings\n\n## Links to Evidence\n\n## Related Entities\n\n`);
			isNew = true;
		}
		if (!isNew && raw.includes(finding)) return;
		const { frontmatter, body } = parseFrontmatter(raw);
		frontmatter["lastSeen"] = now;
		if (!isNew) frontmatter["type"] = entityType;
		const findingEntry = `- [${now}] ${finding}\n`;
		await writeFile(filePath, serializeFrontmatter(frontmatter, body.replace("## Findings\n", `## Findings\n\n${findingEntry}`)), { mode: 384 });
	},
	async get(caseId, address) {
		const safeAddr = sanitizeAddress(address);
		const filePath = path.join(caseDir(caseId), "dossiers", `${safeAddr}.md`);
		try {
			return parseFrontmatter(await readFile(filePath, "utf8"));
		} catch (err) {
			if (err.code === "ENOENT") return null;
			throw err;
		}
	},
	async listSummaries(caseId) {
		const dossierDir = path.join(caseDir(caseId), "dossiers");
		try {
			const files = await readdir(dossierDir);
			const summaries = [];
			for (const file of files.filter((f) => f.endsWith(".md"))) {
				const { frontmatter } = parseFrontmatter(await readFile(path.join(dossierDir, file), "utf8"));
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
export { DossierStore };

//# sourceMappingURL=dossier-DGbH5gCG.mjs.map