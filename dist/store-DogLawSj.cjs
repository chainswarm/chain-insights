const require_chunk = require("./chunk-DakpK96I.cjs");
const require_frontmatter = require("./frontmatter-Dvqa5HX6.cjs");
const require_output_root = require("./output-root-YIbl6PwF.cjs");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_fs_promises = require("node:fs/promises");
let zod = require("zod");
zod = require_chunk.__toESM(zod, 1);
//#region src/cases/schema.ts
const caseIdRegex = /^\d{8}_\d{3}_[a-z0-9][a-z0-9-]*$/;
const CaseStatusEnum = zod.enum([
	"open",
	"active",
	"suspended",
	"closed"
]);
const CaseSchema = zod.object({
	id: zod.string().regex(caseIdRegex, "Invalid case ID format"),
	name: zod.string().min(1).max(200),
	status: CaseStatusEnum.default("open"),
	created: zod.string().datetime(),
	updated: zod.string().datetime(),
	tags: zod.array(zod.string()).default([]),
	description: zod.string().default(""),
	slug: zod.string().optional()
});
zod.object({
	id: zod.string().min(1),
	caseId: zod.string().regex(caseIdRegex),
	source: zod.string().min(1),
	timestamp: zod.string().datetime(),
	queryParams: zod.string().default("")
});
zod.object({
	address: zod.string().min(1).max(100),
	type: zod.enum([
		"eoa",
		"contract",
		"exchange",
		"mixer",
		"unknown"
	]).default("unknown"),
	firstSeen: zod.string().datetime(),
	lastSeen: zod.string().datetime(),
	riskTags: zod.string().default("")
});
zod.object({
	sessionId: zod.string().min(1),
	caseId: zod.string().regex(caseIdRegex),
	startTime: zod.string().datetime(),
	endTime: zod.string().optional(),
	status: zod.enum(["active", "ended"]).default("active")
});
//#endregion
//#region src/cases/store.ts
const casesRoot = () => require_output_root.workspaceOutputPaths().casesRoot;
function caseDir(id) {
	return node_path.default.join(casesRoot(), id);
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
		await (0, node_fs_promises.mkdir)(root, { recursive: true });
		const existingIds = await (0, node_fs_promises.readdir)(root).catch(() => []);
		const id = generateCaseId(input.name, existingIds);
		const slug = id.split("_").slice(2).join("_");
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const tags = input.tags;
		const dir = caseDir(id);
		await (0, node_fs_promises.mkdir)(node_path.default.join(dir, "evidence"), { recursive: true });
		await (0, node_fs_promises.mkdir)(node_path.default.join(dir, "dossiers"), { recursive: true });
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
		await (0, node_fs_promises.writeFile)(node_path.default.join(dir, "case.md"), require_frontmatter.serializeFrontmatter(fm, body), { mode: 384 });
		const manifest = JSON.stringify({
			caseId: id,
			entries: []
		}, null, 2) + "\n";
		await (0, node_fs_promises.writeFile)(node_path.default.join(dir, "manifest.json"), manifest, { mode: 384 });
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
		const filePath = node_path.default.join(dir, "case.md");
		const { frontmatter, body } = require_frontmatter.parseFrontmatter(await (0, node_fs_promises.readFile)(filePath, "utf8"));
		const now = (/* @__PURE__ */ new Date()).toISOString();
		frontmatter["status"] = status;
		frontmatter["updated"] = now;
		await (0, node_fs_promises.writeFile)(filePath, require_frontmatter.serializeFrontmatter(frontmatter, body), { mode: 384 });
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
			const ids = await (0, node_fs_promises.readdir)(root);
			const cases = [];
			for (const id of ids) try {
				const { frontmatter } = require_frontmatter.parseFrontmatter(await (0, node_fs_promises.readFile)(node_path.default.join(caseDir(id), "case.md"), "utf8"));
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
		const { frontmatter } = require_frontmatter.parseFrontmatter(await (0, node_fs_promises.readFile)(node_path.default.join(dir, "case.md"), "utf8"));
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
		const { frontmatter } = require_frontmatter.parseFrontmatter(await (0, node_fs_promises.readFile)(node_path.default.join(dir, "case.md"), "utf8"));
		const tags = (frontmatter["tags"] ?? "").split(",").filter(Boolean);
		const { SessionStore } = await Promise.resolve().then(() => require("./session-DwyikazY.cjs"));
		const { DossierStore } = await Promise.resolve().then(() => require("./dossier-Br62hCG7.cjs"));
		const [latestSession, dossierSummaries, manifest] = await Promise.all([
			SessionStore.getLatest(id),
			DossierStore.listSummaries(id),
			(0, node_fs_promises.readFile)(node_path.default.join(dir, "manifest.json"), "utf8").catch(() => "{\"entries\":[]}")
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
exports.CaseSchema = CaseSchema;
exports.CaseStatusEnum = CaseStatusEnum;
exports.CaseStore = CaseStore;
exports.casesRoot = casesRoot;
exports.generateCaseId = generateCaseId;
