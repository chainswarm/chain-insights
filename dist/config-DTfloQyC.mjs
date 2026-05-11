import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import { n as DEFAULT_CONFIG, t as ConfigSchema } from "./schema-C9S7hl_q.mjs";
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
async function loadConfig() {
	if (_cached) return _cached;
	try {
		const raw = await readFile(configPath(), "utf8");
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
	await mkdir(path.dirname(p), { recursive: true });
	await writeFile(p, JSON.stringify(next, null, 2) + "\n", { mode: 384 });
	_cached = next;
}
async function resetConfigCache() {
	_cached = null;
}
//#endregion
export { saveConfig as i, loadConfig as n, resetConfigCache as r, config_exports as t };

//# sourceMappingURL=config-DTfloQyC.mjs.map