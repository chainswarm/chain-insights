Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const require_chunk = require("./chunk-DakpK96I.cjs");
const require_version = require("./version-CO9Or_YV.cjs");
const require_client = require("./client-Y_zqKqJT.cjs");
const require_tool_visibility = require("./tool-visibility-Buq7YdUZ.cjs");
let node_url = require("node:url");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_fs = require("node:fs");
let node_fs_promises = require("node:fs/promises");
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
	"help",
	"case_open",
	"case_list",
	"case_resume",
	"case_add_evidence",
	"case_verify_evidence",
	"case_export",
	"case_update_dossier",
	"case_start_session",
	"case_end_session"
]);
const PUBLIC_GRAPHRAG_PROMPT_NAMES = new Set(["address-risk", "trace-tools"]);
const GRAPH_RESOURCE_URI = "ui://chain-insights/graph";
const GRAPH_APP_TOOL_NAMES = new Set([
	"address_risk",
	"stake_insights",
	"trace_victim_funds",
	"trace_suspect_funds",
	"trace_deposit_sources"
]);
const GRAPH_ARRAY_KEYS = [
	"nodes",
	"edges",
	"flows",
	"edge_anchors"
];
const __dirname$1 = node_path.default.dirname((0, node_url.fileURLToPath)(require("url").pathToFileURL(__filename).href));
function resolveMcpProxyMode(env = process.env) {
	const raw = env["CHAIN_INSIGHTS_MCP_PROXY_MODE"]?.trim().toLowerCase();
	if (!raw || raw === "workspace") return "workspace";
	if (raw === "stateless" || raw === "no-workspace" || raw === "workspace-less") return "stateless";
	throw new Error(`CHAIN_INSIGHTS_MCP_PROXY_MODE must be workspace or stateless; got "${raw}"`);
}
const COMMA_SEPARATED_ADDRESS_FIELDS = new Set([
	"victim_addresses",
	"known_suspect_addresses",
	"suspect_addresses",
	"deposit_addresses"
]);
const KNOWN_PUBLIC_TOOL_REQUIRED_ARGS = {
	address_risk: ["address", "network"],
	stake_insights: ["network"],
	trace_victim_funds: ["victim_addresses", "network"],
	trace_suspect_funds: ["suspect_addresses", "network"],
	trace_deposit_sources: ["deposit_addresses", "network"],
	graph_query: ["query", "network"],
	graph_query_batch: ["network", "queries"]
};
const KNOWN_PUBLIC_TOOL_DESCRIPTIONS = {
	network_capabilities: "Return supported Chain Insights networks, capability layers, tool availability, data retention windows, and freshness. Use this before choosing network-specific tools.",
	address_risk: "Screen one full blockchain address for AML risk, behavior patterns, neighborhood context, exchange exposure, and optional comparison with compare_address. This includes the exchange-behavior analysis formerly covered by money_flows_between_exchanges. Use this as the first tool for a single-address investigation. The tool returns an investigator-ready summary; preserve full addresses exactly.",
	stake_insights: "Explain Bittensor staking behavior around one full address, coldkey, or hotkey. Requires network plus exactly one of address, coldkey, or hotkey. Returns net staked/unstaked amounts, active coldkey-hotkey-netuid relationships, aggregate stake movement amounts, top counterparties, first/last activity, source backend, query evidence, and optional graph report metadata.",
	trace_victim_funds: "Trace victim/source funds forward through intermediaries to exchange deposit candidates. Use only when the input addresses are victims or trusted stolen-source addresses; do not use for suspected deposit addresses because traceback belongs to trace_deposit_sources. Exchange hot wallets are terminal only, never candidate deposits. Returns chain-insights.trace.v1 and preserves full addresses exactly.",
	trace_suspect_funds: "Trace suspected scammer, mule, operator, or laundering-ring funds forward to cashout topology. Use when the input addresses are suspect-controlled seeds; incident_timestamp_ms is optional. Do not use for victim/source addresses or suspected deposit endpoints. Exchange hot wallets are terminal only, never candidate suspects or intermediates. Returns chain-insights.trace.v1 and preserves full addresses exactly.",
	trace_deposit_sources: "Trace backward from suspected deposit/cashout addresses to upstream sources, shared funders, and convergence. Use only when the input addresses are suspected non-exchange deposit endpoints; do not treat these seeds as scammers and do not continue forward from discovered suspects here. Exchange hot wallets are excluded as seeds and upstream sources. Returns chain-insights.trace.v1 and preserves full addresses exactly.",
	graph_query: "Run a read-only GQL/Cypher query through the Chain Insights graph endpoint. Use USE live_topology for recent topology, USE archive_topology for historical topology, and USE facts for labels, features, risk scores, assets, and enrichment. Cross-layer correlated joins may be limited by the active graph endpoint; preserve full addresses exactly.",
	graph_query_batch: "Run multiple read-only GQL/Cypher queries through the Chain Insights graph endpoint in one paid batch. Prefer this for related topology/facts reads."
};
const FALLBACK_GRAPH_PRIMITIVE_TOOL_NAMES = [
	"network_capabilities",
	"graph_query",
	"graph_query_batch"
];
const NETWORK_DESCRIPTION = "Required network to query. Do not guess; use network_capabilities or ask the user if missing.";
const REMOTE_GRAPH_TOOL_REQUEST_TIMEOUT_MS = 900 * 1e3;
const CHAIN_INSIGHTS_WORKFLOW = [
	"Workflow:",
	"1. Chain Insights workspaces are Obsidian-compatible vaults. If the user is starting or continuing an investigation, use case_open or case_list/case_resume first.",
	"2. Do not call investigation tools until required arguments are known. Network is required; use network_capabilities to check supported networks, data layers, retention, and freshness, or ask the user if missing.",
	"3. Use address_risk for single-address enrichment. Use trace_victim_funds for victim/source forward tracing, trace_deposit_sources for reverse traceback from suspected deposit endpoints, and trace_suspect_funds for suspect-controlled outbound laundering/cashout topology. Use stake_insights for Bittensor staking behavior. Use graph_query(_batch) only when the high-level trace tools do not answer the exact question.",
	"4. After a material result, preserve it with case_add_evidence when a case is active or ask whether to create/select a case.",
	"5. Use case_update_dossier for durable address/entity findings and case_start_session/case_end_session for session notes.",
	"6. For local review, use live vault notes refreshed with cia case vault refresh. When a case reaches a sharing or archive checkpoint, use case_verify_evidence and case_export to produce Obsidian, LLM Wiki, Codex, Claude Code, and ChatGPT-ready handoff bundles."
].join("\n");
const GRAPH_SCHEMA_HINTS = [
	"Graph query hints for network=bittensor:",
	"- Common live topology node labels include Address and may include legacy enrichment labels. Do not depend on Exchange/Miner graph labels for correctness; use address properties such as labels and is_exchange when available.",
	"- Address nodes are identity plus traversal hints. Lifetime/global address metrics live in USE facts as AddressFeature, not as topology semantics.",
	"- Facts graph labels include Address, AddressLabel, AddressFeature, RiskScore, and Asset.",
	"- Facts graph relationships include (:Address)-[:HAS_FEATURE]->(:AddressFeature), (:Address)-[:HAS_LABEL]->(:AddressLabel), and (:Address)-[:HAS_RISK_SCORE]->(:RiskScore).",
	"- Risk and ML properties may appear as live hints, but source-of-truth risk rows are RiskScore facts.",
	"- Common relationships include FLOWS_TO, OPERATED_FROM, SERVED_FROM, REGISTERED_NEURON, BELONGS_TO, SYBIL_CLUSTER, LAYERING_HOP, BURST_ACTIVITY, CYCLE_PARTICIPANT, SMURFING_CLUSTER.",
	"- FLOWS_TO properties are scoped to the selected topology graph and commonly carry amount_sum, amount_usd_sum, tx_count, first_seen_timestamp, last_seen_timestamp, first_tx_id, last_tx_id. Confirm available fields through runtime schema before relying on them.",
	"- Traversal rule: for BFS, fixed-hop fallback, shortest-path, or manual FLOWS_TO traversal, exchange hot wallets are terminal endpoints only. Do not expand from, through, or classify exchange nodes as deposit, suspect, or intermediate candidates; filter every non-terminal node with is_exchange IS NULL.",
	"- Start schema discovery with endpoint-safe property reads: MATCH (n:Address) WHERE n.address IS NOT NULL RETURN n.labels AS labels, n.address AS address LIMIT 20",
	"- Relationship discovery: MATCH (:Address)-[r:FLOWS_TO]->(:Address) RETURN r.amount_sum AS amount_sum, r.amount_usd_sum AS amount_usd_sum LIMIT 20",
	"- graph_query uses the active Chain Insights graph endpoint. Use USE live_topology for recent topology, USE archive_topology for historical topology, and USE facts for labels, features, risk scores, assets, and enrichment.",
	"- Archive topology labels include Address and TopologySnapshot. Archived money-flow topology is represented as (:Address)-[:FLOWS_TO]->(:Address) relationships with period_granularity, period_start_date, and period_end_date.",
	"- All graph_query calls are read-only. Never use CREATE, INSERT, MERGE, SET, DELETE, REMOVE, DROP, DETACH, ADD, CONNECT, DISCONNECT, ALTER, TRUNCATE, GRANT, or REVOKE.",
	"- Use USE facts graph patterns for fact and enrichment reads. Do not query internal table namespaces directly."
].join("\n");
const GRAPH_REPORT_HINTS = [
	"Graph visualization behavior:",
	"- Graph-backed tools return the investigator report as text content and keep raw graph data out of LLM-visible structuredContent.",
	"- Raw graph data is stored locally under Chain Insights reports/graphs and exposed to the graph app as _meta.chainInsights.graph.url.",
	"- The local graph report server is started automatically by the MCP server when a graph-backed tool returns a report URL; do not ask the user to run chain-insights serve for Claude Desktop graph iframes.",
	"- If an iframe reports that a graph report fetch failed, retry the graph-backed tool call so Chain Insights can recreate the report URL and ensure the local report server is running."
].join("\n");
const SERVER_INSTRUCTIONS = [
	"Chain Insights is a local AML investigation workspace for AI agents.",
	CHAIN_INSIGHTS_WORKFLOW,
	GRAPH_REPORT_HINTS,
	GRAPH_SCHEMA_HINTS,
	"Presentation rules: preserve tool summaries as returned; never truncate blockchain addresses; use case tools to preserve evidence when a case exists."
].join("\n\n");
const STATELESS_SERVER_INSTRUCTIONS = [
	"Chain Insights is running as a stateless AML proxy for a host application.",
	"Do not use local case, evidence, dossier, session, wallet, or graph report workflows in this mode.",
	"Use network_capabilities first when network support is unknown, then call address_risk, stake_insights, trace_victim_funds, trace_suspect_funds, trace_deposit_sources, graph_query, or graph_query_batch as needed.",
	GRAPH_SCHEMA_HINTS,
	"Presentation rules: preserve tool summaries as returned; never truncate blockchain addresses."
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
function graphArtifactOrigins(config) {
	return [`http://127.0.0.1:${config.serverPort}`, `http://localhost:${config.serverPort}`];
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
			include_attachments: zod.boolean().optional().describe("Include graph app report metadata")
		};
		case "trace_victim_funds": return {
			victim_addresses: zod.string().min(1).describe("Comma-separated full victim/source addresses. Min 1, max 5."),
			network: zod.string().min(1).describe(NETWORK_DESCRIPTION),
			known_suspect_addresses: zod.string().optional().describe("Optional known suspect addresses for context only. They are not reverse-traced by this tool. Max 5."),
			incident_timestamp_ms: zod.number().min(0).optional().describe("Optional incident timestamp in milliseconds."),
			include_attachments: zod.boolean().optional().describe("Include graph app report metadata")
		};
		case "trace_suspect_funds": return {
			network: zod.string().min(1).describe(NETWORK_DESCRIPTION),
			suspect_addresses: zod.string().min(1).describe("Comma-separated full suspected scammer, mule, operator, or laundering-ring addresses. Min 1, max 5."),
			incident_timestamp_ms: zod.number().min(0).optional().describe("Optional incident timestamp in milliseconds. This tool also works without a timestamp."),
			max_hops: zod.number().int().min(1).max(5).optional().describe("Maximum forward trace hops. Default 3."),
			case_id: zod.string().optional().describe("Optional Chain Insights case ID. When provided, compact evidence is appended to the case manifest.")
		};
		case "trace_deposit_sources": return {
			network: zod.string().min(1).describe(NETWORK_DESCRIPTION),
			deposit_addresses: zod.string().min(1).describe("Comma-separated full suspected deposit/cashout addresses. Min 1, max 5."),
			max_hops: zod.number().int().min(1).max(5).optional().describe("Maximum reverse traceback hops. Default 2."),
			case_id: zod.string().optional().describe("Optional Chain Insights case ID. When provided, compact evidence is appended to the case manifest."),
			include_attachments: zod.boolean().optional().describe("Include graph app report metadata")
		};
		case "stake_insights": return {
			network: zod.string().min(1).describe(NETWORK_DESCRIPTION),
			address: zod.string().optional().describe("Full Bittensor address to inspect as either coldkey or hotkey. Provide exactly one of address, coldkey, or hotkey."),
			coldkey: zod.string().optional().describe("Full Bittensor coldkey address to inspect. Provide exactly one of address, coldkey, or hotkey."),
			hotkey: zod.string().optional().describe("Full Bittensor hotkey address to inspect. Provide exactly one of address, coldkey, or hotkey."),
			netuid: zod.number().int().min(0).optional().describe("Optional subnet netuid filter."),
			start_timestamp_ms: zod.number().min(0).optional().describe("Optional inclusive lower activity timestamp bound in milliseconds."),
			end_timestamp_ms: zod.number().min(0).optional().describe("Optional inclusive upper activity timestamp bound in milliseconds."),
			start_block: zod.number().int().min(0).optional().describe("Optional start block. Current stake graph parity may require timestamp windows instead."),
			end_block: zod.number().int().min(0).optional().describe("Optional end block. Current stake graph parity may require timestamp windows instead."),
			depth: zod.number().int().min(1).max(3).optional().describe("Optional expansion depth limit. First release returns direct STAKES_IN relationships; default 1, max 3."),
			include_attachments: zod.boolean().optional().describe("Include graph app report metadata")
		};
		case "graph_query": return {
			query: zod.string().min(1).describe("Read-only GQL/Cypher query. Use USE live_topology for recent topology, USE archive_topology for historical topology, and USE facts for labels, features, risk scores, assets, and enrichment."),
			network: zod.string().min(1).describe(NETWORK_DESCRIPTION)
		};
		case "graph_query_batch": return {
			network: zod.string().min(1).describe(NETWORK_DESCRIPTION),
			queries: zod.array(zod.object({
				id: zod.string().optional(),
				query: zod.string().min(1).describe("Read-only GQL/Cypher query")
			})).min(1).max(20),
			per_query_timeout_seconds: zod.number().int().min(1).max(600).optional()
		};
		default: return null;
	}
}
function fallbackGraphPrimitiveTools() {
	return FALLBACK_GRAPH_PRIMITIVE_TOOL_NAMES.map((name) => ({
		name,
		description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS[name]
	}));
}
function isRecord(value) {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
function redactLogValue(value) {
	if (Array.isArray(value)) return value.map(redactLogValue);
	if (!isRecord(value)) return value;
	return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
		if (/token|secret|password|private.?key|authorization/i.test(key)) return [key, "[redacted]"];
		return [key, redactLogValue(entry)];
	}));
}
function errorForLog(err) {
	const error = err;
	return {
		name: error.name ?? "Error",
		message: error.message ?? String(err)
	};
}
function sanitizeCypher(query) {
	return query.replace(/\s+/g, " ").trim();
}
function cypherLogPayload(tool, args) {
	if (!isRecord(args)) return null;
	if (tool === "graph_query") return {
		network: args.network,
		queries: [{
			id: tool,
			query: typeof args.query === "string" ? sanitizeCypher(args.query) : args.query
		}]
	};
	if (tool === "graph_query_batch") {
		const queries = Array.isArray(args.queries) ? args.queries : [];
		return {
			network: args.network,
			per_query_timeout_seconds: args.per_query_timeout_seconds,
			query_count: queries.length,
			queries: queries.map((entry, index) => isRecord(entry) ? {
				id: typeof entry.id === "string" ? entry.id : `q${index + 1}`,
				query: typeof entry.query === "string" ? sanitizeCypher(entry.query) : entry.query
			} : {
				id: `q${index + 1}`,
				query: entry
			})
		};
	}
	return null;
}
function createMcpLogger(config) {
	const disabled = process.env.CHAIN_INSIGHTS_MCP_LOG === "0";
	const filePath = process.env.CHAIN_INSIGHTS_MCP_LOG_PATH?.trim() || node_path.default.join(config.dataDir, ".chain-insights", "runtime", "logs", "mcp-proxy.jsonl");
	async function write(level, event, fields = {}) {
		if (disabled) return;
		try {
			await (0, node_fs_promises.mkdir)(node_path.default.dirname(filePath), { recursive: true });
			await (0, node_fs_promises.appendFile)(filePath, JSON.stringify({
				ts: (/* @__PURE__ */ new Date()).toISOString(),
				level,
				event,
				pid: process.pid,
				...fields
			}) + "\n", { mode: 384 });
		} catch {}
	}
	return {
		filePath,
		info: (event, fields) => write("info", event, fields),
		error: (event, fields) => write("error", event, fields)
	};
}
function installToolLogging(server, logger) {
	const existingRegisterTool = server.registerTool;
	const originalRegisterTool = existingRegisterTool.bind(server);
	const wrappedRegisterTool = ((name, config, handler) => {
		const wrapped = async (args, extra) => {
			const startedAt = Date.now();
			await logger.info("tool.start", {
				tool: name,
				args: redactLogValue(args)
			});
			try {
				const result = await handler(args, extra);
				const isError = isRecord(result) && result.isError === true;
				await logger.info("tool.end", {
					tool: name,
					duration_ms: Date.now() - startedAt,
					is_error: isError
				});
				return result;
			} catch (err) {
				await logger.error("tool.throw", {
					tool: name,
					duration_ms: Date.now() - startedAt,
					error: errorForLog(err)
				});
				throw err;
			}
		};
		return originalRegisterTool(name, config, wrapped);
	});
	Object.assign(wrappedRegisterTool, existingRegisterTool);
	server.registerTool = wrappedRegisterTool;
}
function installRemoteCypherLogging(remoteClient, logger) {
	const existingCallTool = remoteClient.callTool;
	const originalCallTool = existingCallTool.bind(remoteClient);
	const wrappedCallTool = (async (...args) => {
		const input = args[0];
		const queryPayload = cypherLogPayload(input.name, input.arguments);
		const startedAt = Date.now();
		if (queryPayload) await logger.info("topology.start", {
			tool: input.name,
			...queryPayload
		});
		try {
			const result = await originalCallTool(...args);
			if (queryPayload) await logger.info("topology.end", {
				tool: input.name,
				duration_ms: Date.now() - startedAt,
				is_error: isRecord(result) && result.isError === true
			});
			return result;
		} catch (err) {
			if (queryPayload) await logger.error("cypher.throw", {
				tool: input.name,
				duration_ms: Date.now() - startedAt,
				error: errorForLog(err)
			});
			throw err;
		}
	});
	Object.assign(wrappedCallTool, existingCallTool);
	remoteClient.callTool = wrappedCallTool;
}
function remoteToolRequestOptions(toolName) {
	if (toolName === "graph_query" || toolName === "graph_query_batch") return {
		timeout: REMOTE_GRAPH_TOOL_REQUEST_TIMEOUT_MS,
		maxTotalTimeout: REMOTE_GRAPH_TOOL_REQUEST_TIMEOUT_MS
	};
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
	if (!remotePromptNames.has("trace-tools")) server.registerPrompt("trace-tools", {
		title: "Trace Tools",
		description: "Choose trace_victim_funds, trace_deposit_sources, or trace_suspect_funds based on the evidence role.",
		argsSchema: {
			addresses: zod.string().describe("Input addresses, comma-separated full addresses"),
			role: zod.enum([
				"victim",
				"suspect",
				"deposit"
			]).describe("Role of the supplied addresses"),
			network: zod.string().describe(NETWORK_DESCRIPTION)
		}
	}, async ({ addresses, role, network }) => {
		return promptResult([
			`Use Chain Insights ${role === "deposit" ? "trace_deposit_sources" : `trace_${role}_funds`} on ${network}.`,
			"",
			"Full addresses:",
			addresses,
			"",
			role === "deposit" ? "For deposit role, use trace_deposit_sources rather than trace_deposit_funds." : "Present the summary as-is and use continuation.recommended_next_tools for follow-up."
		].join("\n"), "Trace role-specific funds");
	});
	server.registerPrompt("graph-query", {
		title: "Federated Graph Query",
		description: "Run a read-only GQL/Cypher query through the Chain Insights graph endpoint.",
		argsSchema: {
			query: zod.string().describe("Read-only GQL/Cypher query"),
			network: zod.string().describe(NETWORK_DESCRIPTION)
		}
	}, async ({ query, network }) => promptResult([
		`Use Chain Insights graph_query on ${network} with this read-only GQL/Cypher query:`,
		"",
		"```gql",
		query,
		"```",
		"",
		"Use USE live_topology for recent topology, USE archive_topology for historical topology, and USE facts for labels, features, risk scores, assets, and enrichment. Return full address properties; never shorten addresses with ellipses."
	].join("\n"), "Federated graph query"));
	server.registerPrompt("graph-query-batch", {
		title: "Federated Graph Query Batch",
		description: "Run related read-only GQL/Cypher queries through the Chain Insights graph endpoint in one paid batch.",
		argsSchema: {
			queries: zod.string().describe("JSON array of query objects with optional id and required query fields"),
			network: zod.string().describe(NETWORK_DESCRIPTION),
			per_query_timeout_seconds: zod.string().optional().describe("Optional integer timeout per query, 1-600 seconds")
		}
	}, async ({ queries, network, per_query_timeout_seconds }) => promptResult([
		`Use Chain Insights graph_query_batch on ${network} with these read-only GQL/Cypher queries:`,
		"",
		"```json",
		queries,
		"```",
		per_query_timeout_seconds ? `per_query_timeout_seconds: ${per_query_timeout_seconds}` : "",
		"",
		"Use USE live_topology for recent topology, USE archive_topology for historical topology, and USE facts for labels, features, risk scores, assets, and enrichment. Return full address properties; never shorten addresses with ellipses."
	].filter(Boolean).join("\n"), "Federated graph batch query"));
	server.registerPrompt("balance", {
		title: "Wallet Balance",
		description: "Show the local Chain Insights payment wallet address and Base USDC balance.",
		argsSchema: {}
	}, async () => promptResult("Use Chain Insights balance. Show the wallet address, network, token, and balance exactly as returned.", "Wallet balance"));
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
async function normalizeRemoteToolResult(result, config, toolName = "remote-graph", includeAttachments = true) {
	const graphPayload = getRemoteGraphPayload(result);
	const meta = { ...result._meta ?? {} };
	if (graphPayload && includeAttachments) {
		const { writeGraphReport } = await Promise.resolve().then(() => require("./graph-reports-B3mkLP8Z.cjs"));
		const { ensureArtifactServer } = await Promise.resolve().then(() => require("./artifact-server-XbN16DwU.cjs"));
		const report = await writeGraphReport(graphPayload, {
			serverPort: config.serverPort,
			slug: toolName || "remote-graph"
		});
		await ensureArtifactServer(config.serverPort);
		meta.chainInsights = {
			...meta.chainInsights ?? {},
			graph: {
				schema: report.schema,
				url: report.url
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
function shouldIncludeAttachments(args, workspaceArtifactsEnabled) {
	return workspaceArtifactsEnabled && args["include_attachments"] !== false;
}
async function writeLocalGraphMeta(graphData, config, slug, includeAttachments) {
	if (!includeAttachments) return void 0;
	const { writeGraphReport } = await Promise.resolve().then(() => require("./graph-reports-B3mkLP8Z.cjs"));
	const { ensureArtifactServer } = await Promise.resolve().then(() => require("./artifact-server-XbN16DwU.cjs"));
	const report = await writeGraphReport(graphData, {
		serverPort: config.serverPort,
		slug
	});
	await ensureArtifactServer(config.serverPort);
	return {
		schema: report.schema,
		url: report.url
	};
}
function graphMetaResult(graph) {
	return graph ? { chainInsights: { graph } } : void 0;
}
/**
* Core proxy logic — exported so tests can inject dependencies directly.
* The IIFE at the bottom calls this with real dependencies.
*
* stdout purity: NEVER write to stdout in this file. Use console.error() or process.stderr.write() only.
* All diagnostic output goes to console.error() or process.stderr.write().
*/
async function createProxy() {
	const { loadConfig } = await Promise.resolve().then(() => require("./config-BwVx19Og.cjs")).then((n) => n.config_exports);
	const { activeDataDir, findActiveWorkspace } = await Promise.resolve().then(() => require("./active-BVr55kvW.cjs")).then((n) => n.active_exports);
	const { createConfiguredGraphMcpFetch, resolveGraphMcpEndpoint } = await Promise.resolve().then(() => require("./client-Y_zqKqJT.cjs")).then((n) => n.client_exports);
	const { loadSchema, saveSchema } = await Promise.resolve().then(() => require("./schema-cache-CJk1EL3L.cjs"));
	const proxyMode = resolveMcpProxyMode();
	const workspaceArtifactsEnabled = proxyMode === "workspace";
	const loadedConfig = await loadConfig();
	const activeWorkspace = workspaceArtifactsEnabled ? findActiveWorkspace() : null;
	const config = {
		...loadedConfig,
		dataDir: workspaceArtifactsEnabled ? activeDataDir(loadedConfig.dataDir) : loadedConfig.dataDir
	};
	const logger = createMcpLogger(config);
	await logger.info("proxy.start", {
		data_dir: config.dataDir,
		workspace_root: activeWorkspace?.root,
		proxy_mode: proxyMode,
		graph_mcp_mode: config.graphMcpMode,
		graph_mcp_endpoint: resolveGraphMcpEndpoint(config),
		log_path: logger.filePath
	});
	const graphMcpEndpoint = resolveGraphMcpEndpoint(config);
	const remoteClient = new _modelcontextprotocol_sdk_client_index_js.Client({
		name: "chain-insights-proxy-client",
		version: require_version.PACKAGE_VERSION
	});
	let remoteConnected = false;
	let remoteUnavailableMessage;
	let mcpFetch;
	try {
		mcpFetch = await createConfiguredGraphMcpFetch(config);
	} catch (err) {
		await logger.error("remote.fetch_setup_failed", {
			endpoint: graphMcpEndpoint,
			error: errorForLog(err)
		});
		remoteUnavailableMessage = `Graph MCP setup unavailable at ${graphMcpEndpoint}: ${err.message}`;
		process.stderr.write(`Chain Insights MCP graph tools unavailable: ${remoteUnavailableMessage}. Local Chain Insights tools are still available.\n`);
	}
	if (mcpFetch) try {
		await remoteClient.connect(new _modelcontextprotocol_sdk_client_streamableHttp_js.StreamableHTTPClientTransport(new URL(graphMcpEndpoint), { fetch: mcpFetch }));
		remoteConnected = true;
		await logger.info("remote.connect", {
			transport: "streamable_http",
			endpoint: graphMcpEndpoint
		});
	} catch {
		await logger.error("remote.connect_failed", {
			transport: "streamable_http",
			endpoint: graphMcpEndpoint
		});
		try {
			const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");
			await remoteClient.connect(new SSEClientTransport(new URL(graphMcpEndpoint), { fetch: mcpFetch }));
			remoteConnected = true;
			await logger.info("remote.connect", {
				transport: "sse",
				endpoint: graphMcpEndpoint
			});
		} catch (err2) {
			await logger.error("remote.connect_failed", {
				transport: "sse",
				endpoint: graphMcpEndpoint,
				error: errorForLog(err2)
			});
			remoteUnavailableMessage = `Graph MCP unreachable at ${graphMcpEndpoint}: ${err2.message}`;
			process.stderr.write(`Chain Insights MCP graph tools unavailable: ${remoteUnavailableMessage}. Local Chain Insights tools are still available.\n`);
		}
	}
	if (remoteConnected) installRemoteCypherLogging(remoteClient, logger);
	let tools = await loadSchema(graphMcpEndpoint);
	if (!tools && remoteConnected) {
		tools = (await remoteClient.listTools()).tools;
		await saveSchema(tools, graphMcpEndpoint);
		await logger.info("schema.tools_loaded", {
			source: "remote",
			count: tools.length
		});
	} else if (tools) await logger.info("schema.tools_loaded", {
		source: "cache",
		count: tools.length
	});
	else {
		tools = fallbackGraphPrimitiveTools();
		await logger.info("schema.tools_loaded", {
			source: "unavailable",
			count: tools.length
		});
	}
	const remoteToolNames = new Set((tools ?? []).map((tool) => tool.name));
	const server = new _modelcontextprotocol_sdk_server_mcp_js.McpServer({
		name: "chain-insights",
		version: require_version.PACKAGE_VERSION
	}, { instructions: workspaceArtifactsEnabled ? SERVER_INSTRUCTIONS : STATELESS_SERVER_INSTRUCTIONS });
	installToolLogging(server, logger);
	const remotePrompts = [];
	if (remoteConnected) try {
		const promptResult = await remoteClient.listPrompts();
		for (const prompt of promptResult.prompts) if (PUBLIC_GRAPHRAG_PROMPT_NAMES.has(prompt.name)) remotePrompts.push(prompt);
	} catch (err) {
		await logger.error("remote.prompts_failed", {
			endpoint: graphMcpEndpoint,
			error: errorForLog(err)
		});
		process.stderr.write(`Chain Insights MCP prompt passthrough unavailable at ${graphMcpEndpoint}: ${err.message}\n`);
	}
	const remotePromptNames = new Set(remotePrompts.map((prompt) => prompt.name));
	for (const prompt of remotePrompts) registerRemotePrompt(server, remoteClient, prompt);
	registerLocalPrompts(server, remotePromptNames);
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
	if (workspaceArtifactsEnabled) {
		server.registerTool("balance", {
			description: "Show the local Chain Insights payment wallet address and Base USDC balance.",
			inputSchema: zod.object({}).passthrough()
		}, async () => {
			try {
				const { getWalletAccount, getWalletBalanceText } = await Promise.resolve().then(() => require("./tools-BhTI3Lmg.cjs")).then((n) => n.tools_exports);
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
		(0, _modelcontextprotocol_ext_apps_server.registerAppResource)(server, "Fund Flow Graph", GRAPH_RESOURCE_URI, {
			description: "Interactive D3 force-directed graph for fund flow and pattern visualization. It loads local graph report URLs returned in _meta.chainInsights.graph.url.",
			_meta: { ui: { csp: {
				resourceDomains: graphArtifactOrigins(config),
				connectDomains: graphArtifactOrigins(config)
			} } }
		}, async () => ({ contents: [{
			uri: GRAPH_RESOURCE_URI,
			mimeType: _modelcontextprotocol_ext_apps_server.RESOURCE_MIME_TYPE,
			text: readGraphAppHtml(),
			_meta: { ui: { csp: {
				resourceDomains: graphArtifactOrigins(config),
				connectDomains: graphArtifactOrigins(config)
			} } }
		}] }));
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
				const { CaseStore } = await Promise.resolve().then(() => require("./cases-Bz_9XKEw.cjs")).then((n) => n.cases_exports);
				const created = await CaseStore.create({
					name,
					tags: parseTags(tags),
					description: description ?? ""
				});
				const { casesRoot } = await Promise.resolve().then(() => require("./store-CQhU8dz8.cjs")).then((n) => n.store_exports);
				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							case_id: created.id,
							name: created.name,
							status: created.status,
							tags: created.tags,
							directory: `${node_path.default.join(casesRoot(), created.id)}/`
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
				const { CaseStore } = await Promise.resolve().then(() => require("./cases-Bz_9XKEw.cjs")).then((n) => n.cases_exports);
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
				const { CaseStore } = await Promise.resolve().then(() => require("./cases-Bz_9XKEw.cjs")).then((n) => n.cases_exports);
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
			description: "Append a tool result or analyst note to a local case evidence manifest. Use after address_risk, trace_victim_funds, trace_suspect_funds, trace_deposit_sources, graph_query, or manual findings that should be preserved.",
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
				const { EvidenceStore } = await Promise.resolve().then(() => require("./cases-Bz_9XKEw.cjs")).then((n) => n.cases_exports);
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
				const { EvidenceStore } = await Promise.resolve().then(() => require("./cases-Bz_9XKEw.cjs")).then((n) => n.cases_exports);
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
		server.registerTool("case_export", {
			description: "Export a Chain Insights case to an Obsidian, LLM Wiki, Codex, Claude Code, and ChatGPT-friendly handoff bundle.",
			inputSchema: {
				case_id: zod.string().min(1).describe("Chain Insights case ID to export"),
				target: zod.enum(["obsidian-llmwiki"]).optional().describe("Export target. Default obsidian-llmwiki."),
				mode: zod.enum([
					"private",
					"partner",
					"public"
				]).optional().describe("Redaction mode. Default private."),
				output_dir: zod.string().optional().describe("Optional output directory. Defaults to published/<case-slug>.")
			},
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: false
			}
		}, async ({ case_id, target, mode, output_dir }) => {
			try {
				const { exportCase } = await Promise.resolve().then(() => require("./export-D4v4-6F4.cjs"));
				const result = await exportCase({
					caseId: case_id,
					target: target ?? "obsidian-llmwiki",
					mode: mode ?? "private",
					outputDir: output_dir
				});
				return {
					content: [{
						type: "text",
						text: [
							`Case exported: ${result.outputDir}`,
							`Manifest: ${result.manifestPath}`,
							`Files: ${result.fileCount}`,
							`Open first: ${result.nextFile}`,
							...result.warnings.map((warning) => `Warning: ${warning}`)
						].join("\n")
					}],
					structuredContent: result,
					isError: false
				};
			} catch (err) {
				return caseToolError("Case export", err);
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
				const { DossierStore } = await Promise.resolve().then(() => require("./cases-Bz_9XKEw.cjs")).then((n) => n.cases_exports);
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
				const { SessionStore } = await Promise.resolve().then(() => require("./cases-Bz_9XKEw.cjs")).then((n) => n.cases_exports);
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
				const { SessionStore } = await Promise.resolve().then(() => require("./cases-Bz_9XKEw.cjs")).then((n) => n.cases_exports);
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
	}
	if (!remoteToolNames.has("address_risk")) (0, _modelcontextprotocol_ext_apps_server.registerAppTool)(server, "address_risk", {
		title: "Address Risk",
		description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.address_risk,
		inputSchema: {
			address: zod.string().min(1).describe("Full blockchain address to screen"),
			network: zod.string().min(1).describe(NETWORK_DESCRIPTION),
			compare_address: zod.string().optional().describe("Optional second full address for comparison"),
			include_attachments: zod.boolean().optional().describe("Include graph app report metadata")
		},
		_meta: { ui: { resourceUri: GRAPH_RESOURCE_URI } },
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: true
		}
	}, async ({ address, network, compare_address, include_attachments }) => {
		try {
			if (!remoteConnected) return {
				content: [{
					type: "text",
					text: `${remoteUnavailableMessage ?? `Graph MCP is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`
				}],
				isError: true
			};
			const { addressRisk } = await Promise.resolve().then(() => require("./public-tools-BY3PTw6x.cjs"));
			const result = await addressRisk(remoteClient, {
				address,
				network,
				compareAddress: compare_address
			});
			const graph = await writeLocalGraphMeta(result.graphData, config, `address-risk-${network}-${address}`, shouldIncludeAttachments({ include_attachments }, workspaceArtifactsEnabled));
			return {
				content: [{
					type: "text",
					text: result.summaryText
				}],
				structuredContent: result.structuredContent,
				_meta: graphMetaResult(graph),
				isError: false
			};
		} catch (err) {
			if (err instanceof require_client.PaymentRequiredError) return {
				content: [{
					type: "text",
					text: err.message
				}],
				isError: true
			};
			return {
				content: [{
					type: "text",
					text: `Address risk failed: ${err.message}`
				}],
				isError: true
			};
		}
	});
	if (!remoteToolNames.has("trace_victim_funds")) (0, _modelcontextprotocol_ext_apps_server.registerAppTool)(server, "trace_victim_funds", {
		title: "Trace Victim Funds",
		description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.trace_victim_funds,
		inputSchema: {
			victim_addresses: zod.union([zod.string().min(1), zod.array(zod.string().min(1))]).describe("Comma-separated full victim/source addresses, or an array. Min 1, max 5."),
			network: zod.string().min(1).describe(NETWORK_DESCRIPTION),
			known_suspect_addresses: zod.union([zod.string(), zod.array(zod.string())]).optional().describe("Known suspect addresses for context only. This tool does not reverse-trace them. Max 5."),
			include_attachments: zod.boolean().optional().describe("Include graph app report metadata"),
			case_id: zod.string().optional().describe("Optional Chain Insights case ID. When provided, compact evidence is appended to the case manifest."),
			incident_timestamp_ms: zod.number().min(0).optional().describe("Optional incident timestamp in milliseconds."),
			max_hops: zod.number().int().min(1).max(5).optional(),
			per_address_limit: zod.number().int().min(1).max(10).optional(),
			min_amount_sum: zod.number().min(0).optional()
		},
		_meta: { ui: { resourceUri: GRAPH_RESOURCE_URI } },
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: true
		}
	}, async ({ victim_addresses, known_suspect_addresses, network, case_id, incident_timestamp_ms, max_hops, per_address_limit, min_amount_sum, include_attachments }) => {
		try {
			if (!remoteConnected) return {
				content: [{
					type: "text",
					text: `${remoteUnavailableMessage ?? `Graph MCP is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`
				}],
				isError: true
			};
			if (!workspaceArtifactsEnabled && case_id) return {
				content: [{
					type: "text",
					text: "case_id requires Chain Insights workspace mode; omit case_id when CHAIN_INSIGHTS_MCP_PROXY_MODE=stateless."
				}],
				isError: true
			};
			const { traceVictimFunds } = await Promise.resolve().then(() => require("./public-tools-BY3PTw6x.cjs"));
			const result = await traceVictimFunds(remoteClient, config, {
				victimAddresses: victim_addresses,
				knownSuspectAddresses: known_suspect_addresses,
				network,
				caseId: case_id,
				incidentTimestampMs: incident_timestamp_ms,
				maxHops: max_hops,
				perAddressLimit: per_address_limit,
				minAmountSum: min_amount_sum,
				writeArtifacts: workspaceArtifactsEnabled
			});
			const graph = await writeLocalGraphMeta(result.graphData, config, `trace-victim-funds-${network}`, shouldIncludeAttachments({ include_attachments }, workspaceArtifactsEnabled));
			return {
				content: [{
					type: "text",
					text: result.summaryText
				}],
				structuredContent: result.structuredContent,
				_meta: graphMetaResult(graph),
				isError: false
			};
		} catch (err) {
			if (err instanceof require_client.PaymentRequiredError) return {
				content: [{
					type: "text",
					text: err.message
				}],
				isError: true
			};
			return {
				content: [{
					type: "text",
					text: `Trace victim funds failed: ${err.message}`
				}],
				isError: true
			};
		}
	});
	if (!remoteToolNames.has("trace_suspect_funds")) (0, _modelcontextprotocol_ext_apps_server.registerAppTool)(server, "trace_suspect_funds", {
		title: "Trace Suspect Funds",
		description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.trace_suspect_funds,
		inputSchema: {
			network: zod.string().min(1).describe(NETWORK_DESCRIPTION),
			suspect_addresses: zod.union([zod.string().min(1), zod.array(zod.string().min(1))]).describe("Comma-separated full suspect-controlled addresses, or an array. Min 1, max 5."),
			incident_timestamp_ms: zod.number().min(0).optional().describe("Optional incident timestamp in milliseconds. This tool works without it."),
			max_hops: zod.number().int().min(1).max(5).optional().describe("Maximum forward trace hops. Default 3."),
			per_address_limit: zod.number().int().min(1).max(10).optional(),
			min_amount_sum: zod.number().min(0).optional(),
			case_id: zod.string().optional().describe("Optional Chain Insights case ID. When provided, compact evidence is appended to the case manifest."),
			include_attachments: zod.boolean().optional().describe("Include graph app report metadata")
		},
		_meta: { ui: { resourceUri: GRAPH_RESOURCE_URI } },
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: true
		}
	}, async ({ suspect_addresses, incident_timestamp_ms, network, max_hops, per_address_limit, min_amount_sum, case_id, include_attachments }) => {
		try {
			if (!remoteConnected) return {
				content: [{
					type: "text",
					text: `${remoteUnavailableMessage ?? `Graph MCP is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`
				}],
				isError: true
			};
			if (!workspaceArtifactsEnabled && case_id) return {
				content: [{
					type: "text",
					text: "case_id requires Chain Insights workspace mode; omit case_id when CHAIN_INSIGHTS_MCP_PROXY_MODE=stateless."
				}],
				isError: true
			};
			const { traceSuspectFunds } = await Promise.resolve().then(() => require("./public-tools-BY3PTw6x.cjs"));
			const result = await traceSuspectFunds(remoteClient, config, {
				suspectAddresses: suspect_addresses,
				network,
				maxHops: max_hops,
				perAddressLimit: per_address_limit,
				minAmountSum: min_amount_sum,
				incidentTimestampMs: incident_timestamp_ms,
				caseId: case_id,
				writeArtifacts: workspaceArtifactsEnabled
			});
			const graph = await writeLocalGraphMeta(result.graphData, config, `trace-suspect-funds-${network}`, shouldIncludeAttachments({ include_attachments }, workspaceArtifactsEnabled));
			return {
				content: [{
					type: "text",
					text: result.summaryText
				}],
				structuredContent: result.structuredContent,
				_meta: graphMetaResult(graph),
				isError: false
			};
		} catch (err) {
			if (err instanceof require_client.PaymentRequiredError) return {
				content: [{
					type: "text",
					text: err.message
				}],
				isError: true
			};
			return {
				content: [{
					type: "text",
					text: `Trace suspect funds failed: ${err.message}`
				}],
				isError: true
			};
		}
	});
	if (!remoteToolNames.has("trace_deposit_sources")) (0, _modelcontextprotocol_ext_apps_server.registerAppTool)(server, "trace_deposit_sources", {
		title: "Trace Deposit Sources",
		description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.trace_deposit_sources,
		inputSchema: {
			network: zod.string().min(1).describe(NETWORK_DESCRIPTION),
			deposit_addresses: zod.union([zod.string().min(1), zod.array(zod.string().min(1))]).describe("Comma-separated full suspected deposit/cashout addresses, or an array. Min 1, max 5."),
			max_hops: zod.number().int().min(1).max(5).optional().describe("Maximum reverse traceback hops. Default 2."),
			case_id: zod.string().optional().describe("Optional Chain Insights case ID. When provided, compact evidence is appended to the case manifest."),
			include_attachments: zod.boolean().optional().describe("Include graph app report metadata")
		},
		_meta: { ui: { resourceUri: GRAPH_RESOURCE_URI } },
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: true
		}
	}, async ({ deposit_addresses, network, max_hops, case_id, include_attachments }) => {
		try {
			if (!remoteConnected) return {
				content: [{
					type: "text",
					text: `${remoteUnavailableMessage ?? `Graph MCP is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`
				}],
				isError: true
			};
			if (!workspaceArtifactsEnabled && case_id) return {
				content: [{
					type: "text",
					text: "case_id requires Chain Insights workspace mode; omit case_id when CHAIN_INSIGHTS_MCP_PROXY_MODE=stateless."
				}],
				isError: true
			};
			const { traceDepositSources } = await Promise.resolve().then(() => require("./public-tools-BY3PTw6x.cjs"));
			const result = await traceDepositSources(remoteClient, config, {
				depositAddresses: deposit_addresses,
				network,
				maxHops: max_hops,
				caseId: case_id,
				writeArtifacts: workspaceArtifactsEnabled
			});
			const graph = await writeLocalGraphMeta(result.graphData, config, `trace-deposit-sources-${network}`, shouldIncludeAttachments({ include_attachments }, workspaceArtifactsEnabled));
			return {
				content: [{
					type: "text",
					text: result.summaryText
				}],
				structuredContent: result.structuredContent,
				_meta: graphMetaResult(graph),
				isError: false
			};
		} catch (err) {
			if (err instanceof require_client.PaymentRequiredError) return {
				content: [{
					type: "text",
					text: err.message
				}],
				isError: true
			};
			return {
				content: [{
					type: "text",
					text: `Trace deposit sources failed: ${err.message}`
				}],
				isError: true
			};
		}
	});
	if (!remoteToolNames.has("stake_insights")) (0, _modelcontextprotocol_ext_apps_server.registerAppTool)(server, "stake_insights", {
		title: "Stake Insights",
		description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.stake_insights,
		inputSchema: {
			network: zod.string().min(1).describe(NETWORK_DESCRIPTION),
			address: zod.string().optional().describe("Full Bittensor address to inspect as either coldkey or hotkey. Provide exactly one of address, coldkey, or hotkey."),
			coldkey: zod.string().optional().describe("Full Bittensor coldkey address to inspect. Provide exactly one of address, coldkey, or hotkey."),
			hotkey: zod.string().optional().describe("Full Bittensor hotkey address to inspect. Provide exactly one of address, coldkey, or hotkey."),
			netuid: zod.number().int().min(0).optional().describe("Optional subnet netuid filter."),
			start_timestamp_ms: zod.number().min(0).optional().describe("Optional inclusive lower activity timestamp bound in milliseconds."),
			end_timestamp_ms: zod.number().min(0).optional().describe("Optional inclusive upper activity timestamp bound in milliseconds."),
			start_block: zod.number().int().min(0).optional().describe("Optional start block. Current stake graph parity may require timestamp windows instead."),
			end_block: zod.number().int().min(0).optional().describe("Optional end block. Current stake graph parity may require timestamp windows instead."),
			depth: zod.number().int().min(1).max(3).optional().describe("Optional expansion depth limit. First release returns direct STAKES_IN relationships; default 1, max 3."),
			include_attachments: zod.boolean().optional().describe("Include graph app report metadata")
		},
		_meta: { ui: { resourceUri: GRAPH_RESOURCE_URI } },
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: true
		}
	}, async ({ network, address, coldkey, hotkey, netuid, start_timestamp_ms, end_timestamp_ms, start_block, end_block, depth, include_attachments }) => {
		try {
			if (!remoteConnected) return {
				content: [{
					type: "text",
					text: `${remoteUnavailableMessage ?? `Graph MCP is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`
				}],
				isError: true
			};
			const { stakeInsights } = await Promise.resolve().then(() => require("./public-tools-BY3PTw6x.cjs"));
			const result = await stakeInsights(remoteClient, {
				network,
				address,
				coldkey,
				hotkey,
				netuid,
				startTimestampMs: start_timestamp_ms,
				endTimestampMs: end_timestamp_ms,
				startBlock: start_block,
				endBlock: end_block,
				depth
			});
			const subject = address ?? coldkey ?? hotkey ?? "subject";
			const graph = await writeLocalGraphMeta(result.graphData, config, `stake-insights-${network}-${subject}`, shouldIncludeAttachments({ include_attachments }, workspaceArtifactsEnabled));
			return {
				content: [{
					type: "text",
					text: result.summaryText
				}],
				structuredContent: result.structuredContent,
				_meta: graphMetaResult(graph),
				isError: false
			};
		} catch (err) {
			if (err instanceof require_client.PaymentRequiredError) return {
				content: [{
					type: "text",
					text: err.message
				}],
				isError: true
			};
			return {
				content: [{
					type: "text",
					text: `Stake insights failed: ${err.message}`
				}],
				isError: true
			};
		}
	});
	server.registerTool("help", {
		description: "Show Chain Insights overview, available tools, and investigation workflow.",
		inputSchema: zod.object({}).passthrough()
	}, async () => ({
		content: [{
			type: "text",
			text: workspaceArtifactsEnabled ? [
				"Chain Insights AML investigation workspace for AI agents. Workspaces are Obsidian-compatible vaults backed by plain local files.",
				"",
				CHAIN_INSIGHTS_WORKFLOW,
				"",
				"Investigation tools:",
				"- network_capabilities: inspect supported networks, data layers, tool availability, retention windows, and freshness.",
				"- address_risk: screen a full address for AML risk, behavior, neighborhood, exchange exposure, and optional compare_address connection checks.",
				"- stake_insights: explain Bittensor staking around one address, coldkey, or hotkey with net stake, movement amounts, counterparties, backend, and query evidence.",
				"- trace_victim_funds: trace up to five victim/source addresses forward to exchange deposit candidates.",
				"- trace_deposit_sources: trace backward from suspected deposit/cashout addresses to upstream funders and shared-source convergence.",
				"- trace_suspect_funds: trace up to five suspected scammer, mule, operator, or laundering-ring addresses forward to cashout topology.",
				"- graph_query: run read-only GQL/Cypher through the universal graph endpoint. Use USE live_topology, USE archive_topology, or USE facts.",
				"- graph_query_batch: run related read-only graph-language queries through one paid graph call.",
				"",
				"Case workflow tools:",
				"- case_open: create a local case before preserving evidence.",
				"- case_list: list local cases.",
				"- case_resume: load case context, evidence count, dossiers, and latest session.",
				"- case_add_evidence: append a report or note to the case evidence manifest.",
				"- case_verify_evidence: verify saved evidence integrity.",
				"- case_export: export a case for Obsidian, LLM Wiki, Codex, Claude Code, and ChatGPT handoff bundles.",
				"- case_update_dossier: add a finding to an address/entity dossier.",
				"- case_start_session and case_end_session: record session notes.",
				"",
				"Wallet tools:",
				"- balance: show the local payment wallet address and Base USDC balance.",
				"- help: show this overview.",
				"",
				GRAPH_REPORT_HINTS,
				"",
				GRAPH_SCHEMA_HINTS
			].join("\n") : [
				"Chain Insights stateless AML proxy for host applications.",
				"",
				"Local workspace, case, evidence, dossier, session, wallet, and graph report attachment tools are disabled in this mode.",
				"",
				"Available graph-backed tools:",
				"- network_capabilities: inspect supported networks, data layers, tool availability, retention windows, and freshness.",
				"- address_risk: screen a full address for AML risk, behavior, neighborhood, exchange exposure, and optional compare_address connection checks.",
				"- stake_insights: explain Bittensor staking around one address, coldkey, or hotkey with net stake, movement amounts, counterparties, backend, and query evidence.",
				"- trace_victim_funds: trace up to five victim/source addresses forward to exchange deposit candidates.",
				"- trace_deposit_sources: trace backward from suspected deposit/cashout addresses to upstream funders and shared-source convergence.",
				"- trace_suspect_funds: trace up to five suspected scammer, mule, operator, or laundering-ring addresses forward to cashout topology.",
				"- graph_query: run read-only GQL/Cypher through the universal graph endpoint. Use USE live_topology, USE archive_topology, or USE facts.",
				"- graph_query_batch: run related read-only graph-language queries through one paid graph call.",
				"",
				GRAPH_SCHEMA_HINTS
			].join("\n")
		}],
		isError: false
	}));
	for (const tool of tools ?? []) {
		if (require_tool_visibility.HIDDEN_REMOTE_TOOL_NAMES.has(tool.name)) continue;
		if (LOCAL_TOOL_NAMES.has(tool.name)) continue;
		const inputSchema = knownPublicToolInputSchema(tool.name) ?? zod.object({}).passthrough();
		const handler = async (args) => {
			try {
				if (!remoteConnected) return {
					content: [{
						type: "text",
						text: `${remoteUnavailableMessage ?? `Graph MCP is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`
					}],
					isError: true
				};
				const normalizedArgs = normalizeRemoteToolArguments(tool.name, args);
				const validationError = validateKnownPublicToolArguments(tool.name, normalizedArgs);
				if (validationError) return {
					content: [{
						type: "text",
						text: validationError
					}],
					isError: true
				};
				const request = {
					name: tool.name,
					arguments: normalizedArgs
				};
				const requestOptions = remoteToolRequestOptions(tool.name);
				return await normalizeRemoteToolResult(requestOptions ? await remoteClient.callTool(request, void 0, requestOptions) : await remoteClient.callTool(request), config, tool.name, shouldIncludeAttachments(normalizedArgs, workspaceArtifactsEnabled));
			} catch (err) {
				if (err instanceof require_client.PaymentRequiredError) return {
					content: [{
						type: "text",
						text: err.message
					}],
					isError: true
				};
				const msg = err.message ?? String(err);
				if (/\b402\b/.test(msg) || msg.toLowerCase().includes("payment")) return {
					content: [{
						type: "text",
						text: `Payment required for ${tool.name}. This tool costs USDC on Base via x402 micropayments. Next steps: run \`chain-insights wallet ready\` to check funding and finish one-time payment setup, run \`chain-insights wallet topup\` if it says the wallet needs USDC, or \`chain-insights access-key set <key>\` if you have been given test access.`
					}],
					isError: true
				};
				return {
					content: [{
						type: "text",
						text: `MCP call failed: ${msg}`
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
	await logger.info("proxy.ready", { tools: [...LOCAL_TOOL_NAMES, ...(tools ?? []).map((tool) => tool.name).filter((name) => !require_tool_visibility.HIDDEN_REMOTE_TOOL_NAMES.has(name) && !LOCAL_TOOL_NAMES.has(name))].length });
	const shutdown = async () => {
		await logger.info("proxy.shutdown");
		transport.close();
		process.exit(0);
	};
	process.on("SIGINT", () => {
		shutdown();
	});
	process.on("SIGTERM", () => {
		shutdown();
	});
}
if (process.argv[1] && require("url").pathToFileURL(__filename).href.includes(process.argv[1].replace(/\\/g, "/"))) createProxy().catch((err) => {
	process.stderr.write(`Chain Insights MCP proxy startup failed: ${err.message}\n`);
	process.exit(1);
});
//#endregion
exports.createProxy = createProxy;
exports.resolveMcpProxyMode = resolveMcpProxyMode;
