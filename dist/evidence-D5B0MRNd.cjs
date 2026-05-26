const require_chunk = require("./chunk-CZWwpsFl.cjs");
const require_frontmatter = require("./frontmatter-Bwg8tcBv.cjs");
const require_output_root = require("./output-root-HDoO9jk5.cjs");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_fs_promises = require("node:fs/promises");
let node_crypto = require("node:crypto");
//#region src/cases/evidence.ts
const MAX_INLINE_JSON_BYTES = 8 * 1024;
function caseDir(caseId) {
	return node_path.default.join(require_output_root.workspaceOutputPaths().casesRoot, caseId);
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
	const paths = require_output_root.workspaceOutputPaths();
	await (0, node_fs_promises.mkdir)(paths.reportTablesRoot, {
		recursive: true,
		mode: 448
	});
	const tableFilename = `${evidenceId}_${sanitizeSource(source) || "evidence"}_${timestamp}_${Math.random().toString(36).slice(2, 8)}.json`;
	const tablePath = node_path.default.join(paths.reportTablesRoot, tableFilename);
	await (0, node_fs_promises.writeFile)(tablePath, prettyJson + "\n", {
		mode: 384,
		flag: "wx"
	});
	const relativeTablePath = node_path.default.relative(paths.root, tablePath);
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
		const fm = {
			id: `${caseId}_ev${seqStr}`,
			caseId,
			source: input.source,
			timestamp: now,
			queryParams: input.queryParams
		};
		const formattedContent = await formatEvidenceContent(`${caseId}_ev${seqStr}`, input.source, timestamp, input.content);
		const fileContent = require_frontmatter.serializeFrontmatter(fm, [
			`## Evidence: ${input.source}`,
			"",
			`**Source:** ${input.source}`,
			`**Captured:** ${now}`,
			"",
			formattedContent,
			""
		].join("\n"));
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
