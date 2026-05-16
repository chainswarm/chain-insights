const require_chunk = require("./chunk-CZWwpsFl.cjs");
const require_app = require("./app-CfiEcqQF.cjs");
let _hono_node_server = require("@hono/node-server");
//#region src/server/index.ts
var server_exports = /* @__PURE__ */ require_chunk.__exportAll({ startServer: () => startServer });
function startServer(port = 4321) {
	const server = (0, _hono_node_server.serve)({
		fetch: require_app.createApp().fetch,
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
Object.defineProperty(exports, "server_exports", {
	enumerable: true,
	get: function() {
		return server_exports;
	}
});
Object.defineProperty(exports, "startServer", {
	enumerable: true,
	get: function() {
		return startServer;
	}
});
