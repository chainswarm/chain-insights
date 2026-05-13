const require_chunk = require("./chunk-CZWwpsFl.cjs");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_fs_promises = require("node:fs/promises");
let node_os = require("node:os");
node_os = require_chunk.__toESM(node_os, 1);
let hono = require("hono");
//#region src/server/app.ts
async function findVizHtml(vizId) {
	const home = node_os.default.homedir();
	const filename = `${vizId}.html`;
	const centralPath = node_path.default.join(home, ".chain-insights", "viz", filename);
	try {
		return await (0, node_fs_promises.readFile)(centralPath, "utf-8");
	} catch {}
	const underscoreIdx = vizId.lastIndexOf("_");
	if (underscoreIdx > 0) {
		const possibleCaseId = vizId.substring(0, underscoreIdx);
		const casePath = node_path.default.join(home, ".chain-insights", "cases", possibleCaseId, "viz", filename);
		try {
			return await (0, node_fs_promises.readFile)(casePath, "utf-8");
		} catch {}
	}
	const casesDir = node_path.default.join(home, ".chain-insights", "cases");
	try {
		const cases = await (0, node_fs_promises.readdir)(casesDir);
		for (const caseId of cases) {
			const casePath = node_path.default.join(casesDir, caseId, "viz", filename);
			try {
				return await (0, node_fs_promises.readFile)(casePath, "utf-8");
			} catch {}
		}
	} catch {}
	return null;
}
function createApp() {
	const app = new hono.Hono();
	app.get("/health", (c) => c.json({
		ok: true,
		ts: Date.now()
	}));
	app.get("/status", async (c) => {
		const { healthCheck } = await Promise.resolve().then(() => require("./db-UbTrO2bk.cjs")).then((n) => n.db_exports);
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
		const { loadConfig } = await Promise.resolve().then(() => require("./config-CIJ9gahy.cjs")).then((n) => n.config_exports);
		const config = await loadConfig();
		const graphPath = node_path.default.join(config.dataDir, "artifacts", artifactId, "graph.json");
		try {
			const graph = await (0, node_fs_promises.readFile)(graphPath, "utf-8");
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
Object.defineProperty(exports, "createApp", {
	enumerable: true,
	get: function() {
		return createApp;
	}
});
