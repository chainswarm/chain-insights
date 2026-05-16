import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import { t as createApp } from "./app--TrJojTT.mjs";
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
	process.on("SIGINT", () => {
		server.close();
		process.exit(0);
	});
	process.on("SIGTERM", () => {
		server.close(() => process.exit(0));
	});
	return () => server.close();
}
//#endregion
export { startServer as n, server_exports as t };

//# sourceMappingURL=server--aB5VwX5.mjs.map