Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const require_chunk = require("./chunk-CZWwpsFl.cjs");
let zod = require("zod");
zod = require_chunk.__toESM(zod, 1);
let _modelcontextprotocol_sdk_server_mcp_js = require("@modelcontextprotocol/sdk/server/mcp.js");
let _modelcontextprotocol_sdk_server_stdio_js = require("@modelcontextprotocol/sdk/server/stdio.js");
let _modelcontextprotocol_sdk_client_index_js = require("@modelcontextprotocol/sdk/client/index.js");
let _modelcontextprotocol_sdk_client_streamableHttp_js = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
let _modelcontextprotocol_ext_apps_server = require("@modelcontextprotocol/ext-apps/server");
//#region src/mcp/proxy.ts
const LOCAL_TOOL_NAMES = new Set([
	"balance",
	"topup",
	"help"
]);
const TOPUP_RESOURCE_URI = "ui://chain-insights/topup.html";
/**
* Core proxy logic — exported so tests can inject dependencies directly.
* The IIFE at the bottom calls this with real dependencies.
*
* stdout purity: NEVER write to stdout in this file. Use console.error() or process.stderr.write() only.
* All diagnostic output goes to console.error() or process.stderr.write().
*/
async function createProxy() {
	const { loadConfig } = await Promise.resolve().then(() => require("./config-CIJ9gahy.cjs")).then((n) => n.config_exports);
	const { createConfiguredMcpFetch } = await Promise.resolve().then(() => require("./client-DqAQco0O.cjs")).then((n) => n.client_exports);
	const { loadSchema, saveSchema } = await Promise.resolve().then(() => require("./schema-cache-WtvFQM6K.cjs"));
	const config = await loadConfig();
	const mcpFetch = await createConfiguredMcpFetch(config);
	const remoteClient = new _modelcontextprotocol_sdk_client_index_js.Client({
		name: "chain-insights-proxy-client",
		version: "0.1.0"
	});
	try {
		await remoteClient.connect(new _modelcontextprotocol_sdk_client_streamableHttp_js.StreamableHTTPClientTransport(new URL(config.mcpEndpoint), { fetch: mcpFetch }));
	} catch {
		try {
			const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");
			await remoteClient.connect(new SSEClientTransport(new URL(config.mcpEndpoint), { fetch: mcpFetch }));
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
	let topupState = null;
	const getTopupState = async () => {
		topupState ??= (async () => {
			const { getWalletAccount } = await Promise.resolve().then(() => require("./tools-BrbjS0-j.cjs")).then((n) => n.tools_exports);
			const { startTopupServer } = await Promise.resolve().then(() => require("./topup-server-DBETwQ6w.cjs")).then((n) => n.topup_server_exports);
			const account = await getWalletAccount();
			const url = await startTopupServer(account);
			return {
				address: account.address,
				url
			};
		})();
		return topupState;
	};
	server.registerTool("balance", {
		description: "Show the local Chain Insights payment wallet address and Base USDC balance.",
		inputSchema: zod.object({}).passthrough()
	}, async () => {
		try {
			const { getWalletAccount, getWalletBalanceText } = await Promise.resolve().then(() => require("./tools-BrbjS0-j.cjs")).then((n) => n.tools_exports);
			return {
				content: [{
					type: "text",
					text: await getWalletBalanceText(await getWalletAccount())
				}],
				isError: false
			};
		} catch (err) {
			return {
				content: [{
					type: "text",
					text: `Balance failed: ${err.message}`
				}],
				isError: true
			};
		}
	});
	(0, _modelcontextprotocol_ext_apps_server.registerAppResource)(server, "Chain Insights Wallet Topup", TOPUP_RESOURCE_URI, { description: "Chain Insights wallet funding page with QR code and MetaMask link" }, async () => {
		const { address, url } = await getTopupState();
		const { generateArtifactHtml } = await Promise.resolve().then(() => require("./topup-server-DBETwQ6w.cjs")).then((n) => n.topup_server_exports);
		return { contents: [{
			uri: TOPUP_RESOURCE_URI,
			mimeType: _modelcontextprotocol_ext_apps_server.RESOURCE_MIME_TYPE,
			text: generateArtifactHtml(address, url),
			_meta: { ui: { csp: {
				resourceDomains: [url],
				connectDomains: [url]
			} } }
		}] };
	});
	(0, _modelcontextprotocol_ext_apps_server.registerAppTool)(server, "topup", {
		description: "Fund your Chain Insights wallet with USDC via MetaMask. Does NOT check balance.",
		_meta: { ui: { resourceUri: TOPUP_RESOURCE_URI } }
	}, async () => {
		try {
			const { address, url } = await getTopupState();
			return {
				content: [{
					type: "text",
					text: JSON.stringify({
						wallet_address: address,
						topup_url: url,
						message: `Open ${url} in your browser to send USDC via MetaMask.`
					}, null, 2)
				}],
				isError: false
			};
		} catch (err) {
			return {
				content: [{
					type: "text",
					text: `Top-up failed: ${err.message}`
				}],
				isError: true
			};
		}
	});
	server.registerTool("help", {
		description: "Show Chain Insights overview, available local tools, and getting-started commands.",
		inputSchema: zod.object({}).passthrough()
	}, async () => ({
		content: [{
			type: "text",
			text: [
				"Chain Insights - local AML investigation toolkit for AI agents.",
				"",
				"Remote GraphRAG tools are proxied from the configured MCP endpoint.",
				"Known public GraphRAG tools include address_risk, track_funds, money_flows_between_exchanges, address_connection_risk, and graph_query.",
				"",
				"Local tools:",
				"- balance: show the encrypted local payment wallet address and Base USDC balance.",
				"- topup: start a local browser page for funding the payment wallet with Base USDC.",
				"- help: show this overview.",
				"",
				"Useful CLI commands:",
				"- chain-insights mcp tools --refresh",
				"- chain-insights wallet balance",
				"- chain-insights wallet topup",
				"- chain-insights playbook list"
			].join("\n")
		}],
		isError: false
	}));
	for (const tool of tools ?? []) {
		if (LOCAL_TOOL_NAMES.has(tool.name)) continue;
		server.registerTool(tool.name, {
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
	}
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
