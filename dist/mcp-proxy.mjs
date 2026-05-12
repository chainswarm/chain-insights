import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as z from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
//#region src/mcp/proxy.ts
const LOCAL_TOOL_NAMES = new Set([
	"balance",
	"topup",
	"help"
]);
const TOPUP_RESOURCE_URI = "ui://chain-insights/topup.html";
const GRAPH_RESOURCE_URI = "ui://chain-insights/graph";
const GRAPH_APP_TOOL_NAMES = new Set([
	"address_risk",
	"track_funds",
	"money_flows_between_exchanges",
	"address_connection_risk"
]);
const GRAPH_ARRAY_KEYS = [
	"nodes",
	"edges",
	"flows",
	"edge_anchors"
];
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function readGraphAppHtml() {
	const candidates = [
		path.resolve(__dirname, "templates", "graph.html"),
		path.resolve(__dirname, "..", "templates", "graph.html"),
		path.resolve(__dirname, "..", "viz", "templates", "graph.html")
	];
	for (const candidate of candidates) try {
		return readFileSync(candidate, "utf8");
	} catch (err) {
		if (err.code !== "ENOENT") throw err;
	}
	throw new Error(`Graph MCP app template not found. Tried: ${candidates.join(", ")}`);
}
function hasGraphApp(tool) {
	const configuredUri = tool._meta?.ui;
	if (configuredUri && typeof configuredUri === "object" && "resourceUri" in configuredUri && configuredUri.resourceUri === GRAPH_RESOURCE_URI) return true;
	if (tool._meta?.["ui/resourceUri"] === GRAPH_RESOURCE_URI) return true;
	if (GRAPH_APP_TOOL_NAMES.has(tool.name)) return true;
	return JSON.stringify(tool.outputSchema ?? {}).includes("\"app_data\"");
}
function graphToolMeta(tool) {
	const meta = { ...tool._meta ?? {} };
	const ui = meta.ui && typeof meta.ui === "object" && !Array.isArray(meta.ui) ? { ...meta.ui } : {};
	return {
		...meta,
		ui: {
			...ui,
			resourceUri: GRAPH_RESOURCE_URI
		}
	};
}
function hasGraphArrayFields(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const record = value;
	return GRAPH_ARRAY_KEYS.some((key) => Array.isArray(record[key]));
}
function sanitizeStructuredContentForGraphPayload(structuredContent) {
	if (!structuredContent) return void 0;
	return sanitizeStructuredValue(structuredContent);
}
function sanitizeStructuredValue(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	const sanitized = {};
	for (const [key, childValue] of Object.entries(value)) {
		if (key === "app_data") continue;
		if (GRAPH_ARRAY_KEYS.includes(key) && Array.isArray(childValue)) continue;
		sanitized[key] = sanitizeStructuredValue(childValue);
	}
	return sanitized;
}
function getRemoteGraphPayload(result) {
	const chainInsights = result._meta?.chainInsights;
	if (!chainInsights || typeof chainInsights !== "object" || Array.isArray(chainInsights)) return null;
	const graph = chainInsights.graph;
	if (graph === void 0) return null;
	if (!graph || typeof graph !== "object" || Array.isArray(graph)) throw new Error("Invalid remote graph payload");
	const graphRecord = graph;
	if (!("data" in graphRecord)) {
		if ("url" in graphRecord || hasGraphArrayFields(graphRecord)) throw new Error("Invalid remote graph payload");
		return null;
	}
	const data = graphRecord.data;
	if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid remote graph payload");
	return data;
}
async function normalizeRemoteToolResult(result, config) {
	const graphPayload = getRemoteGraphPayload(result);
	const meta = { ...result._meta ?? {} };
	if (graphPayload) {
		const { writeGraphArtifact } = await import("./artifacts-DZqbNrfC.mjs");
		const artifact = await writeGraphArtifact(graphPayload, config);
		meta.chainInsights = {
			...meta.chainInsights ?? {},
			graph: {
				schema: artifact.schema,
				id: artifact.id,
				url: artifact.url
			}
		};
	}
	return {
		content: result.content ?? [],
		structuredContent: sanitizeStructuredContentForGraphPayload(result.structuredContent),
		_meta: Object.keys(meta).length > 0 ? meta : void 0,
		isError: result.isError
	};
}
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
	const { loadSchema, saveSchema } = await import("./schema-cache-ChsPSz7X.mjs");
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
	let topupState = null;
	const getTopupState = async () => {
		topupState ??= (async () => {
			const { getWalletAccount } = await import("./tools-BcPMw4c6.mjs").then((n) => n.o);
			const { startTopupServer } = await import("./topup-server-Cthbn1Bg.mjs").then((n) => n.r);
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
		inputSchema: z.object({}).passthrough()
	}, async () => {
		try {
			const { getWalletAccount, getWalletBalanceText } = await import("./tools-BcPMw4c6.mjs").then((n) => n.o);
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
	registerAppResource(server, "Chain Insights Wallet Topup", TOPUP_RESOURCE_URI, { description: "Chain Insights wallet funding page with QR code and MetaMask link" }, async () => {
		const { address, url } = await getTopupState();
		const { generateArtifactHtml } = await import("./topup-server-Cthbn1Bg.mjs").then((n) => n.r);
		return { contents: [{
			uri: TOPUP_RESOURCE_URI,
			mimeType: RESOURCE_MIME_TYPE,
			text: generateArtifactHtml(address, url),
			_meta: { ui: { csp: {
				resourceDomains: [url],
				connectDomains: [url]
			} } }
		}] };
	});
	registerAppResource(server, "Fund Flow Graph", GRAPH_RESOURCE_URI, { description: "Interactive D3 force-directed graph for fund flow and pattern visualization." }, async () => ({ contents: [{
		uri: GRAPH_RESOURCE_URI,
		mimeType: RESOURCE_MIME_TYPE,
		text: readGraphAppHtml()
	}] }));
	registerAppTool(server, "topup", {
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
		const handler = async (args) => {
			try {
				return await normalizeRemoteToolResult(await remoteClient.callTool({
					name: tool.name,
					arguments: args
				}), config);
			} catch (err) {
				return {
					content: [{
						type: "text",
						text: `MCP call failed: ${err.message}`
					}],
					isError: true
				};
			}
		};
		const toolConfig = {
			title: tool.title,
			description: tool.description ?? tool.name,
			inputSchema: z.object({}).passthrough()
		};
		if (hasGraphApp(tool)) registerAppTool(server, tool.name, {
			...toolConfig,
			_meta: graphToolMeta(tool)
		}, handler);
		else server.registerTool(tool.name, toolConfig, handler);
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