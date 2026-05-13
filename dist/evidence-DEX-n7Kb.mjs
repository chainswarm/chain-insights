import { t as getDb } from "./init-SohRr-mY.mjs";
import { n as serializeFrontmatter, t as parseFrontmatter } from "./frontmatter-BfJFcKKU.mjs";
import path from "node:path";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import * as z from "zod";
import { createHash } from "node:crypto";
//#region src/cases/schema.ts
const caseIdRegex = /^\d{8}_\d{3}_[a-z0-9][a-z0-9-]*$/;
const CaseStatusEnum = z.enum([
	"open",
	"active",
	"suspended",
	"closed"
]);
const CaseSchema = z.object({
	id: z.string().regex(caseIdRegex, "Invalid case ID format"),
	name: z.string().min(1).max(200),
	status: CaseStatusEnum.default("open"),
	created: z.string().datetime(),
	updated: z.string().datetime(),
	tags: z.array(z.string()).default([]),
	description: z.string().default(""),
	slug: z.string().optional()
});
z.object({
	id: z.string().min(1),
	caseId: z.string().regex(caseIdRegex),
	source: z.string().min(1),
	timestamp: z.string().datetime(),
	queryParams: z.string().default("")
});
z.object({
	address: z.string().min(1).max(100),
	type: z.enum([
		"eoa",
		"contract",
		"exchange",
		"mixer",
		"unknown"
	]).default("unknown"),
	firstSeen: z.string().datetime(),
	lastSeen: z.string().datetime(),
	riskTags: z.string().default("")
});
z.object({
	sessionId: z.string().min(1),
	caseId: z.string().regex(caseIdRegex),
	startTime: z.string().datetime(),
	endTime: z.string().optional(),
	status: z.enum(["active", "ended"]).default("active")
});
//#endregion
//#region src/cases/store.ts
function casesRoot() {
	return path.join(os.homedir(), ".chain-insights", "cases");
}
function caseDir$1(id) {
	return path.join(casesRoot(), id);
}
function generateCaseId(name, existingIds) {
	const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10).replace(/-/g, "");
	const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
	const todayNums = existingIds.filter((id) => id.startsWith(date + "_")).map((id) => parseInt(id.split("_")[1] ?? "0", 10)).filter((n) => !isNaN(n));
	const next = todayNums.length > 0 ? Math.max(...todayNums) + 1 : 1;
	return `${date}_${String(next).padStart(3, "0")}_${slug}`;
}
const CaseStore = {
	async create(input) {
		const conn = await getDb();
		try {
			const existingIds = (await conn.runAndReadAll("SELECT id FROM cases")).getRows().map((row) => row[0]);
			const id = generateCaseId(input.name, existingIds);
			const slug = id.split("_").slice(2).join("_");
			const now = (/* @__PURE__ */ new Date()).toISOString();
			const tags = input.tags;
			const dir = caseDir$1(id);
			await mkdir(path.join(dir, "evidence"), { recursive: true });
			await mkdir(path.join(dir, "dossiers"), { recursive: true });
			const fm = {
				id,
				name: input.name,
				status: "open",
				created: now,
				updated: now,
				tags: tags.join(","),
				description: input.description,
				slug
			};
			const body = `# ${input.name}\n\n*Opened: ${now}*\n\nInvestigation notes added here by agent.\n`;
			await writeFile(path.join(dir, "case.md"), serializeFrontmatter(fm, body), { mode: 384 });
			const manifest = JSON.stringify({
				caseId: id,
				entries: []
			}, null, 2) + "\n";
			await writeFile(path.join(dir, "manifest.json"), manifest, { mode: 384 });
			const stmt = await conn.prepare("INSERT INTO cases (id, name, status, created_at, updated_at, tags, description, slug) VALUES ($id, $name, $status, $created_at, $updated_at, $tags, $description, $slug)");
			await stmt.bind({
				id,
				name: input.name,
				status: "open",
				created_at: now,
				updated_at: now,
				tags: tags.join(","),
				description: input.description,
				slug
			});
			await stmt.run();
			stmt.destroySync();
			return CaseSchema.parse({
				id,
				name: input.name,
				status: "open",
				created: now,
				updated: now,
				tags,
				description: input.description,
				slug
			});
		} finally {
			conn.closeSync();
		}
	},
	async setStatus(id, status) {
		const dir = caseDir$1(id);
		const filePath = path.join(dir, "case.md");
		const { frontmatter, body } = parseFrontmatter(await readFile(filePath, "utf8"));
		const now = (/* @__PURE__ */ new Date()).toISOString();
		frontmatter["status"] = status;
		frontmatter["updated"] = now;
		await writeFile(filePath, serializeFrontmatter(frontmatter, body), { mode: 384 });
		const conn = await getDb();
		try {
			const stmt = await conn.prepare("UPDATE cases SET status=$status, updated_at=$updated_at WHERE id=$id");
			await stmt.bind({
				status,
				updated_at: now,
				id
			});
			await stmt.run();
			stmt.destroySync();
		} finally {
			conn.closeSync();
		}
		const tags = (frontmatter["tags"] ?? "").split(",").filter(Boolean);
		return CaseSchema.parse({
			id,
			name: frontmatter["name"] ?? "",
			status,
			created: frontmatter["created"] ?? now,
			updated: now,
			tags,
			description: frontmatter["description"] ?? ""
		});
	},
	async list() {
		const conn = await getDb();
		try {
			return (await conn.runAndReadAll("SELECT id, name, status FROM cases ORDER BY created_at DESC")).getRows().map((row) => ({
				id: row[0],
				name: row[1],
				status: row[2]
			}));
		} finally {
			conn.closeSync();
		}
	},
	async get(id) {
		const dir = caseDir$1(id);
		const { frontmatter } = parseFrontmatter(await readFile(path.join(dir, "case.md"), "utf8"));
		const tags = (frontmatter["tags"] ?? "").split(",").filter(Boolean);
		return CaseSchema.parse({
			id,
			name: frontmatter["name"] ?? "",
			status: frontmatter["status"] ?? "open",
			created: frontmatter["created"] ?? (/* @__PURE__ */ new Date()).toISOString(),
			updated: frontmatter["updated"] ?? (/* @__PURE__ */ new Date()).toISOString(),
			tags,
			description: frontmatter["description"] ?? ""
		});
	},
	async loadContext(id) {
		const dir = caseDir$1(id);
		const { frontmatter } = parseFrontmatter(await readFile(path.join(dir, "case.md"), "utf8"));
		const tags = (frontmatter["tags"] ?? "").split(",").filter(Boolean);
		const { SessionStore } = await import("./session-CcZYH417.mjs");
		const { DossierStore } = await import("./dossier-DJJ3oboa.mjs");
		const [latestSession, dossierSummaries, manifest] = await Promise.all([
			SessionStore.getLatest(id),
			DossierStore.listSummaries(id),
			readFile(path.join(dir, "manifest.json"), "utf8").catch(() => "{\"entries\":[]}")
		]);
		const evidenceCount = JSON.parse(manifest).entries.length;
		const lastSession = latestSession ? {
			sessionId: latestSession.frontmatter["sessionId"] ?? "",
			startTime: latestSession.frontmatter["startTime"] ?? "",
			endTime: latestSession.frontmatter["endTime"] || void 0,
			body: latestSession.body
		} : null;
		return {
			case: {
				id,
				name: frontmatter["name"] ?? "",
				status: frontmatter["status"] ?? "open",
				created: frontmatter["created"] ?? "",
				updated: frontmatter["updated"] ?? "",
				tags
			},
			lastSession,
			dossierSummaries,
			evidenceCount
		};
	}
};
//#endregion
//#region src/cases/evidence.ts
function caseDir(caseId) {
	return path.join(os.homedir(), ".chain-insights", "cases", caseId);
}
function sanitizeSource(source) {
	return source.replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
}
function formatTimestamp() {
	return (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "").slice(0, 15);
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
		}, `## Evidence: ${input.source}\n\n**Source:** ${input.source}\n**Captured:** ${now}\n\n${input.content}\n`);
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
export { CaseStatusEnum as a, CaseSchema as i, CaseStore as n, generateCaseId as r, EvidenceStore as t };

//# sourceMappingURL=evidence-DEX-n7Kb.mjs.map