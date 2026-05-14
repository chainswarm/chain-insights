import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
import { Hono } from "hono";
//#region src/server/app.ts
async function findVizHtml(vizId) {
	const home = os.homedir();
	const filename = `${vizId}.html`;
	const centralPath = path.join(home, ".chain-insights", "viz", filename);
	try {
		return await readFile(centralPath, "utf-8");
	} catch {}
	const underscoreIdx = vizId.lastIndexOf("_");
	if (underscoreIdx > 0) {
		const possibleCaseId = vizId.substring(0, underscoreIdx);
		const casePath = path.join(home, ".chain-insights", "cases", possibleCaseId, "viz", filename);
		try {
			return await readFile(casePath, "utf-8");
		} catch {}
	}
	const casesDir = path.join(home, ".chain-insights", "cases");
	try {
		const cases = await readdir(casesDir);
		for (const caseId of cases) {
			const casePath = path.join(casesDir, caseId, "viz", filename);
			try {
				return await readFile(casePath, "utf-8");
			} catch {}
		}
	} catch {}
	return null;
}
function createApp() {
	const app = new Hono();
	app.get("/health", (c) => c.json({
		ok: true,
		ts: Date.now()
	}));
	app.get("/status", async (c) => {
		const { healthCheck } = await import("./db--42Bc9og.mjs").then((n) => n.t);
		const db = await healthCheck();
		return c.json({
			database: db.ok ? "healthy" : "error",
			server: "running"
		});
	});
	app.get("/viz/:id", async (c) => {
		const id = c.req.param("id");
		if (!/^[a-zA-Z0-9_-]+$/.test(id)) return c.json({ error: "Invalid visualization ID" }, 400);
		const html = await findVizHtml(id);
		if (!html) return c.json({ error: "Visualization not found" }, 404);
		return c.html(html);
	});
	app.get("/artifacts/:artifactId/graph.json", async (c) => {
		const artifactId = c.req.param("artifactId");
		if (!/^[a-zA-Z0-9_-]+$/.test(artifactId)) return c.json({ error: "Invalid artifact ID" }, 400);
		const { loadConfig } = await import("./config-DNBuk81n.mjs").then((n) => n.t);
		const config = await loadConfig();
		const graphPath = path.join(config.dataDir, "artifacts", artifactId, "graph.json");
		try {
			const graph = await readFile(graphPath, "utf-8");
			return c.body(graph, 200, {
				"Content-Type": "application/json",
				"Access-Control-Allow-Origin": "*"
			});
		} catch {
			return c.json({ error: "Graph artifact not found" }, 404);
		}
	});
	app.onError((err, c) => {
		console.error(err);
		return c.json({ error: "Internal server error" }, 500);
	});
	return app;
}
//#endregion
export { createApp as t };

//# sourceMappingURL=app-BMbUyLLI.mjs.map