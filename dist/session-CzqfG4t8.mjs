import { n as serializeFrontmatter, t as parseFrontmatter } from "./frontmatter-BfJFcKKU.mjs";
import { n as workspaceOutputPaths } from "./output-root-B3iHs14J.mjs";
import path from "node:path";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
//#region src/cases/session.ts
function caseDir(caseId) {
	return path.join(workspaceOutputPaths().casesRoot, caseId);
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
	return (await readdir(dir)).filter((f) => f.match(/^session_\d+\.md$/)).sort((a, b) => sessionNumber(b) - sessionNumber(a));
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
			const { frontmatter } = parseFrontmatter(await readFile(path.join(dir, filename), "utf8"));
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
		const sessionFiles = await listSessionFiles(dir);
		if (sessionFiles.length === 0) throw new Error(`No active session for case ${caseId}`);
		let activeFile = null;
		let activeFrontmatter = null;
		let activeBody = "";
		for (const filename of sessionFiles) {
			const { frontmatter, body } = parseFrontmatter(await readFile(path.join(dir, filename), "utf8"));
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
		await writeFile(path.join(dir, activeFile), serializeFrontmatter(activeFrontmatter, updatedBody), { mode: 384 });
	},
	async getLatest(caseId) {
		const dir = caseDir(caseId);
		try {
			const sessionFiles = await listSessionFiles(dir);
			if (sessionFiles.length === 0) return null;
			return parseFrontmatter(await readFile(path.join(dir, sessionFiles[0]), "utf8"));
		} catch {
			return null;
		}
	},
	async archiveOldSessions(caseId) {
		const dir = caseDir(caseId);
		const sessionFiles = (await listSessionFiles(dir)).reverse();
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

//# sourceMappingURL=session-CzqfG4t8.mjs.map