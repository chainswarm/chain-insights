import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import { t as createApp } from "./app-BMbUyLLI.mjs";
import { serve } from "@hono/node-server";
//#region src/server/index.ts
var server_exports = /* @__PURE__ */ __exportAll({ startServer: () => startServer });
function startServer(port = 4321) {
	const server = serve({
		fetch: createApp().fetch,
		hostname: "127.0.0.1",
		port
	});
	console.log(`Chain Insights server running on http://127.0.0.1:${port}`);
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

//# sourceMappingURL=server-CWyFwViy.mjs.map