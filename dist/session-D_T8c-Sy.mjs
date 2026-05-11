import { n as serializeFrontmatter, t as parseFrontmatter } from "./frontmatter-D8wWCeOa.mjs";
import path from "node:path";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
//#region src/cases/session.ts
function caseDir(caseId) {
	return path.join(os.homedir(), ".chain-insights", "cases", caseId);
}
const MAX_SESSIONS = 5;
const SessionStore = {
	async start(caseId) {
		const dir = caseDir(caseId);
		let seq = 1;
		try {
			seq = (await readdir(dir)).filter((f) => f.match(/^session_\d+\.md$/)).length + 1;
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
		await writeFile(path.join(dir, filename), serializeFrontmatter(fm, body), { mode: 384 });
		return {
			sessionId,
			caseId,
			startTime: now,
			status: "active"
		};
	},
	async end(caseId, input) {
		const dir = caseDir(caseId);
		const sessionFiles = (await readdir(dir)).filter((f) => f.match(/^session_\d+\.md$/)).sort((a, b) => {
			const seqA = parseInt(a.replace("session_", "").replace(".md", ""), 10);
			return parseInt(b.replace("session_", "").replace(".md", ""), 10) - seqA;
		});
		if (sessionFiles.length === 0) throw new Error(`No active session for case ${caseId}`);
		const latestFile = sessionFiles[0];
		const filePath = path.join(dir, latestFile);
		const { frontmatter, body } = parseFrontmatter(await readFile(filePath, "utf8"));
		frontmatter["endTime"] = (/* @__PURE__ */ new Date()).toISOString();
		frontmatter["status"] = "ended";
		await writeFile(filePath, serializeFrontmatter(frontmatter, body.replace("## Key Findings\n", `## Key Findings\n\n${input.findings}\n`).replace("## Next Steps\n", `## Next Steps\n\n${input.nextSteps}\n`)), { mode: 384 });
	},
	async getLatest(caseId) {
		const dir = caseDir(caseId);
		try {
			const sessionFiles = (await readdir(dir)).filter((f) => f.match(/^session_\d+\.md$/)).sort((a, b) => {
				const seqA = parseInt(a.replace("session_", "").replace(".md", ""), 10);
				return parseInt(b.replace("session_", "").replace(".md", ""), 10) - seqA;
			});
			if (sessionFiles.length === 0) return null;
			return parseFrontmatter(await readFile(path.join(dir, sessionFiles[0]), "utf8"));
		} catch {
			return null;
		}
	},
	async archiveOldSessions(caseId) {
		const dir = caseDir(caseId);
		const sessionFiles = (await readdir(dir)).filter((f) => f.match(/^session_\d+\.md$/)).sort((a, b) => {
			return parseInt(a.replace("session_", "").replace(".md", ""), 10) - parseInt(b.replace("session_", "").replace(".md", ""), 10);
		});
		if (sessionFiles.length <= MAX_SESSIONS) return;
		const toArchive = sessionFiles.slice(0, sessionFiles.length - MAX_SESSIONS);
		const historyPath = path.join(dir, "history.md");
		const existingHistory = await readFile(historyPath, "utf8").catch(() => "");
		const summaries = [];
		for (const filename of toArchive) {
			const { frontmatter, body } = parseFrontmatter(await readFile(path.join(dir, filename), "utf8"));
			const findingsMatch = body.match(/## Key Findings\n+([\s\S]*?)(?:\n## |$)/);
			const findings = findingsMatch ? findingsMatch[1].trim() : "(no findings recorded)";
			summaries.push(`### ${frontmatter["sessionId"] ?? filename} (${frontmatter["startTime"] ?? ""})\n\n${findings}\n`);
		}
		await writeFile(historyPath, existingHistory + "\n" + summaries.join("\n") + "\n", { mode: 384 });
		for (const filename of toArchive) await rm(path.join(dir, filename));
	}
};
//#endregion
export { SessionStore };

//# sourceMappingURL=session-D_T8c-Sy.mjs.map