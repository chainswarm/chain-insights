const require_chunk = require("./chunk-CZWwpsFl.cjs");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_fs_promises = require("node:fs/promises");
let node_os = require("node:os");
node_os = require_chunk.__toESM(node_os, 1);
let hono = require("hono");
let _hono_node_server = require("@hono/node-server");
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
		const { healthCheck } = await Promise.resolve().then(() => require("./db-BwXWiDLe.cjs")).then((n) => n.db_exports);
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
	app.onError((err, c) => {
		console.error(err);
		return c.json({ error: "Internal server error" }, 500);
	});
	return app;
}
//#endregion
//#region src/server/index.ts
var server_exports = /* @__PURE__ */ require_chunk.__exportAll({ startServer: () => startServer });
function startServer(port = 4321) {
	const server = (0, _hono_node_server.serve)({
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
Object.defineProperty(exports, "createApp", {
	enumerable: true,
	get: function() {
		return createApp;
	}
});
Object.defineProperty(exports, "server_exports", {
	enumerable: true,
	get: function() {
		return server_exports;
	}
});
Object.defineProperty(exports, "startServer", {
	enumerable: true,
	get: function() {
		return startServer;
	}
});
