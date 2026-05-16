require("./chunk-CZWwpsFl.cjs");
const require_app = require("./app-CfiEcqQF.cjs");
let _hono_node_server = require("@hono/node-server");
let node_timers_promises = require("node:timers/promises");
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
		await (0, node_timers_promises.setTimeout)(50);
	}
	throw new Error(`Graph artifact server did not become healthy on 127.0.0.1:${port}`);
}
async function ensureArtifactServer(port) {
	if (servers.has(port)) return;
	if (await isHealthy(port)) return;
	const server = (0, _hono_node_server.serve)({
		fetch: require_app.createApp().fetch,
		hostname: "127.0.0.1",
		port
	});
	servers.set(port, server);
	server.on("error", (err) => {
		servers.delete(port);
		process.stderr.write(`Chain Insights graph artifact server failed on 127.0.0.1:${port}: ${err.message}\n`);
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
exports.ensureArtifactServer = ensureArtifactServer;
