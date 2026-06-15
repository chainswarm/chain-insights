import { n as PACKAGE_VERSION } from "./version-BA3J8hu4.mjs";
import { t as PaymentRequiredError } from "./client-D1aMU7vY.mjs";
import { n as PUBLIC_MCP_TOOL_ALLOWED_ARGS, r as PUBLIC_MCP_TOOL_REQUIRED_ARGS, t as HIDDEN_REMOTE_TOOL_NAMES } from "./tool-visibility-DQ6_mq2m.mjs";
import { t as primitiveBackendUsageStatus } from "./usage-status-D2uosC7s.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import * as z from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
//#region src/mcp/proxy.ts
const LOCAL_TOOL_NAMES = new Set([
	"meta_network_capabilities",
	"meta_usage_status",
	"meta_help",
	"wallet_balance"
]);
const GRAPH_RESOURCE_URI = "ui://chain-insights/graph";
const GRAPH_APP_TOOL_NAMES = new Set([
	"aml_address_risk",
	"aml_trace_victim_funds",
	"aml_trace_suspect_funds",
	"aml_trace_deposit_sources"
]);
const GRAPH_ARRAY_KEYS = [
	"nodes",
	"edges",
	"flows",
	"edge_anchors"
];
const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
const KNOWN_PUBLIC_TOOL_DESCRIPTIONS = {
	meta_network_capabilities: "Return the current Chain Insights network and tool support matrix.",
	meta_usage_status: "Return the caller's public free graph_query quota for the current UTC day.",
	meta_help: "Show a short guide to Chain Insights tools and workflow.",
	wallet_balance: "Show the local Chain Insights payment wallet address, payment network, token, and amount.",
	aml_address_risk: "Screen one blockchain address for AML risk, behavior patterns, neighborhood context, exchange exposure, and optional comparison with another address.",
	aml_trace_victim_funds: "Trace victim or trusted-source funds forward to intermediary and exchange deposit candidates.",
	aml_trace_suspect_funds: "Trace suspect-controlled scammer, mule, operator, or laundering-ring funds forward to cashout topology.",
	aml_trace_deposit_sources: "Trace suspected deposit or cashout addresses backward to upstream sources, shared funders, and convergence.",
	graph_query: "Run a read-only GQL/Cypher query through the Chain Insights graph endpoint. Use USE live_topology for recent topology, USE archive_topology for historical topology, and USE facts for labels, features, risk scores, assets, and enrichment. Cross-layer correlated joins may be limited by the active graph endpoint; preserve full addresses exactly.",
	graph_query_batch: "Run multiple read-only GQL/Cypher queries through the Chain Insights graph endpoint in one paid batch. Prefer this for related topology/facts reads."
};
const FALLBACK_GRAPH_PRIMITIVE_TOOL_NAMES = ["graph_query", "graph_query_batch"];
const BITTENSOR_NETWORK_SCHEMA = z.enum(["bittensor"]).describe("Network to query, for example Bittensor or Base.");
const EMPTY_INPUT_SCHEMA = z.strictObject({});
const REMOTE_GRAPH_TOOL_REQUEST_TIMEOUT_MS = 900 * 1e3;
const CHAIN_INSIGHTS_WORKFLOW = [
	"Workflow:",
	"1. Chain Insights workspaces are append-only local working directories. Bootstrap with cia init before workflows that persist artifacts.",
	"2. Do not call investigation tools until required arguments are known. Network is required; use meta_network_capabilities to check supported networks and available tools, or ask the user if missing.",
	"3. Use aml_address_risk for single-address enrichment. Use aml_trace_victim_funds for victim/source forward tracing and aml_trace_suspect_funds for suspect-controlled outbound laundering/cashout topology; both include a bounded deposit_funding traceback preview for discovered deposit candidates. Use aml_trace_deposit_sources for deeper reverse traceback from suspected deposit endpoints. Use graph_query(_batch) only when the high-level tools do not answer the exact question.",
	"4. Persisted outputs belong in the initialized workspace under reports/, reports/graphs/, reports/tables/, artifacts/, entities/, sessions/, and published/.",
	"5. For local review, inspect the generated Markdown and graph/table artifacts directly in the workspace."
].join("\n");
const GRAPH_SCHEMA_HINTS = [
	"Graph query hints for network=bittensor:",
	"- The graph is identity-grain. The only topology node label is Identity (satellite Address nodes exist only for member-address lookup), keyed by identity_id in the canonical prefixed form <network>:<canonical_address>, for example bittensor:0x1874a43d7c6d888f9eda3d22a3a49704e3cadb24.",
	"- Identity nodes carry identity_id, labels, and is_exchange. There is no addresses list property and no network property; each network domain has its own graph. Member-address forms live exclusively on satellite (:Address {address, network}) nodes; enumerate them with MATCH (i:Identity {identity_id: $id})-[:HAS_ADDRESS]->(m:Address) RETURN m.address, m.network.",
	"- Identity nodes also carry a slim live risk verdict (risk_score float, risk_level string) plus base activity rollups: degree_in/degree_out/degree_total (distinct counterparty identities), tx_in_count/tx_out_count/tx_total_count, total_in_usd/total_out_usd/total_volume_usd, net_flow_usd (in minus out; positive = net receiver) — all computed from external flows only — and first_activity_timestamp/last_activity_timestamp/activity_span_days, which include all flows (self-loops included). Movement between an identity's own member forms is excluded from the degree/count/USD rollups and exposed separately as internal_tx_count/internal_volume_usd (sparse: absent when zero, like is_exchange). FLOWS_TO edges carry tx_count, amount_usd_sum, avg_tx_size_usd (understates when price_coverage_ratio < 1), first/last_seen_timestamp, first/last_tx_id, dominant_asset (largest USD share), price_coverage_ratio. Lifetime aggregates are the only serving window.",
	"- Resolve any member address form (0x or SS58) to its identity with the indexed exact lookup: MATCH (m:Address {address: $input})<-[:HAS_ADDRESS]-(i:Identity) RETURN i.identity_id LIMIT 1. :Address(address) is unique and index-backed.",
	"- Detailed, provenanced scoring still comes from USE facts: (:Identity)-[:HAS_RISK_SCORE]->(:RiskScore) for model versions/processing dates, (:Identity)-[:HAS_LABEL]->(:AddressLabel) for label risk, (:Identity)-[:HAS_FEATURE]->(:AddressFeature) for feature metrics. Use node risk_score/risk_level only as the quick-triage verdict; never read ml_* properties off topology nodes.",
	"- Facts graph labels include Identity, AddressLabel, AddressFeature, RiskScore, Asset, NeuronEndpoint, Hotkey, and IPAddress. Facts identity keys match live identity_id values exactly.",
	"- Live topology relationships include FLOWS_TO and RISK_PROXIMITY between Identity nodes. Bittensor live topology may also include the pure-Cypher neuron overlay: (:Identity)-[:SERVES]->(:Subnet) and (:Identity)-[:OWNS]->(:Identity), with detailed neuron endpoint facts still served from USE facts.",
	"- FLOWS_TO properties are scoped to the selected topology graph and commonly carry tx_count, amount_usd_sum, avg_tx_size_usd, first_seen_timestamp, last_seen_timestamp, first_tx_id, last_tx_id, dominant_asset, price_coverage_ratio. Confirm available fields through runtime schema before relying on them.",
	"- Traversal rule: for BFS, fixed-hop fallback, shortest-path, or manual FLOWS_TO traversal, exchange hot wallets are terminal endpoints only. Do not expand from, through, or classify exchange nodes as deposit, suspect, or intermediate candidates; filter every non-terminal node with is_exchange IS NULL.",
	"- Start schema discovery with endpoint-safe property reads: MATCH (n:Identity) WHERE n.identity_id IS NOT NULL RETURN n.identity_id AS identity_id, n.labels AS labels, n.risk_score AS risk_score, n.risk_level AS risk_level LIMIT 20",
	"- Relationship discovery: MATCH (:Identity)-[r:FLOWS_TO]->(:Identity) RETURN r.amount_usd_sum AS amount_usd_sum, r.tx_count AS tx_count LIMIT 20",
	"- graph_query uses the active Chain Insights graph endpoint. Select the graph with USE live_topology for recent topology, USE archive_topology for historical topology, and USE facts for labels, features, risk scores, assets, and enrichment. If an older endpoint surfaces a legacy topology_scope argument, treat it as compatibility routing only; identity is the node grain, not the topology name.",
	"- Archive topology labels include Identity and Address. Archived money-flow topology is represented as (:Identity)-[:FLOWS_TO]->(:Identity) relationships with period_granularity, period_start_date, and period_end_date, and archive member-address lookup uses (:Identity)-[:HAS_ADDRESS]->(:Address) with Address.address and member-ledger Address.network projected for public address resolution.",
	"- All graph_query calls are read-only. Never use CREATE, INSERT, MERGE, SET, DELETE, REMOVE, DROP, DETACH, ADD, CONNECT, DISCONNECT, ALTER, TRUNCATE, GRANT, or REVOKE.",
	"- Use USE facts graph patterns for fact and enrichment reads. Do not query internal table namespaces directly."
].join("\n");
const GRAPH_REPORT_HINTS = [
	"Graph visualization behavior:",
	"- Graph-backed tools return the investigator report as text content and keep raw graph data out of LLM-visible structuredContent.",
	"- Chain Insights prepares the graph view automatically from local workspace report files when graph metadata is available.",
	"- If the graph view cannot load a report, retry the graph-backed tool call so Chain Insights can recreate the local graph report."
].join("\n");
const SERVER_INSTRUCTIONS = [
	"Chain Insights is a local graph-analysis workspace for AI agents.",
	CHAIN_INSIGHTS_WORKFLOW,
	GRAPH_REPORT_HINTS,
	GRAPH_SCHEMA_HINTS,
	"Presentation rules: preserve tool summaries as returned; never truncate blockchain addresses or identity_resolution audit mappings."
].join("\n\n");
const STATELESS_SERVER_INSTRUCTIONS = [
	"Chain Insights is running as a stateless AML proxy for a host application.",
	"Do not use local workspace persistence, wallet, or graph report workflows in this mode.",
	"Use meta_network_capabilities first when network support is unknown, then call aml_address_risk, aml_trace_victim_funds, aml_trace_suspect_funds, aml_trace_deposit_sources, graph_query, or graph_query_batch as needed.",
	GRAPH_SCHEMA_HINTS,
	"Presentation rules: preserve tool summaries as returned; never truncate blockchain addresses or identity_resolution audit mappings."
].join("\n\n");
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
		case "aml_address_risk": return {
			address: z.string().min(1).describe("Blockchain address to screen."),
			network: BITTENSOR_NETWORK_SCHEMA,
			compare_address: z.string().optional().describe("Optional address to compare against the screened address."),
			include_attachments: z.boolean().optional().describe("Include graph app report metadata")
		};
		case "aml_trace_victim_funds": return {
			victim_addresses: z.string().min(1).describe("Victim or source addresses, comma-separated. Min 1, max 5."),
			network: BITTENSOR_NETWORK_SCHEMA,
			known_suspect_addresses: z.string().optional().describe("Optional known suspect addresses for context only. Max 5."),
			incident_timestamp_ms: z.number().min(0).optional().describe("Optional incident time as a Unix timestamp in milliseconds, not a block number."),
			max_hops: z.number().int().min(1).max(5).optional().describe("Trace depth in hops. Default 3."),
			include_attachments: z.boolean().optional().describe("Include graph app report metadata")
		};
		case "aml_trace_suspect_funds": return {
			network: BITTENSOR_NETWORK_SCHEMA,
			suspect_addresses: z.string().min(1).describe("Suspect-controlled addresses, comma-separated. Min 1, max 5."),
			incident_timestamp_ms: z.number().min(0).optional().describe("Optional incident time as a Unix timestamp in milliseconds, not a block number."),
			max_hops: z.number().int().min(1).max(5).optional().describe("Trace depth in hops. Default 3."),
			include_attachments: z.boolean().optional().describe("Include graph app report metadata")
		};
		case "aml_trace_deposit_sources": return {
			network: BITTENSOR_NETWORK_SCHEMA,
			deposit_addresses: z.string().min(1).describe("Suspected deposit or cashout addresses, comma-separated. Min 1, max 5."),
			max_hops: z.number().int().min(1).max(5).optional().describe("Reverse trace depth in hops. Default 2."),
			include_attachments: z.boolean().optional().describe("Include graph app report metadata")
		};
		case "graph_query": return {
			query: z.string().min(1).describe("Read-only GQL/Cypher query. Use USE live_topology for recent topology, USE archive_topology for historical topology, and USE facts for labels, features, risk scores, assets, and enrichment."),
			network: BITTENSOR_NETWORK_SCHEMA
		};
		case "graph_query_batch": return {
			network: BITTENSOR_NETWORK_SCHEMA,
			queries: z.array(z.object({
				id: z.string().optional(),
				query: z.string().min(1).describe("Read-only GQL/Cypher query")
			})).min(1).max(20),
			per_query_timeout_seconds: z.number().int().min(1).max(600).optional()
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
	const filePath = process.env.CHAIN_INSIGHTS_MCP_LOG_PATH?.trim() || path.join(config.dataDir, ".chain-insights", "runtime", "logs", "mcp-proxy.jsonl");
	async function write(level, event, fields = {}) {
		if (disabled) return;
		try {
			await mkdir(path.dirname(filePath), { recursive: true });
			await appendFile(filePath, JSON.stringify({
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
	if (!(toolName in PUBLIC_MCP_TOOL_REQUIRED_ARGS)) return normalized;
	for (const fieldName of COMMA_SEPARATED_ADDRESS_FIELDS) {
		const value = normalized[fieldName];
		if (Array.isArray(value)) normalized[fieldName] = value.map((entry) => String(entry).trim()).filter(Boolean).join(",");
	}
	const allowedArgs = PUBLIC_MCP_TOOL_ALLOWED_ARGS[toolName];
	if (!allowedArgs) return normalized;
	return Object.fromEntries(Object.entries(normalized).filter(([key]) => allowedArgs.includes(key)));
}
function validateKnownPublicToolArguments(toolName, args) {
	const requiredArgs = PUBLIC_MCP_TOOL_REQUIRED_ARGS[toolName];
	if (!requiredArgs) return null;
	for (const argName of requiredArgs) if (isBlankArgument(args[argName])) return `Missing required argument: ${argName}`;
	return null;
}
function claudeFacingToolDescription(tool) {
	const baseDescription = KNOWN_PUBLIC_TOOL_DESCRIPTIONS[tool.name] ?? tool.description ?? tool.name;
	const requiredArgs = PUBLIC_MCP_TOOL_REQUIRED_ARGS[tool.name];
	if (!requiredArgs) return baseDescription;
	return [
		baseDescription,
		"",
		`Required arguments: ${requiredArgs.join(", ")}.`,
		"If the user did not provide the network, ask for it before calling this tool. Do not guess a default network."
	].join("\n");
}
function knownPublicToolAnnotations(toolName) {
	if (toolName === "graph_query" || toolName === "graph_query_batch" || toolName.startsWith("aml_")) return {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: true
	};
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
function registerLocalPrompts(server) {
	server.registerPrompt("aml-address-risk", {
		title: "AML Address Risk",
		description: "Screen a blockchain address for AML risk, behavioral patterns, neighborhood profile, member addresses, and exchange links.",
		argsSchema: {
			network: BITTENSOR_NETWORK_SCHEMA,
			address: z.string().describe("Blockchain address to screen"),
			compare_address: z.string().optional().describe("Optional address to compare against the screened address")
		}
	}, async ({ network, address, compare_address }) => promptResult([
		`Use Chain Insights aml_address_risk on ${network} for:`,
		"",
		`\`${address}\``,
		compare_address ? `\nCompare with: \`${compare_address}\`` : "",
		"",
		"Present the summary as-is. Do not add analysis, verdicts, or risk assessments; the tool output already contains the risk assessment."
	].filter(Boolean).join("\n"), "AML address risk screening"));
	server.registerPrompt("aml-trace-victim-funds", {
		title: "AML Trace Victim Funds",
		description: "Trace victim or trusted-source funds forward to deposit candidates.",
		argsSchema: {
			network: BITTENSOR_NETWORK_SCHEMA,
			victim_addresses: z.string().describe("Victim/source addresses, comma-separated"),
			known_suspect_addresses: z.string().optional().describe("Optional known suspect addresses for context only")
		}
	}, async ({ network, victim_addresses, known_suspect_addresses }) => promptResult([
		`Use Chain Insights aml_trace_victim_funds on ${network}.`,
		"",
		"Victim/source addresses:",
		victim_addresses,
		known_suspect_addresses ? `\nKnown suspects for context only:\n${known_suspect_addresses}` : "",
		"",
		"Present the summary as-is and use continuation.recommended_next_tools for follow-up."
	].filter(Boolean).join("\n"), "AML victim/source trace"));
	server.registerPrompt("aml-trace-suspect-funds", {
		title: "AML Trace Suspect Funds",
		description: "Trace suspect-controlled funds forward to cashout topology.",
		argsSchema: {
			network: BITTENSOR_NETWORK_SCHEMA,
			suspect_addresses: z.string().describe("Suspect-controlled addresses, comma-separated")
		}
	}, async ({ network, suspect_addresses }) => promptResult([
		`Use Chain Insights aml_trace_suspect_funds on ${network}.`,
		"",
		"Suspect-controlled addresses:",
		suspect_addresses,
		"",
		"Present the summary as-is and use continuation.recommended_next_tools for follow-up."
	].join("\n"), "AML suspect trace"));
	server.registerPrompt("aml-trace-deposit-sources", {
		title: "AML Trace Deposit Sources",
		description: "Trace suspected deposit or cashout addresses backward to upstream sources.",
		argsSchema: {
			network: BITTENSOR_NETWORK_SCHEMA,
			deposit_addresses: z.string().describe("Suspected deposit/cashout addresses, comma-separated")
		}
	}, async ({ network, deposit_addresses }) => promptResult([
		`Use Chain Insights aml_trace_deposit_sources on ${network}.`,
		"",
		"Suspected deposit/cashout addresses:",
		deposit_addresses,
		"",
		"Present the summary as-is and use continuation.recommended_next_tools for follow-up."
	].join("\n"), "AML deposit-source trace"));
	server.registerPrompt("meta-network-capabilities", {
		title: "Network Capabilities",
		description: "Inspect supported networks and available tools before selecting a network.",
		argsSchema: {}
	}, async () => promptResult("Use Chain Insights meta_network_capabilities. Report only the supported networks and available tools exactly as returned; do not infer unsupported networks.", "Network capabilities"));
	server.registerPrompt("meta-usage-status", {
		title: "Usage Status",
		description: "Check the caller's public free graph_query quota.",
		argsSchema: {}
	}, async () => promptResult("Use Chain Insights meta_usage_status. Report the quota fields exactly as returned.", "Usage status"));
	server.registerPrompt("graph-query", {
		title: "Graph Query",
		description: "Run a read-only GQL/Cypher query through the Chain Insights graph endpoint.",
		argsSchema: {
			network: BITTENSOR_NETWORK_SCHEMA,
			query: z.string().describe("Read-only GQL/Cypher query")
		}
	}, async ({ network, query }) => promptResult([
		`Use Chain Insights graph_query on ${network} with this read-only GQL/Cypher query:`,
		"",
		"```gql",
		query,
		"```",
		"",
		"Use USE live_topology for recent topology, USE archive_topology for historical topology, and USE facts for labels, features, risk scores, assets, and enrichment. If you need schema context, first run small discovery queries such as MATCH (i:Identity) RETURN i.identity_id AS identity_id, keys(i) AS identity_properties LIMIT 5 and MATCH (:Identity)-[r:FLOWS_TO]->(:Identity) RETURN keys(r) AS flow_properties LIMIT 5. Return identity_id and member addresses when available; never shorten addresses with ellipses."
	].join("\n"), "Graph query"));
	server.registerPrompt("graph-query-batch", {
		title: "Graph Query Batch",
		description: "Run related read-only GQL/Cypher queries through the Chain Insights graph endpoint in one paid batch.",
		argsSchema: {
			network: BITTENSOR_NETWORK_SCHEMA,
			queries: z.string().describe("JSON array of query objects with optional id and required query fields"),
			per_query_timeout_seconds: z.string().optional().describe("Optional integer timeout per query, 1-600 seconds")
		}
	}, async ({ network, queries, per_query_timeout_seconds }) => promptResult([
		`Use Chain Insights graph_query_batch on ${network} with these read-only GQL/Cypher queries:`,
		"",
		"```json",
		queries,
		"```",
		per_query_timeout_seconds ? `per_query_timeout_seconds: ${per_query_timeout_seconds}` : "",
		"",
		"Use USE live_topology for recent topology, USE archive_topology for historical topology, and USE facts for labels, features, risk scores, assets, and enrichment. If you need schema context, first run small discovery queries such as MATCH (i:Identity) RETURN i.identity_id AS identity_id, keys(i) AS identity_properties LIMIT 5 and MATCH (:Identity)-[r:FLOWS_TO]->(:Identity) RETURN keys(r) AS flow_properties LIMIT 5. Return identity_id and member addresses when available; never shorten addresses with ellipses."
	].filter(Boolean).join("\n"), "Graph query batch"));
	server.registerPrompt("wallet-balance", {
		title: "Wallet Balance",
		description: "Show the local Chain Insights payment wallet address, payment network, token, and amount.",
		argsSchema: {}
	}, async () => promptResult("Use Chain Insights wallet_balance. Show the wallet address, payment network, token, and amount exactly as returned.", "Wallet balance"));
	server.registerPrompt("meta-help", {
		title: "Chain Insights Help",
		description: "Show available Chain Insights tools and workspace workflow.",
		argsSchema: {}
	}, async () => promptResult("Use Chain Insights meta_help. Summarize the available tools and workspace workflow without inventing capabilities.", "Chain Insights help"));
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
		const { writeGraphReport } = await import("./graph-reports-Dw_t59Ez.mjs");
		const { ensureArtifactServer } = await import("./artifact-server-CcmLBv1j.mjs");
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
	const { writeGraphReport } = await import("./graph-reports-Dw_t59Ez.mjs");
	const { ensureArtifactServer } = await import("./artifact-server-CcmLBv1j.mjs");
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
function cleanCapabilityLayers(value) {
	const layers = isRecord(value) ? value : {};
	return {
		facts: { enabled: isRecord(layers.facts) ? layers.facts.enabled === true : true },
		risk: { enabled: isRecord(layers.risk) ? layers.risk.enabled === true : false },
		topology: { enabled: isRecord(layers.topology) ? layers.topology.enabled === true : true }
	};
}
function defaultBittensorCapability() {
	return {
		network: "bittensor",
		display_name: "Bittensor",
		status: "live",
		default: true,
		layers: {
			facts: { enabled: true },
			risk: { enabled: false },
			topology: { enabled: true }
		},
		tools: {
			graph_query: "available",
			graph_query_batch: "available"
		}
	};
}
function cleanNetworkCapabilities(value) {
	const structuredContent = isRecord(value) ? value.structuredContent : void 0;
	const facts = isRecord(structuredContent) ? structuredContent.facts : void 0;
	const capabilities = isRecord(facts) ? facts.capabilities : void 0;
	const bittensor = (isRecord(capabilities) && Array.isArray(capabilities.networks) ? capabilities.networks : []).find((network) => isRecord(network) && network.network === "bittensor");
	return {
		schema: "chain-insights.result.v1",
		tool: "meta_network_capabilities",
		hint: null,
		facts: { capabilities: {
			schema: "chain-insights.network-capabilities.v1",
			networks: [bittensor ? {
				network: "bittensor",
				display_name: typeof bittensor.display_name === "string" ? bittensor.display_name : "Bittensor",
				status: typeof bittensor.status === "string" ? bittensor.status : "live",
				default: bittensor.default === false ? false : true,
				layers: cleanCapabilityLayers(bittensor.layers),
				tools: {
					graph_query: "available",
					graph_query_batch: "available"
				}
			} : defaultBittensorCapability()]
		} }
	};
}
function jsonTextResult(structuredContent) {
	return {
		content: [{
			type: "text",
			text: JSON.stringify(structuredContent, null, 2)
		}],
		structuredContent,
		isError: false
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
	const { loadConfig } = await import("./config-C6zM8Xir.mjs").then((n) => n.t);
	const { activeDataDir, findActiveWorkspace } = await import("./active-BQopLul8.mjs").then((n) => n.t);
	const { createConfiguredGraphMcpFetch, resolveGraphMcpEndpoint } = await import("./client-D1aMU7vY.mjs").then((n) => n.r);
	const { loadSchema, saveSchema } = await import("./schema-cache-DwDvPy4e.mjs");
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
	const remoteClient = new Client({
		name: "chain-insights-proxy-client",
		version: PACKAGE_VERSION
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
		await remoteClient.connect(new StreamableHTTPClientTransport(new URL(graphMcpEndpoint), { fetch: mcpFetch }));
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
	const server = new McpServer({
		name: "chain-insights",
		version: PACKAGE_VERSION
	}, { instructions: workspaceArtifactsEnabled ? SERVER_INSTRUCTIONS : STATELESS_SERVER_INSTRUCTIONS });
	installToolLogging(server, logger);
	if (remoteConnected) try {
		await remoteClient.listPrompts();
	} catch (err) {
		await logger.error("remote.prompts_failed", {
			endpoint: graphMcpEndpoint,
			error: errorForLog(err)
		});
		process.stderr.write(`Chain Insights MCP remote prompt metadata unavailable at ${graphMcpEndpoint}: ${err.message}\n`);
	}
	registerLocalPrompts(server);
	server.registerTool("meta_network_capabilities", {
		title: "Network Capabilities",
		description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.meta_network_capabilities,
		inputSchema: EMPTY_INPUT_SCHEMA,
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false
		}
	}, async () => {
		if (remoteConnected && remoteToolNames.has("network_capabilities")) try {
			return jsonTextResult(cleanNetworkCapabilities(await remoteClient.callTool({
				name: "network_capabilities",
				arguments: {}
			})));
		} catch (err) {
			return {
				content: [{
					type: "text",
					text: `Network capabilities failed: ${err.message}`
				}],
				isError: true
			};
		}
		return jsonTextResult(cleanNetworkCapabilities(void 0));
	});
	server.registerTool("meta_usage_status", {
		title: "Usage Status",
		description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.meta_usage_status,
		inputSchema: EMPTY_INPUT_SCHEMA,
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: true
		}
	}, async () => {
		try {
			if (!remoteConnected) return {
				content: [{
					type: "text",
					text: `${remoteUnavailableMessage ?? `Graph MCP is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`
				}],
				isError: true
			};
			if (!remoteToolNames.has("usage_status")) return jsonTextResult(primitiveBackendUsageStatus(graphMcpEndpoint));
			const result = await remoteClient.callTool({
				name: "usage_status",
				arguments: {}
			});
			const structuredContent = isRecord(result.structuredContent) ? {
				...result.structuredContent,
				tool: "meta_usage_status"
			} : void 0;
			return {
				content: structuredContent ? [{
					type: "text",
					text: JSON.stringify(structuredContent, null, 2)
				}] : result.content ?? [],
				structuredContent,
				_meta: result._meta,
				isError: result.isError
			};
		} catch (err) {
			return {
				content: [{
					type: "text",
					text: `Usage status failed: ${err.message}`
				}],
				isError: true
			};
		}
	});
	if (workspaceArtifactsEnabled) {
		server.registerTool("wallet_balance", {
			title: "Wallet Balance",
			description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.wallet_balance,
			inputSchema: EMPTY_INPUT_SCHEMA,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true
			}
		}, async () => {
			try {
				const { formatWalletBalanceResult, getWalletAccount, getWalletBalanceResult } = await import("./tools-BHBPchXp.mjs").then((n) => n.u);
				const structuredContent = await getWalletBalanceResult(await getWalletAccount());
				return {
					content: [{
						type: "text",
						text: formatWalletBalanceResult(structuredContent)
					}],
					structuredContent,
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
		registerAppResource(server, "Fund Flow Graph", GRAPH_RESOURCE_URI, {
			description: "Interactive fund-flow and pattern graph for Chain Insights investigation reports.",
			_meta: { ui: { csp: {
				resourceDomains: graphArtifactOrigins(config),
				connectDomains: graphArtifactOrigins(config)
			} } }
		}, async () => ({ contents: [{
			uri: GRAPH_RESOURCE_URI,
			mimeType: RESOURCE_MIME_TYPE,
			text: readGraphAppHtml(),
			_meta: { ui: { csp: {
				resourceDomains: graphArtifactOrigins(config),
				connectDomains: graphArtifactOrigins(config)
			} } }
		}] }));
		if (!remoteToolNames.has("aml_address_risk")) registerAppTool(server, "aml_address_risk", {
			title: "Address Risk",
			description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.aml_address_risk,
			inputSchema: {
				address: z.string().min(1).describe("Blockchain address to screen"),
				network: BITTENSOR_NETWORK_SCHEMA,
				compare_address: z.string().optional().describe("Optional address to compare against the screened address"),
				include_attachments: z.boolean().optional().describe("Include graph app report metadata")
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
				const { addressRisk } = await import("./public-tools-D5seSuAa.mjs");
				const result = await addressRisk(remoteClient, {
					address,
					network,
					compareAddress: compare_address,
					writeArtifacts: workspaceArtifactsEnabled
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
				if (err instanceof PaymentRequiredError) return {
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
		if (!remoteToolNames.has("aml_trace_victim_funds")) registerAppTool(server, "aml_trace_victim_funds", {
			title: "Trace Victim Funds",
			description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.aml_trace_victim_funds,
			inputSchema: {
				victim_addresses: z.union([z.string().min(1), z.array(z.string().min(1))]).describe("Victim or source addresses, comma-separated or an array. Min 1, max 5."),
				network: BITTENSOR_NETWORK_SCHEMA,
				known_suspect_addresses: z.union([z.string(), z.array(z.string())]).optional().describe("Known suspect addresses for context only. Max 5."),
				include_attachments: z.boolean().optional().describe("Include graph app report metadata"),
				incident_timestamp_ms: z.number().min(0).optional().describe("Optional incident time as a Unix timestamp in milliseconds, not a block number."),
				max_hops: z.number().int().min(1).max(5).optional().describe("Trace depth in hops. Default 3.")
			},
			_meta: { ui: { resourceUri: GRAPH_RESOURCE_URI } },
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true
			}
		}, async ({ victim_addresses, known_suspect_addresses, network, incident_timestamp_ms, max_hops, include_attachments }) => {
			try {
				if (!remoteConnected) return {
					content: [{
						type: "text",
						text: `${remoteUnavailableMessage ?? `Graph MCP is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`
					}],
					isError: true
				};
				const { traceVictimFunds } = await import("./public-tools-D5seSuAa.mjs");
				const result = await traceVictimFunds(remoteClient, config, {
					victimAddresses: victim_addresses,
					knownSuspectAddresses: known_suspect_addresses,
					network,
					incidentTimestampMs: incident_timestamp_ms,
					maxHops: max_hops,
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
				if (err instanceof PaymentRequiredError) return {
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
		if (!remoteToolNames.has("aml_trace_suspect_funds")) registerAppTool(server, "aml_trace_suspect_funds", {
			title: "Trace Suspect Funds",
			description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.aml_trace_suspect_funds,
			inputSchema: {
				network: BITTENSOR_NETWORK_SCHEMA,
				suspect_addresses: z.union([z.string().min(1), z.array(z.string().min(1))]).describe("Suspect-controlled addresses, comma-separated or an array. Min 1, max 5."),
				incident_timestamp_ms: z.number().min(0).optional().describe("Optional incident time as a Unix timestamp in milliseconds, not a block number."),
				max_hops: z.number().int().min(1).max(5).optional().describe("Trace depth in hops. Default 3."),
				include_attachments: z.boolean().optional().describe("Include graph app report metadata")
			},
			_meta: { ui: { resourceUri: GRAPH_RESOURCE_URI } },
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true
			}
		}, async ({ suspect_addresses, incident_timestamp_ms, network, max_hops, include_attachments }) => {
			try {
				if (!remoteConnected) return {
					content: [{
						type: "text",
						text: `${remoteUnavailableMessage ?? `Graph MCP is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`
					}],
					isError: true
				};
				const { traceSuspectFunds } = await import("./public-tools-D5seSuAa.mjs");
				const result = await traceSuspectFunds(remoteClient, config, {
					suspectAddresses: suspect_addresses,
					network,
					maxHops: max_hops,
					incidentTimestampMs: incident_timestamp_ms,
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
				if (err instanceof PaymentRequiredError) return {
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
		if (!remoteToolNames.has("aml_trace_deposit_sources")) registerAppTool(server, "aml_trace_deposit_sources", {
			title: "Trace Deposit Sources",
			description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.aml_trace_deposit_sources,
			inputSchema: {
				network: BITTENSOR_NETWORK_SCHEMA,
				deposit_addresses: z.union([z.string().min(1), z.array(z.string().min(1))]).describe("Suspected deposit or cashout addresses, comma-separated or an array. Min 1, max 5."),
				max_hops: z.number().int().min(1).max(5).optional().describe("Reverse trace depth in hops. Default 2."),
				include_attachments: z.boolean().optional().describe("Include graph app report metadata")
			},
			_meta: { ui: { resourceUri: GRAPH_RESOURCE_URI } },
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true
			}
		}, async ({ deposit_addresses, network, max_hops, include_attachments }) => {
			try {
				if (!remoteConnected) return {
					content: [{
						type: "text",
						text: `${remoteUnavailableMessage ?? `Graph MCP is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`
					}],
					isError: true
				};
				const { traceDepositSources } = await import("./public-tools-D5seSuAa.mjs");
				const result = await traceDepositSources(remoteClient, config, {
					depositAddresses: deposit_addresses,
					network,
					maxHops: max_hops,
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
				if (err instanceof PaymentRequiredError) return {
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
		server.registerTool("meta_help", {
			title: "Chain Insights Help",
			description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.meta_help,
			inputSchema: EMPTY_INPUT_SCHEMA,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false
			}
		}, async () => ({
			content: [{
				type: "text",
				text: workspaceArtifactsEnabled ? [
					"Chain Insights helps AI agents run AML investigation workflows and keep evidence in local workspace files.",
					"",
					CHAIN_INSIGHTS_WORKFLOW,
					"",
					"Investigation tools:",
					"- meta_network_capabilities: inspect supported networks and available tools.",
					"- meta_usage_status: check the caller public free graph_query quota.",
					"- aml_address_risk: screen one blockchain address; optionally compare it with another address.",
					"- aml_trace_victim_funds: trace up to five victim/source addresses forward to exchange deposit candidates.",
					"- aml_trace_deposit_sources: trace backward from suspected deposit/cashout addresses to upstream funders and shared-source convergence.",
					"- aml_trace_suspect_funds: trace up to five suspected scammer, mule, operator, or laundering-ring addresses forward to cashout topology.",
					"- graph_query: run read-only GQL/Cypher through the universal graph endpoint. Use USE live_topology, USE archive_topology, or USE facts.",
					"- graph_query_batch: run related read-only graph-language queries through one paid graph call.",
					"",
					"Wallet tools:",
					"- wallet_balance: show the local payment wallet address, payment network, token, and amount.",
					"- meta_help: show this overview.",
					"",
					GRAPH_REPORT_HINTS
				].join("\n") : [
					"Chain Insights stateless AML proxy for host applications.",
					"",
					"Local workspace persistence, wallet, and graph report attachment tools are disabled in this mode.",
					"",
					"Available graph-backed tools:",
					"- meta_network_capabilities: inspect supported networks and available tools.",
					"- meta_usage_status: check the caller public free graph_query quota.",
					"- aml_address_risk: screen one blockchain address; optionally compare it with another address.",
					"- aml_trace_victim_funds: trace up to five victim/source addresses forward to exchange deposit candidates.",
					"- aml_trace_deposit_sources: trace backward from suspected deposit/cashout addresses to upstream funders and shared-source convergence.",
					"- aml_trace_suspect_funds: trace up to five suspected scammer, mule, operator, or laundering-ring addresses forward to cashout topology.",
					"- graph_query: run read-only GQL/Cypher through the universal graph endpoint. Use USE live_topology, USE archive_topology, or USE facts.",
					"- graph_query_batch: run related read-only graph-language queries through one paid graph call."
				].join("\n")
			}],
			isError: false
		}));
		for (const tool of tools ?? []) {
			if (HIDDEN_REMOTE_TOOL_NAMES.has(tool.name)) continue;
			if (LOCAL_TOOL_NAMES.has(tool.name)) continue;
			const inputSchema = knownPublicToolInputSchema(tool.name) ?? z.object({}).passthrough();
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
					if (err instanceof PaymentRequiredError) return {
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
				inputSchema,
				...knownPublicToolAnnotations(tool.name) ? { annotations: knownPublicToolAnnotations(tool.name) } : {}
			};
			if (hasGraphApp(tool)) registerAppTool(server, tool.name, {
				...toolConfig,
				_meta: graphToolMeta(tool)
			}, handler);
			else server.registerTool(tool.name, toolConfig, handler);
		}
		const transport = new StdioServerTransport();
		await server.connect(transport);
		await logger.info("proxy.ready", { tools: [...LOCAL_TOOL_NAMES, ...(tools ?? []).map((tool) => tool.name).filter((name) => !HIDDEN_REMOTE_TOOL_NAMES.has(name) && !LOCAL_TOOL_NAMES.has(name))].length });
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
}
if (process.argv[1] && import.meta.url.includes(process.argv[1].replace(/\\/g, "/"))) createProxy().catch((err) => {
	process.stderr.write(`Chain Insights MCP proxy startup failed: ${err.message}\n`);
	process.exit(1);
});
//#endregion
export { createProxy, resolveMcpProxyMode };

//# sourceMappingURL=mcp-proxy.mjs.map