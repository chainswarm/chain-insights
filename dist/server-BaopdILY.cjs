const require_chunk = require("./chunk-CZWwpsFl.cjs");
const require_app = require("./app-W7amXXm2.cjs");
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
