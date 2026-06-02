import { t as __exportAll } from "./rolldown-runtime-D7D4PA-g.mjs";
import { t as createApp } from "./app-norpwdou.mjs";
import { serve } from "@hono/node-server";
//#region src/server/index.ts
var server_exports = /* @__PURE__ */ __exportAll({ startServer: () => startServer });
function startServer(port = 4321) {
	const server = serve({
		fetch: createApp().fetch,
		hostname: "127.0.0.1",
		port
	});
	server.on("listening", () => {
		console.log(`Chain Insights server running on http://127.0.0.1:${port}`);
	});
	server.on("error", (err) => {
		if (err.code === "EADDRINUSE") process.stderr.write(`Port already in use: 127.0.0.1:${port}\n`);
		else process.stderr.write(`Chain Insights server failed: ${err.message}\n`);
		process.exitCode = 1;
	});
	let stopped = false;
	const stop = (callback) => {
		if (stopped) {
			callback?.();
			return;
		}
		stopped = true;
		process.off("SIGINT", onSigint);
		process.off("SIGTERM", onSigterm);
		server.close(callback);
	};
	const onSigint = () => {
		stop();
		process.exit(0);
	};
	const onSigterm = () => {
		stop(() => process.exit(0));
	};
	process.on("SIGINT", onSigint);
	process.on("SIGTERM", onSigterm);
	return stop;
}
//#endregion
export { startServer as n, server_exports as t };

//# sourceMappingURL=server-86dyCsJO.mjs.map