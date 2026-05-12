import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
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
		const { loadConfig } = await import("./config-DTfloQyC.mjs").then((n) => n.t);
		const config = await loadConfig();
		const graphPath = path.join(config.dataDir, "artifacts", artifactId, "graph.json");
		try {
			const graph = await readFile(graphPath, "utf-8");
			return c.body(graph, 200, { "Content-Type": "application/json" });
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
//#region src/server/index.ts
var server_exports = /* @__PURE__ */ __exportAll({ startServer: () => startServer });
function startServer(port = 4321) {
	const server = serve({
		fetch: createApp().fetch,
		hostname: "127.0.0.1",
		port
	});
	console.log(`Chain Insights server running on http://127.0.0.1:${port}`);
	process.on("SIGINT", () => {
		server.close();
		process.exit(0);
	});
	process.on("SIGTERM", () => {
		server.close(() => process.exit(0));
	});
	return () => server.close();
}
//#endregion
export { startServer as n, createApp as r, server_exports as t };

//# sourceMappingURL=server-DJ2d61ug.mjs.map