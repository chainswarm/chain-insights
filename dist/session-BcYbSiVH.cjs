const require_chunk = require("./chunk-CZWwpsFl.cjs");
const require_frontmatter = require("./frontmatter-DgAuai7E.cjs");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_fs_promises = require("node:fs/promises");
let node_os = require("node:os");
node_os = require_chunk.__toESM(node_os, 1);
//#region src/cases/session.ts
function caseDir(caseId) {
	return node_path.default.join(node_os.default.homedir(), ".chain-insights", "cases", caseId);
}
const MAX_SESSIONS = 5;
const SessionStore = {
	async start(caseId) {
		const dir = caseDir(caseId);
		let seq = 1;
		try {
			seq = (await (0, node_fs_promises.readdir)(dir)).filter((f) => f.match(/^session_\d+\.md$/)).length + 1;
		} catch {
			seq = 1;
		}
		const seqStr = String(seq).padStart(3, "0");
		const filename = `session_${seqStr}.md`;
		const sessionId = `${caseId}_s${seqStr}`;
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const fm = {
			sessionId,
			caseId,
			startTime: now,
			endTime: "",
			status: "active"
		};
		const body = `# Session ${seq}: ${now.slice(0, 10)}\n\n## Investigation Log\n\n## Key Findings\n\n## Next Steps\n\n`;
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
		const sessionFiles = (await (0, node_fs_promises.readdir)(dir)).filter((f) => f.match(/^session_\d+\.md$/)).sort((a, b) => {
			const seqA = parseInt(a.replace("session_", "").replace(".md", ""), 10);
			return parseInt(b.replace("session_", "").replace(".md", ""), 10) - seqA;
		});
		if (sessionFiles.length === 0) throw new Error(`No active session for case ${caseId}`);
		const latestFile = sessionFiles[0];
		const filePath = node_path.default.join(dir, latestFile);
		const { frontmatter, body } = require_frontmatter.parseFrontmatter(await (0, node_fs_promises.readFile)(filePath, "utf8"));
		frontmatter["endTime"] = (/* @__PURE__ */ new Date()).toISOString();
		frontmatter["status"] = "ended";
		await (0, node_fs_promises.writeFile)(filePath, require_frontmatter.serializeFrontmatter(frontmatter, body.replace("## Key Findings\n", `## Key Findings\n\n${input.findings}\n`).replace("## Next Steps\n", `## Next Steps\n\n${input.nextSteps}\n`)), { mode: 384 });
	},
	async getLatest(caseId) {
		const dir = caseDir(caseId);
		try {
			const sessionFiles = (await (0, node_fs_promises.readdir)(dir)).filter((f) => f.match(/^session_\d+\.md$/)).sort((a, b) => {
				const seqA = parseInt(a.replace("session_", "").replace(".md", ""), 10);
				return parseInt(b.replace("session_", "").replace(".md", ""), 10) - seqA;
			});
			if (sessionFiles.length === 0) return null;
			return require_frontmatter.parseFrontmatter(await (0, node_fs_promises.readFile)(node_path.default.join(dir, sessionFiles[0]), "utf8"));
		} catch {
			return null;
		}
	},
	async archiveOldSessions(caseId) {
		const dir = caseDir(caseId);
		const sessionFiles = (await (0, node_fs_promises.readdir)(dir)).filter((f) => f.match(/^session_\d+\.md$/)).sort((a, b) => {
			return parseInt(a.replace("session_", "").replace(".md", ""), 10) - parseInt(b.replace("session_", "").replace(".md", ""), 10);
		});
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
