Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const require_chunk = require("./chunk-CZWwpsFl.cjs");
let zod = require("zod");
zod = require_chunk.__toESM(zod, 1);
let _modelcontextprotocol_sdk_server_mcp_js = require("@modelcontextprotocol/sdk/server/mcp.js");
let _modelcontextprotocol_sdk_server_stdio_js = require("@modelcontextprotocol/sdk/server/stdio.js");
let _modelcontextprotocol_sdk_client_index_js = require("@modelcontextprotocol/sdk/client/index.js");
let _modelcontextprotocol_sdk_client_streamableHttp_js = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
//#region src/mcp/proxy.ts
/**
* Core proxy logic — exported so tests can inject dependencies directly.
* The IIFE at the bottom calls this with real dependencies.
*
* stdout purity: NEVER write to stdout in this file. Use console.error() or process.stderr.write() only.
* All diagnostic output goes to console.error() or process.stderr.write().
*/
async function createProxy() {
	const { loadConfig } = await Promise.resolve().then(() => require("./config-CnESgbjb.cjs")).then((n) => n.config_exports);
	const { isWalletConfigured, decryptKey } = await Promise.resolve().then(() => require("./wallet-CTI6OveK.cjs")).then((n) => n.wallet_exports);
	const { createMcpFetchClient } = await Promise.resolve().then(() => require("./client-CRZ3z6lC.cjs")).then((n) => n.client_exports);
	const { loadSchema, saveSchema } = await Promise.resolve().then(() => require("./schema-cache-ChAlLjce.cjs"));
	const config = await loadConfig();
	if (!await isWalletConfigured()) {
		process.stderr.write("Wallet not configured. Run `chain-insights config set walletPrivateKey <key>` to enable paid MCP calls\n");
		process.exit(1);
	}
	const paymentFetch = createMcpFetchClient(await decryptKey());
	const remoteClient = new _modelcontextprotocol_sdk_client_index_js.Client({
		name: "chain-insights-proxy-client",
		version: "0.1.0"
	});
	try {
		await remoteClient.connect(new _modelcontextprotocol_sdk_client_streamableHttp_js.StreamableHTTPClientTransport(new URL(config.mcpEndpoint), { fetch: paymentFetch }));
	} catch {
		try {
			const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");
			await remoteClient.connect(new SSEClientTransport(new URL(config.mcpEndpoint), { fetch: paymentFetch }));
		} catch (err2) {
			process.stderr.write(`Chain Insights MCP unreachable at ${config.mcpEndpoint}: ${err2.message}\n`);
			process.exit(1);
		}
	}
	let tools = await loadSchema();
	if (!tools) {
		tools = (await remoteClient.listTools()).tools;
		await saveSchema(tools);
	}
	const server = new _modelcontextprotocol_sdk_server_mcp_js.McpServer({
		name: "chain-insights-proxy",
		version: "0.1.0"
	}, { instructions: "Chain Insights AML investigation tools. Pay-per-call via x402 on Base." });
	for (const tool of tools ?? []) server.registerTool(tool.name, {
		description: tool.description ?? tool.name,
		inputSchema: zod.object({}).passthrough()
	}, async (args) => {
		try {
			const result = await remoteClient.callTool({
				name: tool.name,
				arguments: args
			});
			return {
				content: result.content,
				isError: result.isError
			};
		} catch (err) {
			return {
				content: [{
					type: "text",
					text: `MCP call failed: ${err.message}`
				}],
				isError: true
			};
		}
	});
	const transport = new _modelcontextprotocol_sdk_server_stdio_js.StdioServerTransport();
	await server.connect(transport);
	const shutdown = () => {
		transport.close();
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}
if (process.argv[1] && require("url").pathToFileURL(__filename).href.includes(process.argv[1].replace(/\\/g, "/"))) createProxy().catch((err) => {
	process.stderr.write(`Chain Insights MCP proxy startup failed: ${err.message}\n`);
	process.exit(1);
});
//#endregion
exports.createProxy = createProxy;
