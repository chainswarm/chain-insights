const require_chunk = require("./chunk-CZWwpsFl.cjs");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_fs_promises = require("node:fs/promises");
let node_os = require("node:os");
node_os = require_chunk.__toESM(node_os, 1);
//#region src/mcp/schema-cache.ts
const TTL_MS = 1440 * 60 * 1e3;
function schemaPath() {
	return node_path.default.join(node_os.default.homedir(), ".chain-insights", "mcp-schema.json");
}
async function loadSchema() {
	try {
		const raw = await (0, node_fs_promises.readFile)(schemaPath(), "utf8");
		const cache = JSON.parse(raw);
		if (Date.now() - cache.cachedAt > TTL_MS) return null;
		return cache.tools;
	} catch (err) {
		if (err.code === "ENOENT") return null;
		throw err;
	}
}
async function saveSchema(tools) {
	const p = schemaPath();
	await (0, node_fs_promises.mkdir)(node_path.default.dirname(p), { recursive: true });
	await (0, node_fs_promises.writeFile)(p, JSON.stringify({
		tools,
		cachedAt: Date.now()
	}, null, 2) + "\n", { mode: 384 });
}
//#endregion
exports.loadSchema = loadSchema;
exports.saveSchema = saveSchema;
