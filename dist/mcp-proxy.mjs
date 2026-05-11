import * as z from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
//#region src/mcp/proxy.ts
const LOCAL_TOOL_NAMES = new Set([
	"balance",
	"topup",
	"help"
]);
/**
* Core proxy logic — exported so tests can inject dependencies directly.
* The IIFE at the bottom calls this with real dependencies.
*
* stdout purity: NEVER write to stdout in this file. Use console.error() or process.stderr.write() only.
* All diagnostic output goes to console.error() or process.stderr.write().
*/
async function createProxy() {
	const { loadConfig } = await import("./config-DTfloQyC.mjs").then((n) => n.t);
	const { createConfiguredMcpFetch } = await import("./client-B2wqOxU5.mjs").then((n) => n.t);
	const { loadSchema, saveSchema } = await import("./schema-cache-DdbxwSjc.mjs");
	const config = await loadConfig();
	const mcpFetch = await createConfiguredMcpFetch(config);
	const remoteClient = new Client({
		name: "chain-insights-proxy-client",
		version: "0.1.0"
	});
	try {
		await remoteClient.connect(new StreamableHTTPClientTransport(new URL(config.mcpEndpoint), { fetch: mcpFetch }));
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
	const server = new McpServer({
		name: "chain-insights-proxy",
		version: "0.1.0"
	}, { instructions: "Chain Insights AML investigation tools. Pay-per-call via x402 on Base." });
	server.registerTool("balance", {
		description: "Show the local Chain Insights payment wallet address and Base USDC balance.",
		inputSchema: z.object({}).passthrough()
	}, async () => {
		try {
			const { getWalletAccount, getWalletBalanceText } = await import("./tools-DlfsacMx.mjs").then((n) => n.c);
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
	server.registerTool("topup", {
		description: "Start a local browser page for topping up the Chain Insights payment wallet with Base USDC.",
		inputSchema: z.object({}).passthrough()
	}, async () => {
		try {
			const { getWalletAccount } = await import("./tools-DlfsacMx.mjs").then((n) => n.c);
			const { startTopupServer } = await import("./topup-server-CDA6HQQs.mjs").then((n) => n.i);
			const account = await getWalletAccount();
			const topupUrl = await startTopupServer(account);
			return {
				content: [{
					type: "text",
					text: JSON.stringify({
						wallet_address: account.address,
						network: "Base",
						token: "USDC",
						topup_url: topupUrl
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
		inputSchema: z.object({}).passthrough()
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
			inputSchema: z.object({}).passthrough()
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
	const transport = new StdioServerTransport();
	await server.connect(transport);
	const shutdown = () => {
		transport.close();
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}
if (process.argv[1] && import.meta.url.includes(process.argv[1].replace(/\\/g, "/"))) createProxy().catch((err) => {
	process.stderr.write(`Chain Insights MCP proxy startup failed: ${err.message}\n`);
	process.exit(1);
});
//#endregion
export { createProxy };

//# sourceMappingURL=mcp-proxy.mjs.map