import * as z from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
//#region src/mcp/proxy.ts
/**
* Core proxy logic — exported so tests can inject dependencies directly.
* The IIFE at the bottom calls this with real dependencies.
*
* stdout purity: NEVER write to stdout in this file. Use console.error() or process.stderr.write() only.
* All diagnostic output goes to console.error() or process.stderr.write().
*/
async function createProxy() {
	const { loadConfig } = await import("./config-Da25ufmy.mjs").then((n) => n.t);
	const { isWalletConfigured, decryptKey } = await import("./wallet-CKG61Aoq.mjs").then((n) => n.i);
	const { createMcpFetchClient } = await import("./client-DPA33paN.mjs").then((n) => n.t);
	const { loadSchema, saveSchema } = await import("./schema-cache-BGlMtvMk.mjs");
	const config = await loadConfig();
	if (!await isWalletConfigured()) {
		process.stderr.write("Wallet not configured. Run `chain-insights config set walletPrivateKey <key>` to enable paid MCP calls\n");
		process.exit(1);
	}
	const paymentFetch = createMcpFetchClient(await decryptKey());
	const remoteClient = new Client({
		name: "chain-insights-proxy-client",
		version: "0.1.0"
	});
	try {
		await remoteClient.connect(new StreamableHTTPClientTransport(new URL(config.mcpEndpoint), { fetch: paymentFetch }));
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
	const server = new McpServer({
		name: "chain-insights-proxy",
		version: "0.1.0"
	}, { instructions: "Chain Insights AML investigation tools. Pay-per-call via x402 on Base." });
	for (const tool of tools ?? []) server.registerTool(tool.name, {
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