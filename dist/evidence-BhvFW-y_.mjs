import { n as serializeFrontmatter } from "./frontmatter-D8wWCeOa.mjs";
import { n as workspaceOutputPaths } from "./output-root-CmWM7aV2.mjs";
import path from "node:path";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
//#region src/cases/evidence.ts
const MAX_INLINE_JSON_BYTES = 8 * 1024;
function caseDir(caseId) {
	return path.join(workspaceOutputPaths().casesRoot, caseId);
}
function sanitizeSource(source) {
	return source.replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
}
function formatTimestamp() {
	return (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "").slice(0, 15);
}
function parseJsonContent(content) {
	const trimmed = content.trim();
	if (trimmed.startsWith("```")) return null;
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
	try {
		return JSON.parse(trimmed);
	} catch {
		return null;
	}
}
function compactJsonValue(value) {
	if (Array.isArray(value)) return value.map(compactJsonValue);
	if (!value || typeof value !== "object") return value;
	const compact = {};
	for (const [key, entry] of Object.entries(value)) {
		if (entry === null || entry === void 0) continue;
		compact[key] = compactJsonValue(entry);
	}
	return compact;
}
function summarizeJsonValue(value) {
	if (Array.isArray(value)) return {
		kind: "array",
		count: value.length,
		sample: value.slice(0, 3).map(compactJsonValue)
	};
	if (!value || typeof value !== "object") return {
		kind: typeof value,
		value
	};
	const record = compactJsonValue(value);
	const summary = {
		kind: "object",
		keys: Object.keys(record).slice(0, 50)
	};
	for (const key of [
		"schema",
		"source",
		"tool",
		"network",
		"seed_address",
		"address"
	]) if (typeof record[key] === "string") summary[key] = record[key];
	for (const key of [
		"files",
		"outputs",
		"facts"
	]) {
		const entry = record[key];
		if (entry && typeof entry === "object" && !Array.isArray(entry)) summary[key] = compactJsonValue(entry);
	}
	const counts = Object.fromEntries(Object.entries(record).filter(([, entry]) => Array.isArray(entry)).map(([key, entry]) => [key, entry.length]));
	if (Object.keys(counts).length > 0) summary["array_counts"] = counts;
	return summary;
}
async function formatEvidenceContent(evidenceId, source, timestamp, content) {
	const parsedJson = parseJsonContent(content);
	if (parsedJson === null) return content;
	const compactJson = compactJsonValue(parsedJson);
	const prettyJson = JSON.stringify(compactJson, null, 2);
	if (Buffer.byteLength(prettyJson, "utf8") <= MAX_INLINE_JSON_BYTES) return `\`\`\`json\n${prettyJson}\n\`\`\``;
	const paths = workspaceOutputPaths();
	await mkdir(paths.reportTablesRoot, {
		recursive: true,
		mode: 448
	});
	const tableFilename = `${evidenceId}_${sanitizeSource(source) || "evidence"}_${timestamp}_${Math.random().toString(36).slice(2, 8)}.json`;
	const tablePath = path.join(paths.reportTablesRoot, tableFilename);
	await writeFile(tablePath, prettyJson + "\n", {
		mode: 384,
		flag: "wx"
	});
	const relativeTablePath = path.relative(paths.root, tablePath);
	const summary = {
		schema: "chain-insights.evidence_summary.v1",
		omitted_inline_json: true,
		stored_json: relativeTablePath,
		summary: summarizeJsonValue(compactJson)
	};
	return [
		"Large JSON evidence was stored as an analyst table extract instead of inline Markdown.",
		"",
		`Stored JSON: \`${relativeTablePath}\``,
		"",
		"```json",
		JSON.stringify(summary, null, 2),
		"```"
	].join("\n");
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
		const fm = {
			id: `${caseId}_ev${seqStr}`,
			caseId,
			source: input.source,
			timestamp: now,
			queryParams: input.queryParams
		};
		const formattedContent = await formatEvidenceContent(`${caseId}_ev${seqStr}`, input.source, timestamp, input.content);
		const fileContent = serializeFrontmatter(fm, [
			`## Evidence: ${input.source}`,
			"",
			`**Source:** ${input.source}`,
			`**Captured:** ${now}`,
			"",
			formattedContent,
			""
		].join("\n"));
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

//# sourceMappingURL=evidence-BhvFW-y_.mjs.map