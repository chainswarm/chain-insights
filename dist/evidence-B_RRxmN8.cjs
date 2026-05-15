const require_chunk = require("./chunk-CZWwpsFl.cjs");
const require_frontmatter = require("./frontmatter-DJFwMZRB.cjs");
const require_active = require("./active-MGRSlbaM.cjs");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_fs_promises = require("node:fs/promises");
let node_crypto = require("node:crypto");
//#region src/cases/evidence.ts
function caseDir(caseId) {
	return node_path.default.join(require_active.activeCasesRoot(), caseId);
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
	return (0, node_crypto.createHash)("sha256").update(content).digest("hex");
}
async function appendToManifest(manifestPath, entry) {
	const existing = JSON.parse(await (0, node_fs_promises.readFile)(manifestPath, "utf8").catch(() => "{\"entries\":[]}"));
	existing.entries.push(entry);
	await (0, node_fs_promises.writeFile)(manifestPath, JSON.stringify(existing, null, 2) + "\n", { mode: 384 });
}
const EvidenceStore = {
	async append(caseId, input) {
		const dir = caseDir(caseId);
		const evidenceDir = node_path.default.join(dir, "evidence");
		await (0, node_fs_promises.mkdir)(evidenceDir, { recursive: true });
		const safeSource = sanitizeSource(input.source);
		const timestamp = formatTimestamp();
		let seq = 1;
		try {
			seq = (await (0, node_fs_promises.readdir)(evidenceDir)).filter((f) => f.endsWith(".md")).length + 1;
		} catch {
			seq = 1;
		}
		const seqStr = String(seq).padStart(3, "0");
		let filename = `${seqStr}_${safeSource}_${timestamp}.md`;
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const fileContent = require_frontmatter.serializeFrontmatter({
			id: `${caseId}_ev${seqStr}`,
			caseId,
			source: input.source,
			timestamp: now,
			queryParams: input.queryParams
		}, `## Evidence: ${input.source}\n\n**Source:** ${input.source}\n**Captured:** ${now}\n\n${formatEvidenceContent(input.content)}\n`);
		const filePath = node_path.default.join(evidenceDir, filename);
		try {
			await (0, node_fs_promises.writeFile)(filePath, fileContent, {
				mode: 384,
				flag: "wx"
			});
		} catch (err) {
			if (err.code === "EEXIST") {
				filename = `${seqStr}_${safeSource}_${timestamp}_${Math.random().toString(36).slice(2, 6)}.md`;
				await (0, node_fs_promises.writeFile)(node_path.default.join(evidenceDir, filename), fileContent, {
					mode: 384,
					flag: "wx"
				});
			} else throw err;
		}
		const sha256 = hashContent(fileContent);
		await appendToManifest(node_path.default.join(dir, "manifest.json"), {
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
		const manifestPath = node_path.default.join(dir, "manifest.json");
		const manifest = JSON.parse(await (0, node_fs_promises.readFile)(manifestPath, "utf8").catch(() => "{\"entries\":[]}"));
		const tampered = [];
		for (const entry of manifest.entries) {
			const filePath = node_path.default.join(dir, "evidence", entry.file);
			try {
				if (hashContent(await (0, node_fs_promises.readFile)(filePath, "utf8")) !== entry.sha256) tampered.push(entry.file);
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
Object.defineProperty(exports, "EvidenceStore", {
	enumerable: true,
	get: function() {
		return EvidenceStore;
	}
});
