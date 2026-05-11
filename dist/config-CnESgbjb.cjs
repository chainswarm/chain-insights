const require_chunk = require("./chunk-CZWwpsFl.cjs");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_fs_promises = require("node:fs/promises");
let node_os = require("node:os");
node_os = require_chunk.__toESM(node_os, 1);
let zod = require("zod");
zod = require_chunk.__toESM(zod, 1);
//#region src/config/schema.ts
const ConfigSchema = zod.object({
	mcpEndpoint: zod.string().url().default("http://localhost:4000"),
	mcpAuthToken: zod.string().optional(),
	walletAddress: zod.string().optional(),
	serverPort: zod.number().int().min(1024).max(65535).default(4321),
	dataDir: zod.string().default(node_path.default.join(node_os.default.homedir(), ".chain-insights")),
	version: zod.string().default("1")
});
const DEFAULT_CONFIG = ConfigSchema.parse({});
//#endregion
//#region src/config/index.ts
var config_exports = /* @__PURE__ */ require_chunk.__exportAll({
	loadConfig: () => loadConfig,
	resetConfigCache: () => resetConfigCache,
	saveConfig: () => saveConfig
});
function configPath() {
	return node_path.default.join(node_os.default.homedir(), ".chain-insights", "config.json");
}
let _cached = null;
async function loadConfig() {
	if (_cached) return _cached;
	try {
		const raw = await (0, node_fs_promises.readFile)(configPath(), "utf8");
		const parsed = JSON.parse(raw);
		_cached = ConfigSchema.parse(parsed);
		return _cached;
	} catch {
		return DEFAULT_CONFIG;
	}
}
async function saveConfig(updates) {
	const current = await loadConfig();
	const next = ConfigSchema.parse({
		...current,
		...updates
	});
	const p = configPath();
	await (0, node_fs_promises.mkdir)(node_path.default.dirname(p), { recursive: true });
	await (0, node_fs_promises.writeFile)(p, JSON.stringify(next, null, 2) + "\n", { mode: 384 });
	_cached = next;
}
async function resetConfigCache() {
	_cached = null;
}
//#endregion
Object.defineProperty(exports, "config_exports", {
	enumerable: true,
	get: function() {
		return config_exports;
	}
});
Object.defineProperty(exports, "loadConfig", {
	enumerable: true,
	get: function() {
		return loadConfig;
	}
});
Object.defineProperty(exports, "resetConfigCache", {
	enumerable: true,
	get: function() {
		return resetConfigCache;
	}
});
Object.defineProperty(exports, "saveConfig", {
	enumerable: true,
	get: function() {
		return saveConfig;
	}
});
