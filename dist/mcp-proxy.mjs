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
	"help",
	"case_open",
	"case_list",
	"case_resume",
	"case_add_evidence",
	"case_verify_evidence",
	"case_update_dossier",
	"case_start_session",
	"case_end_session"
]);
const PUBLIC_GRAPHRAG_PROMPT_NAMES = new Set(["address-risk", "track-funds"]);
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
const COMMA_SEPARATED_ADDRESS_FIELDS = new Set([
	"addresses",
	"trusted_addresses",
	"untrusted_addresses"
]);
const KNOWN_PUBLIC_TOOL_REQUIRED_ARGS = {
	address_risk: ["address", "network"],
	track_funds: ["trusted_addresses", "network"],
	money_flows_between_exchanges: ["addresses", "network"],
	address_connection_risk: [
		"from_address",
		"to_address",
		"network"
	],
	graph_query: ["query", "network"]
};
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
function knownPublicToolInputSchema(toolName) {
	switch (toolName) {
		case "address_risk": return {
			address: z.string().min(1).describe("Full blockchain address to screen"),
			network: z.string().min(1).describe("Network to query: bittensor, ethereum, or base"),
			compare_address: z.string().optional().describe("Optional second full address for comparison"),
			include_attachments: z.boolean().optional().describe("Include graph app artifact metadata")
		};
		case "track_funds": return {
			trusted_addresses: z.string().min(1).describe("Comma-separated full trusted victim addresses. Min 1, max 5."),
			network: z.string().min(1).describe("Network to query: bittensor, ethereum, or base"),
			untrusted_addresses: z.string().optional().describe("Comma-separated full untrusted/scammer addresses. Max 5."),
			include_attachments: z.boolean().optional().describe("Include graph app artifact metadata")
		};
		case "money_flows_between_exchanges": return {
			addresses: z.string().min(1).describe("Comma-separated full addresses to trace. Min 1, max 5."),
			network: z.string().min(1).describe("Network to query: bittensor, ethereum, or base"),
			include_attachments: z.boolean().optional().describe("Include graph app artifact metadata")
		};
		case "address_connection_risk": return {
			from_address: z.string().min(1).describe("Full source blockchain address"),
			to_address: z.string().min(1).describe("Full target blockchain address"),
			network: z.string().min(1).describe("Network to query: bittensor, ethereum, or base"),
			include_attachments: z.boolean().optional().describe("Include graph app artifact metadata")
		};
		case "graph_query": return {
			query: z.string().min(1).describe("Read-only Cypher query"),
			network: z.string().min(1).describe("Network to query: bittensor, ethereum, or base")
		};
		default: return null;
	}
}
function isRecord(value) {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
function isBlankArgument(value) {
	if (value === void 0 || value === null) return true;
	if (typeof value === "string") return value.trim() === "";
	if (Array.isArray(value)) return value.length === 0 || value.every(isBlankArgument);
	return false;
}
function normalizeRemoteToolArguments(toolName, args) {
	const normalized = isRecord(args) ? { ...args } : {};
	if (!(toolName in KNOWN_PUBLIC_TOOL_REQUIRED_ARGS)) return normalized;
	for (const fieldName of COMMA_SEPARATED_ADDRESS_FIELDS) {
		const value = normalized[fieldName];
		if (Array.isArray(value)) normalized[fieldName] = value.map((entry) => String(entry).trim()).filter(Boolean).join(",");
	}
	return normalized;
}
function validateKnownPublicToolArguments(toolName, args) {
	const requiredArgs = KNOWN_PUBLIC_TOOL_REQUIRED_ARGS[toolName];
	if (!requiredArgs) return null;
	for (const argName of requiredArgs) if (isBlankArgument(args[argName])) return `Missing required argument: ${argName}`;
	return null;
}
function promptResult(text, description) {
	return {
		description,
		messages: [{
			role: "user",
			content: {
				type: "text",
				text
			}
		}]
	};
}
function compactPromptArguments(args) {
	const compact = {};
	for (const [key, value] of Object.entries(args)) if (typeof value === "string" && value.trim() !== "") compact[key] = value;
	return compact;
}
function promptArgumentSchema(promptName, argument) {
	const schema = z.string().describe(argument.description ?? argument.name);
	if (PUBLIC_GRAPHRAG_PROMPT_NAMES.has(promptName) && argument.name === "network") return schema;
	return argument.required === false ? schema.optional() : schema;
}
function registerRemotePrompt(server, remoteClient, prompt) {
	const argsSchema = {};
	for (const argument of prompt.arguments ?? []) argsSchema[argument.name] = promptArgumentSchema(prompt.name, argument);
	server.registerPrompt(prompt.name, {
		title: prompt.title,
		description: prompt.description,
		argsSchema
	}, async (args) => remoteClient.getPrompt({
		name: prompt.name,
		arguments: compactPromptArguments(args)
	}));
}
function registerLocalPrompts(server, remotePromptNames) {
	if (!remotePromptNames.has("address-risk")) server.registerPrompt("address-risk", {
		title: "Address Risk",
		description: "Screen an address for AML risk, behavioral patterns, neighborhood profile, and exchange links.",
		argsSchema: {
			address: z.string().describe("Full blockchain address to screen"),
			network: z.string().describe("Network: bittensor, base, or ethereum")
		}
	}, async ({ address, network }) => promptResult([
		`Use Chain Insights address_risk on ${network} for:`,
		"",
		`\`${address}\``,
		"",
		"Present the summary as-is. Do not add analysis, verdicts, or risk assessments; the tool output already contains the risk assessment."
	].join("\n"), "Address risk screening"));
	if (!remotePromptNames.has("track-funds")) server.registerPrompt("track-funds", {
		title: "Track Funds",
		description: "Trace stolen funds from victim addresses through intermediaries to exchange deposit addresses.",
		argsSchema: {
			trusted_addresses: z.string().describe("Victim/trusted addresses, comma-separated full addresses"),
			untrusted_addresses: z.string().optional().describe("Known scammer/untrusted addresses, comma-separated full addresses"),
			network: z.string().describe("Network: bittensor, base, or ethereum")
		}
	}, async ({ trusted_addresses, untrusted_addresses, network }) => {
		const untrusted = untrusted_addresses?.trim() ? `\nKnown untrusted addresses:\n${untrusted_addresses}\n` : "";
		return promptResult([
			`Use Chain Insights track_funds on ${network}.`,
			"",
			"Trusted victim addresses:",
			trusted_addresses,
			untrusted,
			"Present the summary as-is and include recommended next actions exactly as returned."
		].join("\n"), "Trace stolen funds");
	});
	server.registerPrompt("money-flows-between-exchanges", {
		title: "Money Flows Between Exchanges",
		description: "Find exchange deposits, withdrawals, and bidirectional fund-flow paths for one or more addresses.",
		argsSchema: {
			addresses: z.string().describe("One or more full blockchain addresses, comma-separated"),
			network: z.string().describe("Network: bittensor, base, or ethereum")
		}
	}, async ({ addresses, network }) => promptResult([
		`Use Chain Insights money_flows_between_exchanges on ${network} for these addresses:`,
		"",
		addresses,
		"",
		"Present the exchange contact table as-is. Show every blockchain address as the full exact string."
	].join("\n"), "Exchange flow tracing"));
	server.registerPrompt("address-connection-risk", {
		title: "Address Connection Risk",
		description: "Assess whether two addresses are connected and whether that connection is risky.",
		argsSchema: {
			from_address: z.string().describe("Full source blockchain address"),
			to_address: z.string().describe("Full target blockchain address"),
			network: z.string().describe("Network: bittensor, base, or ethereum")
		}
	}, async ({ from_address, to_address, network }) => promptResult([
		`Use Chain Insights address_connection_risk on ${network}.`,
		"",
		`from_address: \`${from_address}\``,
		`to_address: \`${to_address}\``,
		"",
		"Present the summary as-is. Do not add analysis, verdicts, or risk assessments."
	].join("\n"), "Address connection risk"));
	server.registerPrompt("graph-query", {
		title: "Cypher Graph Query",
		description: "Run a read-only Cypher query against the Chain Insights graph database.",
		argsSchema: {
			query: z.string().describe("Read-only Cypher query"),
			network: z.string().describe("Network: bittensor, base, or ethereum")
		}
	}, async ({ query, network }) => promptResult([
		`Use Chain Insights graph_query on ${network} with this read-only Cypher query:`,
		"",
		"```cypher",
		query,
		"```",
		"",
		"Return full address properties; never shorten addresses with ellipses."
	].join("\n"), "Graph database query"));
	server.registerPrompt("balance", {
		title: "Wallet Balance",
		description: "Show the local Chain Insights payment wallet address and Base USDC balance.",
		argsSchema: {}
	}, async () => promptResult("Use Chain Insights balance. Show the wallet address, network, token, and balance exactly as returned.", "Wallet balance"));
	server.registerPrompt("topup", {
		title: "Wallet Top-Up",
		description: "Open the local wallet funding page for Base USDC.",
		argsSchema: {}
	}, async () => promptResult("Use Chain Insights topup. Show the top-up URL and wallet address.", "Wallet top-up"));
	server.registerPrompt("help", {
		title: "Chain Insights Help",
		description: "Show available Chain Insights tools and investigation case workflow.",
		argsSchema: {}
	}, async () => promptResult("Use Chain Insights help. Summarize the available tools and investigation case workflow without inventing capabilities.", "Chain Insights help"));
	server.registerPrompt("open-investigation-case", {
		title: "Open Investigation Case",
		description: "Create a local Chain Insights case for an investigation.",
		argsSchema: {
			name: z.string().describe("Case name"),
			tags: z.string().optional().describe("Comma-separated tags"),
			description: z.string().optional().describe("Brief investigation description")
		}
	}, async ({ name, tags, description }) => promptResult([
		"Use Chain Insights case_open to create a local investigation case.",
		"",
		`name: \`${name}\``,
		tags ? `tags: \`${tags}\`` : "",
		description ? `description: ${description}` : ""
	].filter(Boolean).join("\n"), "Open investigation case"));
	server.registerPrompt("resume-investigation-case", {
		title: "Resume Investigation Case",
		description: "Load local Chain Insights case context, evidence count, dossiers, and latest session.",
		argsSchema: { case_id: z.string().describe("Chain Insights case ID") }
	}, async ({ case_id }) => promptResult(`Use Chain Insights case_resume for case_id: \`${case_id}\`. Continue from the returned context.`, "Resume investigation case"));
	server.registerPrompt("save-investigation-evidence", {
		title: "Save Investigation Evidence",
		description: "Append a tool result or analyst note to a local Chain Insights case evidence manifest.",
		argsSchema: {
			case_id: z.string().describe("Chain Insights case ID"),
			source: z.string().describe("Tool or source name")
		}
	}, async ({ case_id, source }) => promptResult([
		"Use Chain Insights case_add_evidence after the next relevant tool result.",
		"",
		`case_id: \`${case_id}\``,
		`source: \`${source}\``,
		"content: use the exact report or note that should become evidence."
	].join("\n"), "Save investigation evidence"));
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
	const remotePrompts = [];
	try {
		const promptResult = await remoteClient.listPrompts();
		for (const prompt of promptResult.prompts) if (PUBLIC_GRAPHRAG_PROMPT_NAMES.has(prompt.name)) remotePrompts.push(prompt);
	} catch (err) {
		process.stderr.write(`Chain Insights MCP prompt passthrough unavailable at ${config.mcpEndpoint}: ${err.message}\n`);
	}
	const remotePromptNames = new Set(remotePrompts.map((prompt) => prompt.name));
	for (const prompt of remotePrompts) registerRemotePrompt(server, remoteClient, prompt);
	registerLocalPrompts(server, remotePromptNames);
	let topupState = null;
	const getTopupState = async () => {
		topupState ??= (async () => {
			const { getWalletAccount } = await import("./tools--eNNrSug.mjs").then((n) => n.o);
			const { startTopupServer } = await import("./topup-server-DV1aDI20.mjs").then((n) => n.r);
			const account = await getWalletAccount();
			const url = await startTopupServer(account);
			return {
				address: account.address,
				url
			};
		})();
		return topupState;
	};
	const initCasesDb = async () => {
		const { getDb, initSchema } = await import("./init-SohRr-mY.mjs").then((n) => n.i);
		const conn = await getDb();
		try {
			await initSchema(conn);
		} finally {
			conn.closeSync();
		}
	};
	const caseToolError = (label, err) => ({
		content: [{
			type: "text",
			text: `${label} failed: ${err.message}`
		}],
		isError: true
	});
	const parseTags = (tags) => {
		if (Array.isArray(tags)) return tags.map((tag) => tag.trim()).filter(Boolean);
		if (typeof tags === "string") return tags.split(",").map((tag) => tag.trim()).filter(Boolean);
		return [];
	};
	server.registerTool("balance", {
		description: "Show the local Chain Insights payment wallet address and Base USDC balance.",
		inputSchema: z.object({}).passthrough()
	}, async () => {
		try {
			const { getWalletAccount, getWalletBalanceText } = await import("./tools--eNNrSug.mjs").then((n) => n.o);
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
	registerAppResource(server, "Chain Insights Wallet Topup", TOPUP_RESOURCE_URI, { description: "Chain Insights wallet funding page with QR code and copyable address" }, async () => {
		const { address, url } = await getTopupState();
		const { generateArtifactHtml } = await import("./topup-server-DV1aDI20.mjs").then((n) => n.r);
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
		description: "Open the local Chain Insights wallet funding page for Base USDC.",
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
						message: `Open ${url} in your browser to fund the Chain Insights wallet with Base USDC.`
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
	server.registerTool("case_open", {
		description: "Create a local Chain Insights investigation case. Use this before saving evidence, dossiers, or session notes for a new investigation.",
		inputSchema: {
			name: z.string().min(1).describe("Case name"),
			tags: z.union([z.string(), z.array(z.string())]).optional().describe("Comma-separated tags or string array"),
			description: z.string().optional().describe("Brief investigation description")
		},
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: false
		}
	}, async ({ name, tags, description }) => {
		try {
			await initCasesDb();
			const { CaseStore } = await import("./cases-DbOQEh5p.mjs");
			const created = await CaseStore.create({
				name,
				tags: parseTags(tags),
				description: description ?? ""
			});
			return {
				content: [{
					type: "text",
					text: JSON.stringify({
						case_id: created.id,
						name: created.name,
						status: created.status,
						tags: created.tags,
						directory: `~/.chain-insights/cases/${created.id}/`
					}, null, 2)
				}],
				isError: false
			};
		} catch (err) {
			return caseToolError("Case open", err);
		}
	});
	server.registerTool("case_list", {
		description: "List local Chain Insights investigation cases. Use before resuming when the user does not provide a case ID.",
		inputSchema: { status: z.enum([
			"open",
			"active",
			"suspended",
			"closed"
		]).optional().describe("Optional status filter") },
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false
		}
	}, async ({ status }) => {
		try {
			await initCasesDb();
			const { CaseStore } = await import("./cases-DbOQEh5p.mjs");
			const cases = await CaseStore.list();
			const filtered = status ? cases.filter((entry) => entry.status === status) : cases;
			return {
				content: [{
					type: "text",
					text: JSON.stringify({ cases: filtered }, null, 2)
				}],
				isError: false
			};
		} catch (err) {
			return caseToolError("Case list", err);
		}
	});
	server.registerTool("case_resume", {
		description: "Load local Chain Insights case context: metadata, evidence count, dossier summaries, and latest session notes.",
		inputSchema: { case_id: z.string().min(1).describe("Chain Insights case ID") },
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false
		}
	}, async ({ case_id }) => {
		try {
			await initCasesDb();
			const { CaseStore } = await import("./cases-DbOQEh5p.mjs");
			const context = await CaseStore.loadContext(case_id);
			return {
				content: [{
					type: "text",
					text: JSON.stringify(context, null, 2)
				}],
				isError: false
			};
		} catch (err) {
			return caseToolError("Case resume", err);
		}
	});
	server.registerTool("case_add_evidence", {
		description: "Append a tool result or analyst note to a local case evidence manifest. Use after address_risk, track_funds, graph_query, or manual findings that should be preserved.",
		inputSchema: {
			case_id: z.string().min(1).describe("Chain Insights case ID"),
			source: z.string().min(1).describe("Source tool or evidence origin"),
			content: z.string().min(1).describe("Evidence markdown/text to store"),
			query_params: z.string().optional().describe("Original query parameters, for example \"network=bittensor address=...\"")
		},
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: false
		}
	}, async ({ case_id, source, content, query_params }) => {
		try {
			const { EvidenceStore } = await import("./cases-DbOQEh5p.mjs");
			const saved = await EvidenceStore.append(case_id, {
				source,
				content,
				queryParams: query_params ?? ""
			});
			return {
				content: [{
					type: "text",
					text: JSON.stringify(saved, null, 2)
				}],
				isError: false
			};
		} catch (err) {
			return caseToolError("Evidence append", err);
		}
	});
	server.registerTool("case_verify_evidence", {
		description: "Verify a local case evidence manifest and report tampered or missing evidence files.",
		inputSchema: { case_id: z.string().min(1).describe("Chain Insights case ID") },
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false
		}
	}, async ({ case_id }) => {
		try {
			const { EvidenceStore } = await import("./cases-DbOQEh5p.mjs");
			const result = await EvidenceStore.verifyManifest(case_id);
			return {
				content: [{
					type: "text",
					text: JSON.stringify(result, null, 2)
				}],
				isError: false
			};
		} catch (err) {
			return caseToolError("Evidence verify", err);
		}
	});
	server.registerTool("case_update_dossier", {
		description: "Append a finding to an address/entity dossier inside a local Chain Insights case.",
		inputSchema: {
			case_id: z.string().min(1).describe("Chain Insights case ID"),
			address: z.string().min(1).describe("Full address or entity identifier"),
			finding: z.string().min(1).describe("Finding to append"),
			entity_type: z.enum([
				"eoa",
				"contract",
				"exchange",
				"mixer",
				"unknown"
			]).optional().describe("Entity type")
		},
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: false
		}
	}, async ({ case_id, address, finding, entity_type }) => {
		try {
			const { DossierStore } = await import("./cases-DbOQEh5p.mjs");
			await DossierStore.appendFinding(case_id, address, finding, entity_type ?? "unknown");
			return {
				content: [{
					type: "text",
					text: JSON.stringify({
						case_id,
						address,
						updated: true
					}, null, 2)
				}],
				isError: false
			};
		} catch (err) {
			return caseToolError("Dossier update", err);
		}
	});
	server.registerTool("case_start_session", {
		description: "Start a local investigation session file for a Chain Insights case.",
		inputSchema: { case_id: z.string().min(1).describe("Chain Insights case ID") },
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: false
		}
	}, async ({ case_id }) => {
		try {
			const { SessionStore } = await import("./cases-DbOQEh5p.mjs");
			const session = await SessionStore.start(case_id);
			return {
				content: [{
					type: "text",
					text: JSON.stringify(session, null, 2)
				}],
				isError: false
			};
		} catch (err) {
			return caseToolError("Session start", err);
		}
	});
	server.registerTool("case_end_session", {
		description: "End the latest local investigation session for a Chain Insights case with findings and next steps.",
		inputSchema: {
			case_id: z.string().min(1).describe("Chain Insights case ID"),
			findings: z.string().optional().describe("Key findings from this session"),
			next_steps: z.string().optional().describe("Next investigation steps")
		},
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: false
		}
	}, async ({ case_id, findings, next_steps }) => {
		try {
			const { SessionStore } = await import("./cases-DbOQEh5p.mjs");
			await SessionStore.end(case_id, {
				findings: findings ?? "",
				nextSteps: next_steps ?? ""
			});
			await SessionStore.archiveOldSessions(case_id);
			return {
				content: [{
					type: "text",
					text: JSON.stringify({
						case_id,
						ended: true
					}, null, 2)
				}],
				isError: false
			};
		} catch (err) {
			return caseToolError("Session end", err);
		}
	});
	server.registerTool("help", {
		description: "Show Chain Insights overview, available tools, and investigation workflow.",
		inputSchema: z.object({}).passthrough()
	}, async () => ({
		content: [{
			type: "text",
			text: [
				"Chain Insights AML investigation workspace for AI agents.",
				"",
				"Investigation tools:",
				"- address_risk: screen a full address for AML risk, behavior, neighborhood, and exchange exposure.",
				"- track_funds: trace victim funds through intermediaries to exchange deposit addresses.",
				"- money_flows_between_exchanges: inspect exchange deposits and withdrawals for addresses.",
				"- address_connection_risk: assess whether from_address and to_address are connected through risky paths.",
				"- graph_query: run read-only Cypher against the investigation graph.",
				"",
				"Case workflow tools:",
				"- case_open: create a local case before preserving evidence.",
				"- case_list: list local cases.",
				"- case_resume: load case context, evidence count, dossiers, and latest session.",
				"- case_add_evidence: append a report or note to the case evidence manifest.",
				"- case_verify_evidence: verify saved evidence integrity.",
				"- case_update_dossier: add a finding to an address/entity dossier.",
				"- case_start_session and case_end_session: record session notes.",
				"",
				"Wallet tools:",
				"- balance: show the local payment wallet address and Base USDC balance.",
				"- topup: open the local wallet funding page for Base USDC.",
				"- help: show this overview."
			].join("\n")
		}],
		isError: false
	}));
	for (const tool of tools ?? []) {
		if (LOCAL_TOOL_NAMES.has(tool.name)) continue;
		const inputSchema = knownPublicToolInputSchema(tool.name) ?? z.object({}).passthrough();
		const handler = async (args) => {
			try {
				const normalizedArgs = normalizeRemoteToolArguments(tool.name, args);
				const validationError = validateKnownPublicToolArguments(tool.name, normalizedArgs);
				if (validationError) return {
					content: [{
						type: "text",
						text: validationError
					}],
					isError: true
				};
				return await normalizeRemoteToolResult(await remoteClient.callTool({
					name: tool.name,
					arguments: normalizedArgs
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
			inputSchema
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