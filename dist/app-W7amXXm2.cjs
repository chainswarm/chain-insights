const require_chunk = require("./chunk-CZWwpsFl.cjs");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_fs_promises = require("node:fs/promises");
let node_os = require("node:os");
node_os = require_chunk.__toESM(node_os, 1);
let hono = require("hono");
//#region src/server/app.ts
const WORKSPACE_TREE_ROOTS = [
	"cases",
	"reports",
	".chain-insights/schema"
];
const WORKSPACE_TREE_MAX_DEPTH = 4;
function withinRoot(root, target) {
	const relative = node_path.default.relative(node_path.default.resolve(root), node_path.default.resolve(target));
	return relative === "" || !relative.startsWith("..") && !node_path.default.isAbsolute(relative);
}
async function realPathWithinRoot(root, target) {
	try {
		const [realRoot, realTarget] = await Promise.all([(0, node_fs_promises.realpath)(root), (0, node_fs_promises.realpath)(target)]);
		return withinRoot(realRoot, realTarget);
	} catch {
		return false;
	}
}
function toWorkspaceRelative(root, target) {
	return node_path.default.relative(root, target).split(node_path.default.sep).join("/");
}
async function listWorkspaceEntries(workspaceRoot, roots = WORKSPACE_TREE_ROOTS, maxDepth = WORKSPACE_TREE_MAX_DEPTH) {
	const entries = [];
	const root = node_path.default.resolve(workspaceRoot);
	async function visit(target, depth) {
		const resolved = node_path.default.resolve(target);
		if (!withinRoot(root, resolved)) return;
		let info;
		try {
			info = await (0, node_fs_promises.lstat)(resolved);
		} catch {
			return;
		}
		const type = info.isSymbolicLink() ? "symlink" : info.isDirectory() ? "directory" : info.isFile() ? "file" : null;
		if (!type) return;
		const entry = {
			path: toWorkspaceRelative(root, resolved),
			type
		};
		if (type === "file") entry.size = info.size;
		entries.push(entry);
		if (type !== "directory" || depth >= maxDepth) return;
		if (!await realPathWithinRoot(root, resolved)) return;
		let children;
		try {
			children = await (0, node_fs_promises.readdir)(resolved);
		} catch {
			return;
		}
		for (const child of children.sort()) await visit(node_path.default.join(resolved, child), depth + 1);
	}
	for (const rootName of roots) {
		const target = node_path.default.resolve(root, rootName);
		if (withinRoot(root, target)) await visit(target, 0);
	}
	return entries;
}
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
function isSafeGraphReportFilename(filename) {
	return filename.endsWith(".graph.json") && /^[A-Za-z0-9._-]+$/.test(filename) && !filename.includes("..") && !filename.includes("/") && !filename.includes("\\");
}
function createApp() {
	const app = new hono.Hono();
	app.get("/health", (c) => c.json({
		ok: true,
		ts: Date.now()
	}));
	app.get("/status", async (c) => {
		const { loadConfig } = await Promise.resolve().then(() => require("./config-DZLKT7fl.cjs")).then((n) => n.config_exports);
		const config = await loadConfig();
		return c.json({
			dataDir: config.dataDir,
			graphMcpMode: config.graphMcpMode,
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
	app.get("/graph-reports/:filename", async (c) => {
		const filename = c.req.param("filename");
		if (!isSafeGraphReportFilename(filename)) return c.json({ error: "Invalid graph report filename" }, 400);
		const { workspaceOutputPaths } = await Promise.resolve().then(() => require("./output-root-DZV1UJDb.cjs")).then((n) => n.output_root_exports);
		const paths = workspaceOutputPaths();
		const graphPath = node_path.default.resolve(paths.reportGraphsRoot, filename);
		if (!withinRoot(paths.reportGraphsRoot, graphPath)) return c.json({ error: "Invalid graph report filename" }, 400);
		if (!await realPathWithinRoot(paths.reportGraphsRoot, graphPath)) return c.json({ error: "Graph report not found" }, 404);
		try {
			const graph = await (0, node_fs_promises.readFile)(graphPath, "utf-8");
			return c.body(graph, 200, {
				"Content-Type": "application/json",
				"Access-Control-Allow-Origin": "*"
			});
		} catch {
			return c.json({ error: "Graph report not found" }, 404);
		}
	});
	app.get("/graph-reports/*", (c) => {
		return c.json({ error: "Invalid graph report filename" }, 400);
	});
	app.get("/workspace/tree", async (c) => {
		const { workspaceOutputPaths } = await Promise.resolve().then(() => require("./output-root-DZV1UJDb.cjs")).then((n) => n.output_root_exports);
		const paths = workspaceOutputPaths();
		const entries = await listWorkspaceEntries(paths.root, WORKSPACE_TREE_ROOTS);
		return c.json({
			schema: "chain-insights.workspace-tree.v1",
			root: paths.root,
			entries
		});
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
