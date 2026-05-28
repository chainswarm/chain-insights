import { n as serializeFrontmatter, t as parseFrontmatter } from "./frontmatter-D0ccQnUM.mjs";
import { n as workspaceOutputPaths } from "./output-root-BRhzhhXZ.mjs";
import path from "node:path";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import * as z from "zod";
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
const casesRoot = () => workspaceOutputPaths().casesRoot;
function caseDir(id) {
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
		const root = casesRoot();
		await mkdir(root, { recursive: true });
		const existingIds = await readdir(root).catch(() => []);
		const id = generateCaseId(input.name, existingIds);
		const slug = id.split("_").slice(2).join("_");
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const tags = input.tags;
		const dir = caseDir(id);
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
		const body = [
			`# ${input.name}`,
			"",
			`Opened: ${now}`,
			`Status: open`,
			"",
			"## Question",
			"",
			input.description || "TBD",
			"",
			"## Current Assessment",
			"",
			"TBD",
			"",
			"## Top Findings",
			"",
			"| Finding | Confidence | Evidence |",
			"|---|---:|---|",
			"",
			"## Next Actions",
			"",
			"- TBD",
			"",
			"## Reports",
			""
		].join("\n");
		await writeFile(path.join(dir, "case.md"), serializeFrontmatter(fm, body), { mode: 384 });
		const manifest = JSON.stringify({
			caseId: id,
			entries: []
		}, null, 2) + "\n";
		await writeFile(path.join(dir, "manifest.json"), manifest, { mode: 384 });
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
	},
	async setStatus(id, status) {
		const dir = caseDir(id);
		const filePath = path.join(dir, "case.md");
		const { frontmatter, body } = parseFrontmatter(await readFile(filePath, "utf8"));
		const now = (/* @__PURE__ */ new Date()).toISOString();
		frontmatter["status"] = status;
		frontmatter["updated"] = now;
		await writeFile(filePath, serializeFrontmatter(frontmatter, body), { mode: 384 });
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
		const root = casesRoot();
		try {
			const ids = await readdir(root);
			const cases = [];
			for (const id of ids) try {
				const { frontmatter } = parseFrontmatter(await readFile(path.join(caseDir(id), "case.md"), "utf8"));
				cases.push({
					id,
					name: frontmatter["name"] ?? id,
					status: frontmatter["status"] ?? "open",
					created: frontmatter["created"] ?? ""
				});
			} catch (err) {
				const nodeErr = err;
				if (nodeErr.code !== "ENOENT" && nodeErr.code !== "ENOTDIR") throw err;
			}
			return cases.sort((a, b) => b.created.localeCompare(a.created) || b.id.localeCompare(a.id)).map(({ id, name, status }) => ({
				id,
				name,
				status
			}));
		} catch (err) {
			if (err.code === "ENOENT") return [];
			throw err;
		}
	},
	async get(id) {
		const dir = caseDir(id);
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
		const dir = caseDir(id);
		const { frontmatter } = parseFrontmatter(await readFile(path.join(dir, "case.md"), "utf8"));
		const tags = (frontmatter["tags"] ?? "").split(",").filter(Boolean);
		const { SessionStore } = await import("./session-Bha3zFrx.mjs");
		const { DossierStore } = await import("./dossier-Bl0NkJKC.mjs");
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
export { CaseStore, casesRoot, generateCaseId, CaseStatusEnum as n, CaseSchema as t };

//# sourceMappingURL=store-BT2SCcQr.mjs.map