import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
//#region src/mcp/schema-cache.ts
const TTL_MS = 1440 * 60 * 1e3;
function schemaPath() {
	return path.join(os.homedir(), ".chain-insights", "mcp-schema.json");
}
async function loadSchema(endpoint) {
	try {
		const raw = await readFile(schemaPath(), "utf8");
		const cache = JSON.parse(raw);
		if (Date.now() - cache.cachedAt > TTL_MS) return null;
		if (endpoint && cache.endpoint !== endpoint) return null;
		return cache.tools;
	} catch (err) {
		if (err.code === "ENOENT") return null;
		throw err;
	}
}
async function saveSchema(tools, endpoint) {
	const p = schemaPath();
	await mkdir(path.dirname(p), { recursive: true });
	const cache = {
		tools,
		cachedAt: Date.now(),
		...endpoint ? { endpoint } : {}
	};
	await writeFile(p, JSON.stringify(cache, null, 2) + "\n", { mode: 384 });
}
//#endregion
export { loadSchema, saveSchema };

//# sourceMappingURL=schema-cache-DwDvPy4e.mjs.map