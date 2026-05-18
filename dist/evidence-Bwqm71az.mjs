import { n as serializeFrontmatter } from "./frontmatter-D8wWCeOa.mjs";
import { n as workspaceOutputPaths } from "./output-root-BcSst_Vs.mjs";
import path from "node:path";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
//#region src/cases/evidence.ts
function caseDir(caseId) {
	return path.join(workspaceOutputPaths().casesRoot, caseId);
}
function sanitizeSource(source) {
	return source.replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
}
function formatTimestamp() {
	return (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "").slice(0, 15);
}
function formatEvidenceContent(content) {
	const trimmed = content.trim();
	if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && !trimmed.startsWith("```")) return `\`\`\`json\n${trimmed}\n\`\`\``;
	return content;
}
function hashContent(content) {
	return createHash("sha256").update(content).digest("hex");
}
async function appendToManifest(manifestPath, entry) {
	const existing = JSON.parse(await readFile(manifestPath, "utf8").catch(() => "{\"entries\":[]}"));
	existing.entries.push(entry);
	await writeFile(manifestPath, JSON.stringify(existing, null, 2) + "\n", { mode: 384 });
}
const EvidenceStore = {
	async append(caseId, input) {
		const dir = caseDir(caseId);
		const evidenceDir = path.join(dir, "evidence");
		await mkdir(evidenceDir, { recursive: true });
		const safeSource = sanitizeSource(input.source);
		const timestamp = formatTimestamp();
		let seq = 1;
		try {
			seq = (await readdir(evidenceDir)).filter((f) => f.endsWith(".md")).length + 1;
		} catch {
			seq = 1;
		}
		const seqStr = String(seq).padStart(3, "0");
		let filename = `${seqStr}_${safeSource}_${timestamp}.md`;
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const fileContent = serializeFrontmatter({
			id: `${caseId}_ev${seqStr}`,
			caseId,
			source: input.source,
			timestamp: now,
			queryParams: input.queryParams
		}, `## Evidence: ${input.source}\n\n**Source:** ${input.source}\n**Captured:** ${now}\n\n${formatEvidenceContent(input.content)}\n`);
		const filePath = path.join(evidenceDir, filename);
		try {
			await writeFile(filePath, fileContent, {
				mode: 384,
				flag: "wx"
			});
		} catch (err) {
			if (err.code === "EEXIST") {
				filename = `${seqStr}_${safeSource}_${timestamp}_${Math.random().toString(36).slice(2, 6)}.md`;
				await writeFile(path.join(evidenceDir, filename), fileContent, {
					mode: 384,
					flag: "wx"
				});
			} else throw err;
		}
		const sha256 = hashContent(fileContent);
		await appendToManifest(path.join(dir, "manifest.json"), {
			file: filename,
			sha256
		});
		return {
			filename,
			sha256
		};
	},
	async verifyManifest(caseId) {
		const dir = caseDir(caseId);
		const manifestPath = path.join(dir, "manifest.json");
		const manifest = JSON.parse(await readFile(manifestPath, "utf8").catch(() => "{\"entries\":[]}"));
		const tampered = [];
		for (const entry of manifest.entries) {
			const filePath = path.join(dir, "evidence", entry.file);
			try {
				if (hashContent(await readFile(filePath, "utf8")) !== entry.sha256) tampered.push(entry.file);
			} catch {
				tampered.push(entry.file);
			}
		}
		return {
			ok: tampered.length === 0,
			count: manifest.entries.length,
			...tampered.length > 0 ? { tampered } : {}
		};
	}
};
//#endregion
export { EvidenceStore as t };

//# sourceMappingURL=evidence-Bwqm71az.mjs.map