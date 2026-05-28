const require_chunk = require("./chunk-DakpK96I.cjs");
const require_mcp_endpoint = require("./mcp-endpoint-BaV8h_lq.cjs");
const require_schema = require("./schema-Vl9yuOFO.cjs");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_fs_promises = require("node:fs/promises");
let node_os = require("node:os");
node_os = require_chunk.__toESM(node_os, 1);
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
function applyRuntimeEnvOverrides(config) {
	let graphMcpEndpoint;
	try {
		graphMcpEndpoint = require_mcp_endpoint.graphMcpEndpointEnvOverride();
	} catch (err) {
		throw new Error(`Invalid configuration in environment: ${err.message}`);
	}
	return graphMcpEndpoint ? require_schema.parseInvestigatorConfig({
		...config,
		graphMcpEndpoint
	}) : config;
}
async function loadStoredConfig() {
	const cfgPath = configPath();
	let raw;
	try {
		raw = await (0, node_fs_promises.readFile)(cfgPath, "utf8");
	} catch (err) {
		if (err.code === "ENOENT") return require_schema.DEFAULT_CONFIG;
		throw new Error(`Unable to read config ${cfgPath}: ${err.message}`);
	}
	let parsedJson;
	try {
		parsedJson = JSON.parse(raw);
	} catch (err) {
		throw new Error(`Invalid JSON in ${cfgPath}: ${err.message}`);
	}
	try {
		return require_schema.parseInvestigatorConfig(parsedJson);
	} catch (err) {
		throw new Error(`Invalid configuration in ${cfgPath}: ${err.message}`);
	}
}
async function loadConfig() {
	if (_cached) return _cached;
	_cached = applyRuntimeEnvOverrides(await loadStoredConfig());
	return _cached;
}
async function saveConfig(updates) {
	const current = await loadStoredConfig();
	let next;
	try {
		next = require_schema.parseInvestigatorConfig({
			...current,
			...updates
		});
	} catch (err) {
		throw new Error(`Invalid configuration update: ${err.message}`);
	}
	const p = configPath();
	await (0, node_fs_promises.mkdir)(node_path.default.dirname(p), { recursive: true });
	await (0, node_fs_promises.writeFile)(p, JSON.stringify(next, null, 2) + "\n", { mode: 384 });
	_cached = applyRuntimeEnvOverrides(next);
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
