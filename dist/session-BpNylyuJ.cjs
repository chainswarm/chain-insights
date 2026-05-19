const require_chunk = require("./chunk-CZWwpsFl.cjs");
const require_frontmatter = require("./frontmatter-DgAuai7E.cjs");
const require_output_root = require("./output-root-CFYms3ad.cjs");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_fs_promises = require("node:fs/promises");
//#region src/cases/session.ts
function caseDir(caseId) {
	return node_path.default.join(require_output_root.workspaceOutputPaths().casesRoot, caseId);
}
const MAX_SESSIONS = 5;
function sessionNumber(filename) {
	return parseInt(filename.replace("session_", "").replace(".md", ""), 10);
}
function sessionFromFrontmatter(frontmatter) {
	return {
		sessionId: frontmatter["sessionId"] ?? "",
		caseId: frontmatter["caseId"] ?? "",
		startTime: frontmatter["startTime"] ?? (/* @__PURE__ */ new Date()).toISOString(),
		endTime: frontmatter["endTime"] || void 0,
		status: frontmatter["status"] === "ended" ? "ended" : "active"
	};
}
async function listSessionFiles(dir) {
	return (await (0, node_fs_promises.readdir)(dir)).filter((f) => f.match(/^session_\d+\.md$/)).sort((a, b) => sessionNumber(b) - sessionNumber(a));
}
const SessionStore = {
	async start(caseId, input = {}) {
		const dir = caseDir(caseId);
		let sessionFiles = [];
		try {
			sessionFiles = await listSessionFiles(dir);
		} catch {
			sessionFiles = [];
		}
		for (const filename of sessionFiles) {
			const { frontmatter } = require_frontmatter.parseFrontmatter(await (0, node_fs_promises.readFile)(node_path.default.join(dir, filename), "utf8"));
			if (frontmatter["status"] !== "ended") return sessionFromFrontmatter(frontmatter);
		}
		const seq = sessionFiles.length + 1;
		const seqStr = String(seq).padStart(3, "0");
		const filename = `session_${seqStr}.md`;
		const sessionId = `${caseId}_s${seqStr}`;
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const title = input.title?.trim();
		const fm = {
			sessionId,
			caseId,
			startTime: now,
			endTime: "",
			status: "active"
		};
		if (title) fm["title"] = title;
		const body = `# Session ${seq}: ${title || now.slice(0, 10)}\n\n## Investigation Log\n\n## Key Findings\n\n## Next Steps\n\n`;
		await (0, node_fs_promises.writeFile)(node_path.default.join(dir, filename), require_frontmatter.serializeFrontmatter(fm, body), { mode: 384 });
		return {
			sessionId,
			caseId,
			startTime: now,
			status: "active"
		};
	},
	async end(caseId, input) {
		const dir = caseDir(caseId);
		const sessionFiles = await listSessionFiles(dir);
		if (sessionFiles.length === 0) throw new Error(`No active session for case ${caseId}`);
		let activeFile = null;
		let activeFrontmatter = null;
		let activeBody = "";
		for (const filename of sessionFiles) {
			const { frontmatter, body } = require_frontmatter.parseFrontmatter(await (0, node_fs_promises.readFile)(node_path.default.join(dir, filename), "utf8"));
			if (frontmatter["status"] !== "ended") {
				activeFile = filename;
				activeFrontmatter = frontmatter;
				activeBody = body;
				break;
			}
		}
		if (!activeFile || !activeFrontmatter) throw new Error(`No active session for case ${caseId}`);
		const now = (/* @__PURE__ */ new Date()).toISOString();
		activeFrontmatter["endTime"] = now;
		activeFrontmatter["status"] = "ended";
		const updatedBody = activeBody.replace("## Key Findings\n", `## Key Findings\n\n${input.findings}\n`).replace("## Next Steps\n", `## Next Steps\n\n${input.nextSteps}\n`);
		await (0, node_fs_promises.writeFile)(node_path.default.join(dir, activeFile), require_frontmatter.serializeFrontmatter(activeFrontmatter, updatedBody), { mode: 384 });
	},
	async getLatest(caseId) {
		const dir = caseDir(caseId);
		try {
			const sessionFiles = await listSessionFiles(dir);
			if (sessionFiles.length === 0) return null;
			return require_frontmatter.parseFrontmatter(await (0, node_fs_promises.readFile)(node_path.default.join(dir, sessionFiles[0]), "utf8"));
		} catch {
			return null;
		}
	},
	async archiveOldSessions(caseId) {
		const dir = caseDir(caseId);
		const sessionFiles = (await listSessionFiles(dir)).reverse();
		if (sessionFiles.length <= MAX_SESSIONS) return;
		const toArchive = sessionFiles.slice(0, sessionFiles.length - MAX_SESSIONS);
		const historyPath = node_path.default.join(dir, "history.md");
		const existingHistory = await (0, node_fs_promises.readFile)(historyPath, "utf8").catch(() => "");
		const summaries = [];
		for (const filename of toArchive) {
			const { frontmatter, body } = require_frontmatter.parseFrontmatter(await (0, node_fs_promises.readFile)(node_path.default.join(dir, filename), "utf8"));
			const findingsMatch = body.match(/## Key Findings\n+([\s\S]*?)(?:\n## |$)/);
			const findings = findingsMatch ? findingsMatch[1].trim() : "(no findings recorded)";
			summaries.push(`### ${frontmatter["sessionId"] ?? filename} (${frontmatter["startTime"] ?? ""})\n\n${findings}\n`);
		}
		await (0, node_fs_promises.writeFile)(historyPath, existingHistory + "\n" + summaries.join("\n") + "\n", { mode: 384 });
		for (const filename of toArchive) await (0, node_fs_promises.rm)(node_path.default.join(dir, filename));
	}
};
//#endregion
exports.SessionStore = SessionStore;
