import { t as __exportAll } from "./rolldown-runtime-D7D4PA-g.mjs";
import { r as graphMcpEndpointEnvOverride } from "./mcp-endpoint-DHs1cRFH.mjs";
import { n as parseInvestigatorConfig, t as DEFAULT_CONFIG } from "./schema-BFEWhzg7.mjs";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
//#region src/config/index.ts
var config_exports = /* @__PURE__ */ __exportAll({
	loadConfig: () => loadConfig,
	resetConfigCache: () => resetConfigCache,
	saveConfig: () => saveConfig
});
function configPath() {
	return path.join(os.homedir(), ".chain-insights", "config.json");
}
let _cached = null;
function applyRuntimeEnvOverrides(config) {
	let graphMcpEndpoint;
	try {
		graphMcpEndpoint = graphMcpEndpointEnvOverride();
	} catch (err) {
		throw new Error(`Invalid configuration in environment: ${err.message}`);
	}
	return graphMcpEndpoint ? parseInvestigatorConfig({
		...config,
		graphMcpEndpoint
	}) : config;
}
async function loadStoredConfig() {
	const cfgPath = configPath();
	let raw;
	try {
		raw = await readFile(cfgPath, "utf8");
	} catch (err) {
		if (err.code === "ENOENT") return DEFAULT_CONFIG;
		throw new Error(`Unable to read config ${cfgPath}: ${err.message}`);
	}
	let parsedJson;
	try {
		parsedJson = JSON.parse(raw);
	} catch (err) {
		throw new Error(`Invalid JSON in ${cfgPath}: ${err.message}`);
	}
	try {
		return parseInvestigatorConfig(parsedJson);
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
		next = parseInvestigatorConfig({
			...current,
			...updates
		});
	} catch (err) {
		throw new Error(`Invalid configuration update: ${err.message}`);
	}
	const p = configPath();
	await mkdir(path.dirname(p), { recursive: true });
	await writeFile(p, JSON.stringify(next, null, 2) + "\n", { mode: 384 });
	_cached = applyRuntimeEnvOverrides(next);
}
async function resetConfigCache() {
	_cached = null;
}
//#endregion
export { saveConfig as i, loadConfig as n, resetConfigCache as r, config_exports as t };

//# sourceMappingURL=config-Drgc2HuF.mjs.map