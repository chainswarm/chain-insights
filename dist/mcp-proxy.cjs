Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const require_chunk = require("./chunk-CZWwpsFl.cjs");
let node_fs = require("node:fs");
let node_url = require("node:url");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
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
const __dirname$1 = node_path.default.dirname((0, node_url.fileURLToPath)(require("url").pathToFileURL(__filename).href));
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
const KNOWN_PUBLIC_TOOL_DESCRIPTIONS = {
	address_risk: "Screen one full blockchain address for AML risk, behavior patterns, neighborhood context, exchange exposure, and optional comparison with compare_address. Use this as the first tool for a single-address investigation. The tool returns an investigator-ready summary; preserve full addresses exactly.",
	track_funds: "Trace funds from trusted victim/source addresses through intermediaries to exchange deposit addresses. Use this when the user has a victim/source address or known untrusted/scammer addresses. The tool returns an investigator-ready fund-flow report and recommended next actions.",
	money_flows_between_exchanges: "Inspect exchange deposits, withdrawals, and bidirectional fund-flow paths for one or more addresses. Use this when all supplied addresses should be treated equally and there is no victim/scammer trust distinction. The tool returns an investigator-ready exchange contact report.",
	address_connection_risk: "Assess whether two full blockchain addresses are connected through risky paths and whether that connection matters for AML review. Use this when the user provides a source address and target address. The tool returns an investigator-ready connection-risk summary.",
	graph_query: "Run a read-only Cypher query against the Chain Insights graph database for schema discovery, aggregate counts, or custom graph inspection. Use only read-only queries and return full address strings exactly."
};
const NETWORK_DESCRIPTION = "Required network to query: bittensor, ethereum, or base. Do not guess; ask the user if missing.";
const CHAIN_INSIGHTS_WORKFLOW = [
	"Workflow:",
	"1. If the user is starting or continuing an investigation, use case_open or case_list/case_resume first.",
	"2. Do not call investigation tools until required arguments are known. Network is required; ask for bittensor, ethereum, or base if missing.",
	"3. Use address_risk first for a single address. Use track_funds for victim/source fund tracing. Use money_flows_between_exchanges when no victim/scammer trust distinction is known. Use address_connection_risk when the user gives two addresses. Use graph_query only for explicit read-only Cypher or custom aggregates.",
	"4. After a material result, preserve it with case_add_evidence when a case is active or ask whether to create/select a case.",
	"5. Use case_update_dossier for durable address/entity findings and case_start_session/case_end_session for session notes."
].join("\n");
const GRAPH_SCHEMA_HINTS = [
	"Graph query hints for network=bittensor:",
	"- Common node labels: Address, Miner, Validator, Hotkey, Exchange.",
	"- Address properties commonly include address, network, address_type, total_volume_usd, total_in_usd, total_out_usd, net_flow_usd, degree_in, degree_out, tx_in_count, tx_out_count, first_activity_timestamp, last_activity_timestamp.",
	"- Risk and ML properties may include ml_risk_score, ml_risk_level, ml_top_drivers, ml_pattern_summary, ml_pagerank, ml_betweenness, ml_community_id.",
	"- Common relationships include FLOWS_TO, OPERATED_FROM, SERVED_FROM, REGISTERED_NEURON, BELONGS_TO, SYBIL_CLUSTER, LAYERING_HOP, BURST_ACTIVITY, CYCLE_PARTICIPANT, SMURFING_CLUSTER.",
	"- FLOWS_TO is aggregated and commonly carries amount_sum, amount_usd_sum, tx_count, dominant_asset, first_seen_timestamp, last_seen_timestamp, first_tx_id, last_tx_id.",
	"- Start schema discovery with: MATCH (n) WHERE n.address IS NOT NULL RETURN labels(n) AS labels, keys(n) AS properties, count(*) AS count ORDER BY count DESC LIMIT 20",
	"- Relationship discovery: MATCH ()-[r]->() RETURN type(r) AS relationship, keys(r) AS properties, count(*) AS count ORDER BY count DESC LIMIT 20",
	"- All graph_query calls are read-only. Never use CREATE, MERGE, SET, DELETE, REMOVE, DROP, or DETACH."
].join("\n");
const GRAPH_ARTIFACT_HINTS = [
	"Graph visualization behavior:",
	"- Graph-backed tools return the investigator report as text content and keep raw graph data out of LLM-visible structuredContent.",
	"- Raw graph data is stored locally under Chain Insights artifacts and exposed to the graph app as _meta.chainInsights.graph.url.",
	"- The local graph artifact server is started automatically by the MCP server when a graph-backed tool returns an artifact URL; do not ask the user to run chain-insights serve for Claude Desktop graph iframes.",
	"- If an iframe reports that a graph artifact fetch failed, retry the graph-backed tool call so Chain Insights can recreate the artifact URL and ensure the local artifact server is running."
].join("\n");
const SERVER_INSTRUCTIONS = [
	"Chain Insights is a local AML investigation workspace for AI agents.",
	CHAIN_INSIGHTS_WORKFLOW,
	GRAPH_ARTIFACT_HINTS,
	GRAPH_SCHEMA_HINTS,
	"Presentation rules: preserve tool summaries as returned; never truncate blockchain addresses; use case tools to preserve evidence when a case exists."
].join("\n\n");
function readGraphAppHtml() {
	const candidates = [
		node_path.default.resolve(__dirname$1, "templates", "graph.html"),
		node_path.default.resolve(__dirname$1, "..", "templates", "graph.html"),
		node_path.default.resolve(__dirname$1, "..", "viz", "templates", "graph.html")
	];
	for (const candidate of candidates) try {
		return (0, node_fs.readFileSync)(candidate, "utf8");
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
			address: zod.string().min(1).describe("Full blockchain address to screen"),
			network: zod.string().min(1).describe(NETWORK_DESCRIPTION),
			compare_address: zod.string().optional().describe("Optional second full address for comparison"),
			include_attachments: zod.boolean().optional().describe("Include graph app artifact metadata")
		};
		case "track_funds": return {
			trusted_addresses: zod.string().min(1).describe("Comma-separated full trusted victim addresses. Min 1, max 5."),
			network: zod.string().min(1).describe(NETWORK_DESCRIPTION),
			untrusted_addresses: zod.string().optional().describe("Comma-separated full untrusted/scammer addresses. Max 5."),
			include_attachments: zod.boolean().optional().describe("Include graph app artifact metadata")
		};
		case "money_flows_between_exchanges": return {
			addresses: zod.string().min(1).describe("Comma-separated full addresses to trace. Min 1, max 5."),
			network: zod.string().min(1).describe(NETWORK_DESCRIPTION),
			include_attachments: zod.boolean().optional().describe("Include graph app artifact metadata")
		};
		case "address_connection_risk": return {
			from_address: zod.string().min(1).describe("Full source blockchain address"),
			to_address: zod.string().min(1).describe("Full target blockchain address"),
			network: zod.string().min(1).describe(NETWORK_DESCRIPTION),
			include_attachments: zod.boolean().optional().describe("Include graph app artifact metadata")
		};
		case "graph_query": return {
			query: zod.string().min(1).describe("Read-only Cypher query"),
			network: zod.string().min(1).describe(NETWORK_DESCRIPTION)
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
function claudeFacingToolDescription(tool) {
	const baseDescription = KNOWN_PUBLIC_TOOL_DESCRIPTIONS[tool.name] ?? tool.description ?? tool.name;
	const requiredArgs = KNOWN_PUBLIC_TOOL_REQUIRED_ARGS[tool.name];
	if (!requiredArgs) return baseDescription;
	return [
		baseDescription,
		"",
		`Required arguments: ${requiredArgs.join(", ")}.`,
		"If the user did not provide the network, ask for it before calling this tool. Do not guess a default network."
	].join("\n");
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
	const description = PUBLIC_GRAPHRAG_PROMPT_NAMES.has(promptName) && argument.name === "network" ? NETWORK_DESCRIPTION : argument.description ?? argument.name;
	const schema = zod.string().describe(description);
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
			address: zod.string().describe("Full blockchain address to screen"),
			network: zod.string().describe(NETWORK_DESCRIPTION)
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
			trusted_addresses: zod.string().describe("Victim/trusted addresses, comma-separated full addresses"),
			untrusted_addresses: zod.string().optional().describe("Known scammer/untrusted addresses, comma-separated full addresses"),
			network: zod.string().describe(NETWORK_DESCRIPTION)
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
			addresses: zod.string().describe("One or more full blockchain addresses, comma-separated"),
			network: zod.string().describe(NETWORK_DESCRIPTION)
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
			from_address: zod.string().describe("Full source blockchain address"),
			to_address: zod.string().describe("Full target blockchain address"),
			network: zod.string().describe(NETWORK_DESCRIPTION)
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
			query: zod.string().describe("Read-only Cypher query"),
			network: zod.string().describe(NETWORK_DESCRIPTION)
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
			name: zod.string().describe("Case name"),
			tags: zod.string().optional().describe("Comma-separated tags"),
			description: zod.string().optional().describe("Brief investigation description")
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
		argsSchema: { case_id: zod.string().describe("Chain Insights case ID") }
	}, async ({ case_id }) => promptResult(`Use Chain Insights case_resume for case_id: \`${case_id}\`. Continue from the returned context.`, "Resume investigation case"));
	server.registerPrompt("save-investigation-evidence", {
		title: "Save Investigation Evidence",
		description: "Append a tool result or analyst note to a local Chain Insights case evidence manifest.",
		argsSchema: {
			case_id: zod.string().describe("Chain Insights case ID"),
			source: zod.string().describe("Tool or source name")
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
		const { writeGraphArtifact } = await Promise.resolve().then(() => require("./artifacts-BjQf6oTb.cjs"));
		const { ensureArtifactServer } = await Promise.resolve().then(() => require("./artifact-server-CevJxD-9.cjs"));
		const artifact = await writeGraphArtifact(graphPayload, config);
		await ensureArtifactServer(config.serverPort);
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
	const { loadConfig } = await Promise.resolve().then(() => require("./config-CIJ9gahy.cjs")).then((n) => n.config_exports);
	const { createConfiguredMcpFetch } = await Promise.resolve().then(() => require("./client-0ZHYy2Dm.cjs")).then((n) => n.client_exports);
	const { loadSchema, saveSchema } = await Promise.resolve().then(() => require("./schema-cache-D08gQMsP.cjs"));
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
		name: "chain-insights",
		version: "0.1.0"
	}, { instructions: SERVER_INSTRUCTIONS });
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
			const { getWalletAccount } = await Promise.resolve().then(() => require("./tools-BBWDw-v_.cjs")).then((n) => n.tools_exports);
			const { startTopupServer } = await Promise.resolve().then(() => require("./topup-server-D1pfHJQi.cjs")).then((n) => n.topup_server_exports);
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
		const { getDb, initSchema } = await Promise.resolve().then(() => require("./init-b2b3GEFH.cjs")).then((n) => n.init_exports);
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
		inputSchema: zod.object({}).passthrough()
	}, async () => {
		try {
			const { getWalletAccount, getWalletBalanceText } = await Promise.resolve().then(() => require("./tools-BBWDw-v_.cjs")).then((n) => n.tools_exports);
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
	(0, _modelcontextprotocol_ext_apps_server.registerAppResource)(server, "Chain Insights Wallet Topup", TOPUP_RESOURCE_URI, { description: "Chain Insights wallet funding page with QR code and copyable address" }, async () => {
		const { address, url } = await getTopupState();
		const { generateArtifactHtml } = await Promise.resolve().then(() => require("./topup-server-D1pfHJQi.cjs")).then((n) => n.topup_server_exports);
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
	(0, _modelcontextprotocol_ext_apps_server.registerAppResource)(server, "Fund Flow Graph", GRAPH_RESOURCE_URI, { description: "Interactive D3 force-directed graph for fund flow and pattern visualization. It loads local graph artifact URLs returned in _meta.chainInsights.graph.url." }, async () => ({ contents: [{
		uri: GRAPH_RESOURCE_URI,
		mimeType: _modelcontextprotocol_ext_apps_server.RESOURCE_MIME_TYPE,
		text: readGraphAppHtml(),
		_meta: { ui: { csp: {
			resourceDomains: [`http://127.0.0.1:${config.serverPort}`],
			connectDomains: [`http://127.0.0.1:${config.serverPort}`]
		} } }
	}] }));
	(0, _modelcontextprotocol_ext_apps_server.registerAppTool)(server, "topup", {
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
			name: zod.string().min(1).describe("Case name"),
			tags: zod.union([zod.string(), zod.array(zod.string())]).optional().describe("Comma-separated tags or string array"),
			description: zod.string().optional().describe("Brief investigation description")
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
			const { CaseStore } = await Promise.resolve().then(() => require("./cases-BTjEvF0-.cjs"));
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
		inputSchema: { status: zod.enum([
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
			const { CaseStore } = await Promise.resolve().then(() => require("./cases-BTjEvF0-.cjs"));
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
		inputSchema: { case_id: zod.string().min(1).describe("Chain Insights case ID") },
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false
		}
	}, async ({ case_id }) => {
		try {
			await initCasesDb();
			const { CaseStore } = await Promise.resolve().then(() => require("./cases-BTjEvF0-.cjs"));
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
			case_id: zod.string().min(1).describe("Chain Insights case ID"),
			source: zod.string().min(1).describe("Source tool or evidence origin"),
			content: zod.string().min(1).describe("Evidence markdown/text to store"),
			query_params: zod.string().optional().describe("Original query parameters, for example \"network=bittensor address=...\"")
		},
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: false
		}
	}, async ({ case_id, source, content, query_params }) => {
		try {
			const { EvidenceStore } = await Promise.resolve().then(() => require("./cases-BTjEvF0-.cjs"));
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
		inputSchema: { case_id: zod.string().min(1).describe("Chain Insights case ID") },
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false
		}
	}, async ({ case_id }) => {
		try {
			const { EvidenceStore } = await Promise.resolve().then(() => require("./cases-BTjEvF0-.cjs"));
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
			case_id: zod.string().min(1).describe("Chain Insights case ID"),
			address: zod.string().min(1).describe("Full address or entity identifier"),
			finding: zod.string().min(1).describe("Finding to append"),
			entity_type: zod.enum([
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
			const { DossierStore } = await Promise.resolve().then(() => require("./cases-BTjEvF0-.cjs"));
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
		inputSchema: { case_id: zod.string().min(1).describe("Chain Insights case ID") },
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: false
		}
	}, async ({ case_id }) => {
		try {
			const { SessionStore } = await Promise.resolve().then(() => require("./cases-BTjEvF0-.cjs"));
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
			case_id: zod.string().min(1).describe("Chain Insights case ID"),
			findings: zod.string().optional().describe("Key findings from this session"),
			next_steps: zod.string().optional().describe("Next investigation steps")
		},
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: false
		}
	}, async ({ case_id, findings, next_steps }) => {
		try {
			const { SessionStore } = await Promise.resolve().then(() => require("./cases-BTjEvF0-.cjs"));
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
		inputSchema: zod.object({}).passthrough()
	}, async () => ({
		content: [{
			type: "text",
			text: [
				"Chain Insights AML investigation workspace for AI agents.",
				"",
				CHAIN_INSIGHTS_WORKFLOW,
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
				"- help: show this overview.",
				"",
				GRAPH_ARTIFACT_HINTS,
				"",
				GRAPH_SCHEMA_HINTS
			].join("\n")
		}],
		isError: false
	}));
	for (const tool of tools ?? []) {
		if (LOCAL_TOOL_NAMES.has(tool.name)) continue;
		const inputSchema = knownPublicToolInputSchema(tool.name) ?? zod.object({}).passthrough();
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
			description: claudeFacingToolDescription(tool),
			inputSchema
		};
		if (hasGraphApp(tool)) (0, _modelcontextprotocol_ext_apps_server.registerAppTool)(server, tool.name, {
			...toolConfig,
			_meta: graphToolMeta(tool)
		}, handler);
		else server.registerTool(tool.name, toolConfig, handler);
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
