Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const require_chunk = require("./chunk-CZWwpsFl.cjs");
const require_version = require("./version-BNGtdpmH.cjs");
const require_client = require("./client-Dr53wTb9.cjs");
const require_tool_visibility = require("./tool-visibility-CwgY205r.cjs");
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
	"case_update_dossier",
	"case_start_session",
	"case_end_session"
]);
const PUBLIC_GRAPHRAG_PROMPT_NAMES = new Set(["address-risk", "track-funds"]);
const GRAPH_RESOURCE_URI = "ui://chain-insights/graph";
const GRAPH_APP_TOOL_NAMES = new Set([
	"address_risk",
	"scam_topology",
	"track_funds"
]);
const GRAPH_ARRAY_KEYS = [
	"nodes",
	"edges",
	"flows",
	"edge_anchors"
];
const __dirname$1 = node_path.default.dirname((0, node_url.fileURLToPath)(require("url").pathToFileURL(__filename).href));
const COMMA_SEPARATED_ADDRESS_FIELDS = new Set(["trusted_addresses", "untrusted_addresses"]);
const KNOWN_PUBLIC_TOOL_REQUIRED_ARGS = {
	address_risk: ["address", "network"],
	scam_topology: [
		"victim_address",
		"incident_timestamp_ms",
		"network"
	],
	track_funds: ["trusted_addresses", "network"],
	graph_query: ["query", "network"],
	graph_query_batch: ["network", "queries"]
};
const KNOWN_PUBLIC_TOOL_DESCRIPTIONS = {
	network_capabilities: "Return supported Chain Insights networks, capability layers, tool availability, data retention windows, and freshness. Use this before choosing network-specific tools.",
	address_risk: "Screen one full blockchain address for AML risk, behavior patterns, neighborhood context, exchange exposure, and optional comparison with compare_address. This includes the exchange-behavior analysis formerly covered by money_flows_between_exchanges. Use this as the first tool for a single-address investigation. The tool returns an investigator-ready summary; preserve full addresses exactly.",
	scam_topology: "Build victim-incident laundering topology from one victim/source address and the earliest known incident timestamp. Traversal uses one explicit activity policy: node_relative_only by default, or global_incident_only when requested. Repeated targets are kept as non-expanding convergence edges. Returns ML-ready scam_labels plus review context and a track_funds-compatible graph report: primary flows, deposits, reverse_leads. Victims, exchange endpoints, and generic labeled context nodes are not automatic scam labels; preserve full addresses exactly.",
	track_funds: "Trace funds from trusted victim/source addresses through intermediaries to exchange deposit addresses. Use this when the user has a victim/source address or known untrusted/scammer addresses. The tool returns an investigator-ready fund-flow report and recommended next actions.",
	graph_query: "Run a read-only GQL/Cypher query through the Chain Insights graph endpoint. Use USE live_topology for recent topology, USE archive_topology for historical topology, and USE facts for labels, features, risk scores, assets, and enrichment. Cross-layer correlated joins may be limited by the active graph endpoint; preserve full addresses exactly.",
	graph_query_batch: "Run multiple read-only GQL/Cypher queries through the Chain Insights graph endpoint in one paid batch. Prefer this for related topology/facts reads."
};
const NETWORK_DESCRIPTION = "Required network to query. Do not guess; use network_capabilities or ask the user if missing.";
const REMOTE_GRAPH_TOOL_REQUEST_TIMEOUT_MS = 900 * 1e3;
const CHAIN_INSIGHTS_WORKFLOW = [
	"Workflow:",
	"1. If the user is starting or continuing an investigation, use case_open or case_list/case_resume first.",
	"2. Do not call investigation tools until required arguments are known. Network is required; use network_capabilities to check supported networks, data layers, retention, and freshness, or ask the user if missing.",
	"3. Use address_risk first for a single address when facts and topology are available. Use track_funds for victim/source fund tracing when topology is available. Use scam_topology when known victim incident ground truth should become ML-ready scam labels. Use graph_query(_batch) for the universal graph-language path over topology and facts.",
	"4. After a material result, preserve it with case_add_evidence when a case is active or ask whether to create/select a case.",
	"5. Use case_update_dossier for durable address/entity findings and case_start_session/case_end_session for session notes."
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
		case "track_funds": return {
			trusted_addresses: zod.string().min(1).describe("Comma-separated full trusted victim addresses. Min 1, max 5."),
			network: zod.string().min(1).describe(NETWORK_DESCRIPTION),
			untrusted_addresses: zod.string().optional().describe("Comma-separated full untrusted/scammer addresses. Max 5."),
			include_attachments: zod.boolean().optional().describe("Include graph app report metadata")
		};
		case "scam_topology": return {
			network: zod.string().min(1).describe(NETWORK_DESCRIPTION),
			victim_address: zod.string().min(1).describe("Full victim/source address that anchors the scam incident. Victims are not risky labels."),
			incident_timestamp_ms: zod.number().min(0).describe("Earliest known incident transfer timestamp in milliseconds. Primary traversal uses node-relative wave-arrival filtering."),
			max_hops: zod.number().int().min(1).max(64).optional().describe("Maximum forward expansion depth. Default 16."),
			activity_policy: zod.enum(["node_relative_only", "global_incident_only"]).optional().describe("Traversal activity policy. Default node_relative_only."),
			case_id: zod.string().optional().describe("Optional Chain Insights case ID. When provided, compact evidence is appended to the case manifest.")
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
async function normalizeRemoteToolResult(result, config, toolName = "remote-graph") {
	const graphPayload = getRemoteGraphPayload(result);
	const meta = { ...result._meta ?? {} };
	if (graphPayload) {
		const { writeGraphReport } = await Promise.resolve().then(() => require("./graph-reports-DU05YCei.cjs"));
		const { ensureArtifactServer } = await Promise.resolve().then(() => require("./artifact-server-DjSY9q-J.cjs"));
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
/**
* Core proxy logic — exported so tests can inject dependencies directly.
* The IIFE at the bottom calls this with real dependencies.
*
* stdout purity: NEVER write to stdout in this file. Use console.error() or process.stderr.write() only.
* All diagnostic output goes to console.error() or process.stderr.write().
*/
async function createProxy() {
	const { loadConfig } = await Promise.resolve().then(() => require("./config-B9ZTUEUS.cjs")).then((n) => n.config_exports);
	const { activeDataDir, findActiveWorkspace } = await Promise.resolve().then(() => require("./active-Dv7Tu-O4.cjs")).then((n) => n.active_exports);
	const { createConfiguredGraphMcpFetch, resolveGraphMcpEndpoint } = await Promise.resolve().then(() => require("./client-Dr53wTb9.cjs")).then((n) => n.client_exports);
	const { loadSchema, saveSchema } = await Promise.resolve().then(() => require("./schema-cache-CgWRCN2N.cjs"));
	const loadedConfig = await loadConfig();
	const activeWorkspace = findActiveWorkspace();
	const config = {
		...loadedConfig,
		dataDir: activeDataDir(loadedConfig.dataDir)
	};
	const logger = createMcpLogger(config);
	await logger.info("proxy.start", {
		data_dir: config.dataDir,
		workspace_root: activeWorkspace?.root,
		graph_mcp_mode: config.graphMcpMode,
		graph_mcp_endpoint: resolveGraphMcpEndpoint(config),
		log_path: logger.filePath
	});
	const mcpFetch = await createConfiguredGraphMcpFetch(config);
	const graphMcpEndpoint = resolveGraphMcpEndpoint(config);
	const remoteClient = new _modelcontextprotocol_sdk_client_index_js.Client({
		name: "chain-insights-proxy-client",
		version: require_version.PACKAGE_VERSION
	});
	let remoteConnected = false;
	let remoteUnavailableMessage;
	try {
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
		tools = [];
		await logger.info("schema.tools_loaded", {
			source: "unavailable",
			count: 0
		});
	}
	const remoteToolNames = new Set((tools ?? []).map((tool) => tool.name));
	const server = new _modelcontextprotocol_sdk_server_mcp_js.McpServer({
		name: "chain-insights",
		version: require_version.PACKAGE_VERSION
	}, { instructions: SERVER_INSTRUCTIONS });
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
	server.registerTool("balance", {
		description: "Show the local Chain Insights payment wallet address and Base USDC balance.",
		inputSchema: zod.object({}).passthrough()
	}, async () => {
		try {
			const { getWalletAccount, getWalletBalanceText } = await Promise.resolve().then(() => require("./tools-f_vJUZAF.cjs")).then((n) => n.tools_exports);
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
			const { CaseStore } = await Promise.resolve().then(() => require("./cases-CDcNU91B.cjs"));
			const created = await CaseStore.create({
				name,
				tags: parseTags(tags),
				description: description ?? ""
			});
			const { casesRoot } = await Promise.resolve().then(() => require("./store-BiUhQOIf.cjs"));
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
			const { CaseStore } = await Promise.resolve().then(() => require("./cases-CDcNU91B.cjs"));
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
			const { CaseStore } = await Promise.resolve().then(() => require("./cases-CDcNU91B.cjs"));
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
			const { EvidenceStore } = await Promise.resolve().then(() => require("./cases-CDcNU91B.cjs"));
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
			const { EvidenceStore } = await Promise.resolve().then(() => require("./cases-CDcNU91B.cjs"));
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
			const { DossierStore } = await Promise.resolve().then(() => require("./cases-CDcNU91B.cjs"));
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
			const { SessionStore } = await Promise.resolve().then(() => require("./cases-CDcNU91B.cjs"));
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
			const { SessionStore } = await Promise.resolve().then(() => require("./cases-CDcNU91B.cjs"));
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
	}, async ({ address, network, compare_address }) => {
		try {
			if (!remoteConnected) return {
				content: [{
					type: "text",
					text: `${remoteUnavailableMessage ?? `Graph MCP is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`
				}],
				isError: true
			};
			const { addressRisk } = await Promise.resolve().then(() => require("./public-tools-XSpkz2ky.cjs"));
			const { writeGraphReport } = await Promise.resolve().then(() => require("./graph-reports-DU05YCei.cjs"));
			const { ensureArtifactServer } = await Promise.resolve().then(() => require("./artifact-server-DjSY9q-J.cjs"));
			const result = await addressRisk(remoteClient, {
				address,
				network,
				compareAddress: compare_address
			});
			const report = await writeGraphReport(result.graphData, {
				serverPort: config.serverPort,
				slug: `address-risk-${network}-${address}`
			});
			await ensureArtifactServer(config.serverPort);
			return {
				content: [{
					type: "text",
					text: result.summaryText
				}],
				structuredContent: result.structuredContent,
				_meta: { chainInsights: { graph: {
					schema: report.schema,
					url: report.url
				} } },
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
	if (!remoteToolNames.has("track_funds")) (0, _modelcontextprotocol_ext_apps_server.registerAppTool)(server, "track_funds", {
		title: "Track Funds",
		description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.track_funds,
		inputSchema: {
			trusted_addresses: zod.union([zod.string().min(1), zod.array(zod.string().min(1))]).describe("Comma-separated full trusted victim addresses, or an array. Min 1, max 5."),
			network: zod.string().min(1).describe(NETWORK_DESCRIPTION),
			untrusted_addresses: zod.union([zod.string(), zod.array(zod.string())]).optional().describe("Known scammer/untrusted addresses. Max 5."),
			include_attachments: zod.boolean().optional().describe("Include graph app report metadata"),
			case_id: zod.string().optional().describe("Optional Chain Insights case ID. When provided, compact evidence is appended to the case manifest."),
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
	}, async ({ trusted_addresses, untrusted_addresses, network, case_id, max_hops, per_address_limit, min_amount_sum }) => {
		try {
			if (!remoteConnected) return {
				content: [{
					type: "text",
					text: `${remoteUnavailableMessage ?? `Graph MCP is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`
				}],
				isError: true
			};
			const { trackFunds } = await Promise.resolve().then(() => require("./public-tools-XSpkz2ky.cjs"));
			const { writeGraphReport } = await Promise.resolve().then(() => require("./graph-reports-DU05YCei.cjs"));
			const { ensureArtifactServer } = await Promise.resolve().then(() => require("./artifact-server-DjSY9q-J.cjs"));
			const result = await trackFunds(remoteClient, config, {
				trustedAddresses: trusted_addresses,
				untrustedAddresses: untrusted_addresses,
				network,
				caseId: case_id,
				maxHops: max_hops,
				perAddressLimit: per_address_limit,
				minAmountSum: min_amount_sum
			});
			const report = await writeGraphReport(result.graphData, {
				serverPort: config.serverPort,
				slug: `track-funds-${network}`
			});
			await ensureArtifactServer(config.serverPort);
			return {
				content: [{
					type: "text",
					text: result.summaryText
				}],
				structuredContent: result.structuredContent,
				_meta: { chainInsights: { graph: {
					schema: report.schema,
					url: report.url
				} } },
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
					text: `Track funds failed: ${err.message}`
				}],
				isError: true
			};
		}
	});
	if (!remoteToolNames.has("scam_topology")) (0, _modelcontextprotocol_ext_apps_server.registerAppTool)(server, "scam_topology", {
		title: "Scam Topology",
		description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.scam_topology,
		inputSchema: {
			network: zod.string().min(1).describe(NETWORK_DESCRIPTION),
			victim_address: zod.string().min(1).describe("Full victim/source address that anchors the scam incident. Victims are not risky labels."),
			incident_timestamp_ms: zod.number().min(0).describe("Earliest known incident transfer timestamp in milliseconds. Primary traversal uses node-relative wave-arrival filtering."),
			max_hops: zod.number().int().min(1).max(64).optional().describe("Maximum forward expansion depth. Default 16."),
			activity_policy: zod.enum(["node_relative_only", "global_incident_only"]).optional().describe("Traversal activity policy. Default node_relative_only."),
			case_id: zod.string().optional().describe("Optional Chain Insights case ID. When provided, compact evidence is appended to the case manifest.")
		},
		_meta: { ui: { resourceUri: GRAPH_RESOURCE_URI } },
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: true
		}
	}, async ({ victim_address, incident_timestamp_ms, network, max_hops, activity_policy, case_id }) => {
		try {
			if (!remoteConnected) return {
				content: [{
					type: "text",
					text: `${remoteUnavailableMessage ?? `Graph MCP is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`
				}],
				isError: true
			};
			const { scamTopology } = await Promise.resolve().then(() => require("./public-tools-XSpkz2ky.cjs"));
			const { writeGraphReport } = await Promise.resolve().then(() => require("./graph-reports-DU05YCei.cjs"));
			const { ensureArtifactServer } = await Promise.resolve().then(() => require("./artifact-server-DjSY9q-J.cjs"));
			const result = await scamTopology(remoteClient, config, {
				victimAddress: victim_address,
				network,
				maxHops: max_hops,
				incidentTimestampMs: incident_timestamp_ms,
				activityPolicyMode: activity_policy,
				caseId: case_id
			});
			const report = await writeGraphReport(result.graphData, {
				serverPort: config.serverPort,
				slug: `scam-topology-${network}`
			});
			await ensureArtifactServer(config.serverPort);
			return {
				content: [{
					type: "text",
					text: result.summaryText
				}],
				structuredContent: result.structuredContent,
				_meta: { chainInsights: { graph: {
					schema: report.schema,
					url: report.url
				} } },
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
					text: `Scam topology failed: ${err.message}`
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
			text: [
				"Chain Insights AML investigation workspace for AI agents.",
				"",
				CHAIN_INSIGHTS_WORKFLOW,
				"",
				"Investigation tools:",
				"- network_capabilities: inspect supported networks, data layers, tool availability, retention windows, and freshness.",
				"- address_risk: screen a full address for AML risk, behavior, neighborhood, exchange exposure, and optional compare_address connection checks.",
				"- track_funds: trace up to five trusted/victim addresses plus up to five known untrusted/scammer addresses through intermediaries to exchange deposit addresses.",
				"- scam_topology: derive ML-ready scam_labels from one victim incident address and incident_timestamp_ms.",
				"- graph_query: run read-only GQL/Cypher through the universal graph endpoint. Use USE live_topology, USE archive_topology, or USE facts.",
				"- graph_query_batch: run related read-only graph-language queries through one paid graph call.",
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
				"- help: show this overview.",
				"",
				GRAPH_REPORT_HINTS,
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
				return await normalizeRemoteToolResult(requestOptions ? await remoteClient.callTool(request, void 0, requestOptions) : await remoteClient.callTool(request), config, tool.name);
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
						text: `Payment required for ${tool.name}. This tool costs USDC on Base via x402 micropayments. Next steps: run \`chain-insights wallet topup\` to fund your wallet with USDC on Base, or \`chain-insights access-key set <key>\` if you have been given test access.`
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
