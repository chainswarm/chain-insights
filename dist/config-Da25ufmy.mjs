import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import * as z from "zod";
//#region src/config/schema.ts
const ConfigSchema = z.object({
	mcpEndpoint: z.string().url().default("http://localhost:4000"),
	mcpAuthToken: z.string().optional(),
	walletAddress: z.string().optional(),
	serverPort: z.number().int().min(1024).max(65535).default(4321),
	dataDir: z.string().default(path.join(os.homedir(), ".chain-insights")),
	version: z.string().default("1")
});
const DEFAULT_CONFIG = ConfigSchema.parse({});
//#endregion
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

//# sourceMappingURL=config-Da25ufmy.mjs.map