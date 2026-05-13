import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
//#region src/mcp/schema-cache.ts
const TTL_MS = 1440 * 60 * 1e3;
function schemaPath() {
	return path.join(os.homedir(), ".chain-insights", "mcp-schema.json");
}
async function loadSchema() {
	try {
		const raw = await readFile(schemaPath(), "utf8");
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
	await mkdir(path.dirname(p), { recursive: true });
	await writeFile(p, JSON.stringify({
		tools,
		cachedAt: Date.now()
	}, null, 2) + "\n", { mode: 384 });
}
//#endregion
export { loadSchema, saveSchema };

//# sourceMappingURL=schema-cache-Br5pYS6A.mjs.map