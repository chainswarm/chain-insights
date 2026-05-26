import { t as createApp } from "./app-DTO_O28i.mjs";
import { serve } from "@hono/node-server";
import { setTimeout as setTimeout$1 } from "node:timers/promises";
//#region src/mcp/artifact-server.ts
const servers = /* @__PURE__ */ new Map();
async function isHealthy(port) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 500);
	try {
		return (await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal })).ok;
	} catch {
		return false;
	} finally {
		clearTimeout(timeout);
	}
}
async function waitUntilHealthy(port) {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (await isHealthy(port)) return;
		await setTimeout$1(50);
	}
	throw new Error(`Graph report server did not become healthy on 127.0.0.1:${port}`);
}
async function ensureArtifactServer(port) {
	if (servers.has(port)) return;
	if (await isHealthy(port)) return;
	const server = serve({
		fetch: createApp().fetch,
		hostname: "127.0.0.1",
		port
	});
	servers.set(port, server);
	server.on("error", (err) => {
		servers.delete(port);
		process.stderr.write(`Chain Insights graph report server failed on 127.0.0.1:${port}: ${err.message}\n`);
	});
	try {
		await waitUntilHealthy(port);
	} catch (err) {
		servers.delete(port);
		server.close();
		throw err;
	}
}
//#endregion
export { ensureArtifactServer };

//# sourceMappingURL=artifact-server-HuJFnfjx.mjs.map