import { n as PACKAGE_VERSION } from "./version-BA3J8hu4.mjs";
import { t as PaymentRequiredError } from "./client-ytTO0mcZ.mjs";
import { t as HIDDEN_REMOTE_TOOL_NAMES } from "./tool-visibility-nr6XqO1F.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import * as z from "zod";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
//#region src/mcp/proxy.ts
const LOCAL_TOOL_NAMES = new Set(["balance", "help"]);
const PUBLIC_GRAPHRAG_PROMPT_NAMES = new Set(["address-risk", "trace-tools"]);
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
const KNOWN_PUBLIC_TOOL_REQUIRED_ARGS = {
	aml_address_risk: ["address", "network"],
	exposure_profile: ["network"],
	exposure_quality: ["network"],
	exposure_carry: ["network"],
	exposure_crowding: ["network", "instrument"],
	exposure_exit_pressure: ["network"],
	exposure_correlation: ["network"],
	exposure_explain: ["network"],
	aml_trace_victim_funds: ["victim_addresses", "network"],
	aml_trace_suspect_funds: ["suspect_addresses", "network"],
	aml_trace_deposit_sources: ["deposit_addresses", "network"],
	graph_query: ["query", "network"],
	graph_query_batch: ["network", "queries"]
};
const KNOWN_PUBLIC_TOOL_DESCRIPTIONS = {
	network_capabilities: "Return supported Chain Insights networks, capability layers, tool availability, data retention windows, and freshness. Use this before choosing network-specific tools.",
	aml_address_risk: "Screen one canonical identity key (<network>:<canonical_address>) for AML risk, behavior patterns, neighborhood context, exchange exposure, and optional comparison with compare_address. This includes the exchange-behavior analysis formerly covered by money_flows_between_exchanges. Use this as the first AML tool for a single-identity investigation. The tool returns an investigator-ready summary; preserve full addresses exactly.",
	exposure_profile: "Explain exposure around one account, owner, or counterparty. Supports Bittensor staking exposure and Hyperliquid trading exposure through one generic response shape with venues, instruments, position changes, carry/risk fields when available, public support events, and caveats.",
	exposure_quality: "Score whether exposure behavior looks disciplined, fragile, lucky, or noisy across Bittensor staking, Hyperliquid trading, and future exposure venues. Returns deterministic components, sample-size warnings, evidence, and caveats; it is not trading advice.",
	exposure_carry: "Explain carry earned or paid by exposure, including funding, fees, emissions, dividends, validator take, or equivalent venue-native carry when indexed. Returns carry breakdowns, evidence, and missing-data caveats.",
	exposure_crowding: "Measure whether a market, subnet, hotkey, vault, or strategy is crowded. Returns side concentration, top exposure rows, confidence, and caveats from generic exposure rows.",
	exposure_exit_pressure: "Explain what could force or incentivize exits, including liquidation pressure, slippage/unstake pressure, funding pain, or missing risk coverage. Accepts either an account-style subject or an instrument/market subject.",
	exposure_correlation: "Compare exposure behavior across accounts to find possible copy, overlap, or strategy-cluster relationships. Correlation is not proof of shared control.",
	exposure_explain: "Explain the lifecycle of a specific exposure, position, trade, stake, or rotation using public support events, position changes, carry, risk fields, and caveats.",
	aml_trace_victim_funds: "Trace victim/source funds forward through intermediaries to exchange deposit candidates. Use only when the input addresses are victims or trusted stolen-source addresses; do not use for suspected deposit addresses because traceback belongs to aml_trace_deposit_sources. Exchange hot wallets are terminal only, never candidate deposits. Returns chain-insights.trace.v1 and preserves full addresses exactly.",
	aml_trace_suspect_funds: "Trace suspected scammer, mule, operator, or laundering-ring funds forward to cashout topology. Use when the input addresses are suspect-controlled seeds; incident_timestamp_ms is optional. Do not use for victim/source addresses or suspected deposit endpoints. Exchange hot wallets are terminal only, never candidate suspects or intermediates. Returns chain-insights.trace.v1 and preserves full addresses exactly.",
	aml_trace_deposit_sources: "Trace backward from suspected deposit/cashout addresses to upstream sources, shared funders, and convergence. Use only when the input addresses are suspected non-exchange deposit endpoints; do not treat these seeds as scammers and do not continue forward from discovered suspects here. Exchange hot wallets are excluded as seeds and upstream sources. Returns chain-insights.trace.v1 and preserves full addresses exactly.",
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
const EXPOSURE_TABLE_ROW_KEYS = [
	"exposures",
	"venues",
	"top_exposures",
	"pressure_bands",
	"relationships",
	"evidence",
	"sides"
];
const CHAIN_INSIGHTS_WORKFLOW = [
	"Workflow:",
	"1. Chain Insights workspaces are append-only local working directories. Bootstrap with cia init before workflows that persist artifacts.",
	"2. Do not call investigation tools until required arguments are known. Network is required; use network_capabilities to check supported networks, data layers, retention, and freshness, or ask the user if missing.",
	"3. Use aml_address_risk for single-address enrichment. Use exposure_profile, exposure_quality, exposure_carry, exposure_crowding, exposure_exit_pressure, exposure_correlation, and exposure_explain for exposure analysis. Use aml_trace_victim_funds for victim/source forward tracing, aml_trace_deposit_sources for reverse traceback from suspected deposit endpoints, and aml_trace_suspect_funds for suspect-controlled outbound laundering/cashout topology. Use graph_query(_batch) only when the high-level tools do not answer the exact question.",
	"4. Persisted outputs belong in the initialized workspace under reports/, reports/graphs/, reports/tables/, artifacts/, entities/, sessions/, and published/.",
	"5. For local review, inspect the generated Markdown and graph/table artifacts directly in the workspace."
].join("\n");
const GRAPH_SCHEMA_HINTS = [
	"Graph query hints for network=bittensor:",
	"- The graph is identity-grain. The only topology node label is Identity, keyed by identity_id in the canonical prefixed form <network>:<canonical_address>, for example bittensor:0x1874a43d7c6d888f9eda3d22a3a49704e3cadb24.",
	"- Identity nodes carry identity_id, addresses (member-address list: canonical 0x form first, SS58 form second when present), address_type, labels, and is_exchange. There is no network property; each network has its own graph.",
	"- Identity nodes also carry a slim live risk verdict (risk_score float, risk_level string) for quick triage, plus base activity rollups: degree_in/degree_out, tx_in_count/tx_out_count/tx_total_count, total_in_usd/total_out_usd/total_volume_usd, net_flow_usd, active_days, activity_span_days, first_activity_timestamp/last_activity_timestamp, and lifetime_* variants.",
	"- Resolve any member address form (0x or SS58) to its identity with the indexed exact lookup: MATCH (m:MemberAddress {address: $input})-[:ADDRESS_OF]->(i:Identity) RETURN i.identity_id. :MemberAddress(address) is unique and index-backed.",
	"- Detailed, provenanced scoring still comes from USE facts: (:Identity)-[:HAS_RISK_SCORE]->(:RiskScore) for model versions/processing dates, (:Identity)-[:HAS_LABEL]->(:AddressLabel) for label risk, (:Identity)-[:HAS_FEATURE]->(:AddressFeature) for feature metrics. Use node risk_score/risk_level only as the quick-triage verdict; never read ml_* properties off topology nodes.",
	"- Facts graph labels include Identity, AddressLabel, AddressFeature, RiskScore, and Asset. Facts identity keys match live identity_id values exactly.",
	"- Live topology relationships include FLOWS_TO and RISK_PROXIMITY between Identity nodes, plus OWNS_EXPOSURE/HAS_EXPOSURE to Exposure, HAS_COUNTERPARTY from Exposure to Identity, and TARGETS_INSTRUMENT from Exposure to Instrument.",
	"- FLOWS_TO properties are scoped to the selected topology graph and commonly carry amount_sum, amount_usd_sum, tx_count, first_seen_timestamp, last_seen_timestamp, first_tx_id, last_tx_id. Confirm available fields through runtime schema before relying on them.",
	"- Traversal rule: for BFS, fixed-hop fallback, shortest-path, or manual FLOWS_TO traversal, exchange hot wallets are terminal endpoints only. Do not expand from, through, or classify exchange nodes as deposit, suspect, or intermediate candidates; filter every non-terminal node with is_exchange IS NULL.",
	"- Start schema discovery with endpoint-safe property reads: MATCH (n:Identity) WHERE n.identity_id IS NOT NULL RETURN n.identity_id AS identity_id, n.labels AS labels, n.addresses AS addresses, n.risk_score AS risk_score, n.risk_level AS risk_level LIMIT 20",
	"- Relationship discovery: MATCH (:Identity)-[r:FLOWS_TO]->(:Identity) RETURN r.amount_sum AS amount_sum, r.amount_usd_sum AS amount_usd_sum LIMIT 20",
	"- graph_query uses the active Chain Insights graph endpoint. topology_scope accepts only identity (empty defaults to identity). Use USE live_topology for recent topology, USE archive_topology for historical topology, and USE facts for labels, features, risk scores, assets, and enrichment.",
	"- Archive topology labels include Identity and TopologySnapshot. Archived money-flow topology is represented as (:Identity)-[:FLOWS_TO]->(:Identity) relationships with period_granularity, period_start_date, and period_end_date.",
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
	"Chain Insights is a local graph-analysis workspace for AI agents.",
	CHAIN_INSIGHTS_WORKFLOW,
	GRAPH_REPORT_HINTS,
	GRAPH_SCHEMA_HINTS,
	"Presentation rules: preserve tool summaries as returned; never truncate identity keys or blockchain addresses."
].join("\n\n");
const STATELESS_SERVER_INSTRUCTIONS = [
	"Chain Insights is running as a stateless AML proxy for a host application.",
	"Do not use local workspace persistence, wallet, or graph report workflows in this mode.",
	"Use network_capabilities first when network support is unknown, then call aml_address_risk, exposure_profile, exposure_quality, exposure_carry, exposure_crowding, exposure_exit_pressure, exposure_correlation, exposure_explain, aml_trace_victim_funds, aml_trace_suspect_funds, aml_trace_deposit_sources, graph_query, or graph_query_batch as needed.",
	GRAPH_SCHEMA_HINTS,
	"Presentation rules: preserve tool summaries as returned; never truncate identity keys or blockchain addresses."
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
			address: z.string().min(1).describe("Canonical identity key to screen, in the form <network>:<canonical_address> (for example bittensor:0x1874a43d7c6d888f9eda3d22a3a49704e3cadb24)"),
			network: z.string().min(1).describe(NETWORK_DESCRIPTION),
			compare_address: z.string().optional().describe("Optional second canonical identity key for comparison"),
			include_attachments: z.boolean().optional().describe("Include graph app report metadata")
		};
		case "aml_trace_victim_funds": return {
			victim_addresses: z.string().min(1).describe("Comma-separated canonical victim/source identity keys (<network>:<canonical_address>). Min 1, max 5."),
			network: z.string().min(1).describe(NETWORK_DESCRIPTION),
			known_suspect_addresses: z.string().optional().describe("Optional known suspect identity keys for context only. They are not reverse-traced by this tool. Max 5."),
			incident_timestamp_ms: z.number().min(0).optional().describe("Optional incident timestamp in milliseconds."),
			include_attachments: z.boolean().optional().describe("Include graph app report metadata")
		};
		case "aml_trace_suspect_funds": return {
			network: z.string().min(1).describe(NETWORK_DESCRIPTION),
			suspect_addresses: z.string().min(1).describe("Comma-separated canonical suspected scammer, mule, operator, or laundering-ring identity keys (<network>:<canonical_address>). Min 1, max 5."),
			incident_timestamp_ms: z.number().min(0).optional().describe("Optional incident timestamp in milliseconds. This tool also works without a timestamp."),
			max_hops: z.number().int().min(1).max(5).optional().describe("Maximum forward trace hops. Default 3.")
		};
		case "aml_trace_deposit_sources": return {
			network: z.string().min(1).describe(NETWORK_DESCRIPTION),
			deposit_addresses: z.string().min(1).describe("Comma-separated canonical suspected deposit/cashout identity keys (<network>:<canonical_address>). Min 1, max 5."),
			max_hops: z.number().int().min(1).max(5).optional().describe("Maximum reverse traceback hops. Default 2."),
			include_attachments: z.boolean().optional().describe("Include graph app report metadata")
		};
		case "exposure_profile": return {
			network: z.string().min(1).describe(NETWORK_DESCRIPTION),
			account: z.string().optional().describe("Canonical account identity key (<network>:<canonical_address>) to inspect. Provide exactly one of account, owner, or counterparty."),
			owner: z.string().optional().describe("Canonical owner identity key to inspect. Provide exactly one of account, owner, or counterparty."),
			counterparty: z.string().optional().describe("Canonical counterparty identity key to inspect. Provide exactly one of account, owner, or counterparty."),
			venue: z.string().optional().describe("Optional venue filter, such as Bittensor or Hyperliquid."),
			instrument: z.string().optional().describe("Optional instrument display or durable identifier filter, such as Subnet 19 or BTC-PERP."),
			instrument_type: z.string().optional().describe("Optional instrument type filter, such as subnet, perp, spot, vault, staking, or other."),
			start_timestamp_ms: z.number().min(0).optional().describe("Optional inclusive lower activity timestamp bound in milliseconds."),
			end_timestamp_ms: z.number().min(0).optional().describe("Optional inclusive upper activity timestamp bound in milliseconds."),
			limit: z.number().int().min(1).max(500).optional().describe("Maximum exposure rows to inspect. Default 100, max 500.")
		};
		case "exposure_quality":
		case "exposure_carry": return {
			network: z.string().min(1).describe(NETWORK_DESCRIPTION),
			account: z.string().optional().describe("Canonical account identity key (<network>:<canonical_address>) to inspect. Provide exactly one of account, owner, or counterparty."),
			owner: z.string().optional().describe("Canonical owner identity key to inspect. Provide exactly one of account, owner, or counterparty."),
			counterparty: z.string().optional().describe("Canonical counterparty identity key to inspect. Provide exactly one of account, owner, or counterparty."),
			venue: z.string().optional().describe("Optional venue filter, such as Bittensor or Hyperliquid."),
			instrument: z.string().optional().describe("Optional instrument display or durable identifier filter, such as Subnet 19 or BTC-PERP."),
			instrument_type: z.string().optional().describe("Optional instrument type filter, such as subnet, perp, spot, vault, staking, or other."),
			start_timestamp_ms: z.number().min(0).optional().describe("Optional inclusive lower activity timestamp bound in milliseconds."),
			end_timestamp_ms: z.number().min(0).optional().describe("Optional inclusive upper activity timestamp bound in milliseconds."),
			limit: z.number().int().min(1).max(500).optional().describe("Maximum exposure rows to inspect. Default 100, max 500.")
		};
		case "exposure_crowding": return {
			network: z.string().min(1).describe(NETWORK_DESCRIPTION),
			instrument: z.string().min(1).describe("Instrument, market, subnet, hotkey, vault, or durable exposure target identifier to inspect."),
			market: z.string().optional().describe("Alias for instrument when using market language."),
			venue: z.string().optional().describe("Optional venue filter, such as Bittensor or Hyperliquid."),
			instrument_type: z.string().optional().describe("Optional instrument type filter, such as subnet, perp, spot, vault, staking, or other."),
			start_timestamp_ms: z.number().min(0).optional().describe("Optional inclusive lower activity timestamp bound in milliseconds."),
			end_timestamp_ms: z.number().min(0).optional().describe("Optional inclusive upper activity timestamp bound in milliseconds."),
			limit: z.number().int().min(1).max(500).optional().describe("Maximum exposure rows to inspect. Default 100, max 500.")
		};
		case "exposure_exit_pressure": return {
			network: z.string().min(1).describe(NETWORK_DESCRIPTION),
			account: z.string().optional().describe("Optional canonical account identity key to inspect. Provide an account-style subject or an instrument/market."),
			owner: z.string().optional().describe("Optional canonical owner identity key to inspect. Provide an account-style subject or an instrument/market."),
			counterparty: z.string().optional().describe("Optional canonical counterparty identity key to inspect. Provide an account-style subject or an instrument/market."),
			instrument: z.string().optional().describe("Instrument, market, subnet, hotkey, vault, or durable exposure target identifier to inspect."),
			market: z.string().optional().describe("Alias for instrument when using market language."),
			venue: z.string().optional().describe("Optional venue filter, such as Bittensor or Hyperliquid."),
			instrument_type: z.string().optional().describe("Optional instrument type filter, such as subnet, perp, spot, vault, staking, or other."),
			start_timestamp_ms: z.number().min(0).optional().describe("Optional inclusive lower activity timestamp bound in milliseconds."),
			end_timestamp_ms: z.number().min(0).optional().describe("Optional inclusive upper activity timestamp bound in milliseconds."),
			limit: z.number().int().min(1).max(500).optional().describe("Maximum exposure rows to inspect. Default 100, max 500.")
		};
		case "exposure_correlation": return {
			network: z.string().min(1).describe(NETWORK_DESCRIPTION),
			account: z.string().optional().describe("Canonical account identity key (<network>:<canonical_address>) to inspect. Provide exactly one of account, owner, or counterparty."),
			owner: z.string().optional().describe("Canonical owner identity key to inspect. Provide exactly one of account, owner, or counterparty."),
			counterparty: z.string().optional().describe("Canonical counterparty identity key to inspect. Provide exactly one of account, owner, or counterparty."),
			candidate_accounts: z.union([z.string(), z.array(z.string())]).optional().describe("Optional comma-separated or array candidate account identity keys to compare against."),
			venue: z.string().optional().describe("Optional venue filter, such as Bittensor or Hyperliquid."),
			instrument: z.string().optional().describe("Optional instrument display or durable identifier filter."),
			instrument_type: z.string().optional().describe("Optional instrument type filter, such as subnet, perp, spot, vault, staking, or other."),
			start_timestamp_ms: z.number().min(0).optional().describe("Optional inclusive lower activity timestamp bound in milliseconds."),
			end_timestamp_ms: z.number().min(0).optional().describe("Optional inclusive upper activity timestamp bound in milliseconds."),
			limit: z.number().int().min(1).max(500).optional().describe("Maximum exposure rows to inspect. Default 100, max 500.")
		};
		case "exposure_explain": return {
			network: z.string().min(1).describe(NETWORK_DESCRIPTION),
			account: z.string().optional().describe("Canonical account identity key (<network>:<canonical_address>) to inspect. Provide exactly one of account, owner, or counterparty."),
			owner: z.string().optional().describe("Canonical owner identity key to inspect. Provide exactly one of account, owner, or counterparty."),
			counterparty: z.string().optional().describe("Canonical counterparty identity key to inspect. Provide exactly one of account, owner, or counterparty."),
			instrument: z.string().optional().describe("Optional instrument display or durable identifier filter."),
			market: z.string().optional().describe("Alias for instrument when using market language."),
			position_id: z.string().optional().describe("Optional venue-native position, trade, stake, rotation, or lifecycle identifier when available."),
			venue: z.string().optional().describe("Optional venue filter, such as Bittensor or Hyperliquid."),
			instrument_type: z.string().optional().describe("Optional instrument type filter, such as subnet, perp, spot, vault, staking, or other."),
			start_timestamp_ms: z.number().min(0).optional().describe("Optional inclusive lower activity timestamp bound in milliseconds."),
			end_timestamp_ms: z.number().min(0).optional().describe("Optional inclusive upper activity timestamp bound in milliseconds."),
			limit: z.number().int().min(1).max(500).optional().describe("Maximum exposure rows to inspect. Default 25, max 500.")
		};
		case "graph_query": return {
			query: z.string().min(1).describe("Read-only GQL/Cypher query. Use USE live_topology for recent topology, USE archive_topology for historical topology, and USE facts for labels, features, risk scores, assets, and enrichment."),
			network: z.string().min(1).describe(NETWORK_DESCRIPTION)
		};
		case "graph_query_batch": return {
			network: z.string().min(1).describe(NETWORK_DESCRIPTION),
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
	const schema = z.string().describe(description);
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
		description: "Screen a canonical identity key for AML risk, behavioral patterns, neighborhood profile, member addresses, and exchange links.",
		argsSchema: {
			address: z.string().describe("Canonical identity key to screen (<network>:<canonical_address>)"),
			network: z.string().describe(NETWORK_DESCRIPTION)
		}
	}, async ({ address, network }) => promptResult([
		`Use Chain Insights aml_address_risk on ${network} for:`,
		"",
		`\`${address}\``,
		"",
		"Present the summary as-is. Do not add analysis, verdicts, or risk assessments; the tool output already contains the risk assessment."
	].join("\n"), "Address risk screening"));
	if (!remotePromptNames.has("trace-tools")) server.registerPrompt("trace-tools", {
		title: "Trace Tools",
		description: "Choose aml_trace_victim_funds, aml_trace_deposit_sources, or aml_trace_suspect_funds based on the evidence role.",
		argsSchema: {
			addresses: z.string().describe("Input addresses, comma-separated full addresses"),
			role: z.enum([
				"victim",
				"suspect",
				"deposit"
			]).describe("Role of the supplied addresses"),
			network: z.string().describe(NETWORK_DESCRIPTION)
		}
	}, async ({ addresses, role, network }) => {
		return promptResult([
			`Use Chain Insights ${role === "deposit" ? "aml_trace_deposit_sources" : `aml_trace_${role}_funds`} on ${network}.`,
			"",
			"Full addresses:",
			addresses,
			"",
			role === "deposit" ? "For deposit role, use aml_trace_deposit_sources rather than aml_trace_deposit_funds." : "Present the summary as-is and use continuation.recommended_next_tools for follow-up."
		].join("\n"), "Trace role-specific funds");
	});
	server.registerPrompt("graph-query", {
		title: "Federated Graph Query",
		description: "Run a read-only GQL/Cypher query through the Chain Insights graph endpoint.",
		argsSchema: {
			query: z.string().describe("Read-only GQL/Cypher query"),
			network: z.string().describe(NETWORK_DESCRIPTION)
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
			queries: z.string().describe("JSON array of query objects with optional id and required query fields"),
			network: z.string().describe(NETWORK_DESCRIPTION),
			per_query_timeout_seconds: z.string().optional().describe("Optional integer timeout per query, 1-600 seconds")
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
		description: "Show available Chain Insights tools and workspace workflow.",
		argsSchema: {}
	}, async () => promptResult("Use Chain Insights help. Summarize the available tools and workspace workflow without inventing capabilities.", "Chain Insights help"));
}
function hasGraphArrayFields(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const record = value;
	return GRAPH_ARRAY_KEYS.some((key) => Array.isArray(record[key]));
}
function sanitizeSlug(value) {
	return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[._-]+|[._-]+$/g, "") || "exposure";
}
function exposureArtifactTimestamp(date = /* @__PURE__ */ new Date()) {
	return date.toISOString().replace(/[-:.]/g, "").replace(/\.[0-9]{3}Z$/, "Z");
}
function csvEscape(value) {
	if (value === void 0 || value === null) return "\"\"";
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return JSON.stringify(String(value));
	return JSON.stringify(value);
}
function tableRowsFromExposureContent(structuredContent) {
	for (const key of EXPOSURE_TABLE_ROW_KEYS) {
		const value = structuredContent[key];
		if (!Array.isArray(value) || value.length === 0) continue;
		if (!value.every((row) => isRecord(row))) continue;
		return value;
	}
}
function exposureRowsToCsv(rows) {
	const headers = /* @__PURE__ */ new Set();
	for (const row of rows) for (const key of Object.keys(row)) headers.add(key);
	const headerList = [...headers];
	const lines = [headerList.map(csvEscape).join(",")];
	for (const row of rows) lines.push(headerList.map((header) => csvEscape(row[header])).join(","));
	return lines.join("\n") + "\n";
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
		const { writeGraphReport } = await import("./graph-reports-CEq-Mvx0.mjs");
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
	const { writeGraphReport } = await import("./graph-reports-CEq-Mvx0.mjs");
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
async function writeExposureArtifacts(result, toolName, subject, network, includeAttachments) {
	if (!includeAttachments) return void 0;
	const { workspaceOutputPaths } = await import("./output-root-BK4pdjyz.mjs").then((n) => n.t);
	const paths = workspaceOutputPaths();
	const now = /* @__PURE__ */ new Date();
	const slug = `${exposureArtifactTimestamp(now)}-${sanitizeSlug(toolName)}-${sanitizeSlug(subject)}-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
	await Promise.all([mkdir(paths.reportsRoot, {
		recursive: true,
		mode: 448
	}), mkdir(paths.reportTablesRoot, {
		recursive: true,
		mode: 448
	})]);
	const reportPath = path.join(paths.reportsRoot, `${slug}.exposure-report.md`);
	const compactFactsPath = path.join(paths.reportTablesRoot, `${slug}.compact-facts.json`);
	const compactFacts = {
		schema: result.structuredContent.schema,
		tool: result.structuredContent.tool,
		network,
		subject,
		generated_at: now.toISOString(),
		summary_text: result.summaryText,
		facts: result.structuredContent
	};
	const reportBody = [
		`# ${toolName} Report`,
		"",
		`Network: ${network}`,
		`Generated: ${now.toISOString()}`,
		"",
		result.summaryText,
		"",
		"## Artifacts",
		`- Report: ${reportPath}`,
		`- Compact facts: ${compactFactsPath}`
	];
	const tableRows = tableRowsFromExposureContent(result.structuredContent);
	if (tableRows) {
		const tablePath = path.join(paths.reportTablesRoot, `${slug}.table.csv`);
		reportBody.push(`- Table: ${tablePath}`);
		await writeFile(tablePath, exposureRowsToCsv(tableRows), { mode: 384 });
	}
	await writeFile(reportPath, reportBody.join("\n") + "\n", { mode: 384 });
	await writeFile(compactFactsPath, JSON.stringify(compactFacts, null, 2) + "\n", { mode: 384 });
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
	const { createConfiguredGraphMcpFetch, resolveGraphMcpEndpoint } = await import("./client-ytTO0mcZ.mjs").then((n) => n.r);
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
	if (workspaceArtifactsEnabled) {
		server.registerTool("balance", {
			description: "Show the local Chain Insights payment wallet address and Base USDC balance.",
			inputSchema: z.object({}).passthrough()
		}, async () => {
			try {
				const { getWalletAccount, getWalletBalanceText } = await import("./tools-v6kcdojg.mjs").then((n) => n.c);
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
		registerAppResource(server, "Fund Flow Graph", GRAPH_RESOURCE_URI, {
			description: "Interactive D3 force-directed graph for fund flow and pattern visualization. It loads local graph report URLs returned in _meta.chainInsights.graph.url.",
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
				address: z.string().min(1).describe("Canonical identity key to screen (<network>:<canonical_address>)"),
				network: z.string().min(1).describe(NETWORK_DESCRIPTION),
				compare_address: z.string().optional().describe("Optional second full address for comparison"),
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
				const { addressRisk } = await import("./public-tools-CUzKPYod.mjs");
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
				victim_addresses: z.union([z.string().min(1), z.array(z.string().min(1))]).describe("Comma-separated canonical victim/source identity keys, or an array. Min 1, max 5."),
				network: z.string().min(1).describe(NETWORK_DESCRIPTION),
				known_suspect_addresses: z.union([z.string(), z.array(z.string())]).optional().describe("Known suspect addresses for context only. This tool does not reverse-trace them. Max 5."),
				include_attachments: z.boolean().optional().describe("Include graph app report metadata"),
				incident_timestamp_ms: z.number().min(0).optional().describe("Optional incident timestamp in milliseconds."),
				max_hops: z.number().int().min(1).max(5).optional(),
				per_address_limit: z.number().int().min(1).max(10).optional(),
				min_amount_sum: z.number().min(0).optional()
			},
			_meta: { ui: { resourceUri: GRAPH_RESOURCE_URI } },
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: true
			}
		}, async ({ victim_addresses, known_suspect_addresses, network, incident_timestamp_ms, max_hops, per_address_limit, min_amount_sum, include_attachments }) => {
			try {
				if (!remoteConnected) return {
					content: [{
						type: "text",
						text: `${remoteUnavailableMessage ?? `Graph MCP is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`
					}],
					isError: true
				};
				const { traceVictimFunds } = await import("./public-tools-CUzKPYod.mjs");
				const result = await traceVictimFunds(remoteClient, config, {
					victimAddresses: victim_addresses,
					knownSuspectAddresses: known_suspect_addresses,
					network,
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
				network: z.string().min(1).describe(NETWORK_DESCRIPTION),
				suspect_addresses: z.union([z.string().min(1), z.array(z.string().min(1))]).describe("Comma-separated canonical suspect-controlled identity keys, or an array. Min 1, max 5."),
				incident_timestamp_ms: z.number().min(0).optional().describe("Optional incident timestamp in milliseconds. This tool works without it."),
				max_hops: z.number().int().min(1).max(5).optional().describe("Maximum forward trace hops. Default 3."),
				per_address_limit: z.number().int().min(1).max(10).optional(),
				min_amount_sum: z.number().min(0).optional(),
				include_attachments: z.boolean().optional().describe("Include graph app report metadata")
			},
			_meta: { ui: { resourceUri: GRAPH_RESOURCE_URI } },
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: true
			}
		}, async ({ suspect_addresses, incident_timestamp_ms, network, max_hops, per_address_limit, min_amount_sum, include_attachments }) => {
			try {
				if (!remoteConnected) return {
					content: [{
						type: "text",
						text: `${remoteUnavailableMessage ?? `Graph MCP is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`
					}],
					isError: true
				};
				const { traceSuspectFunds } = await import("./public-tools-CUzKPYod.mjs");
				const result = await traceSuspectFunds(remoteClient, config, {
					suspectAddresses: suspect_addresses,
					network,
					maxHops: max_hops,
					perAddressLimit: per_address_limit,
					minAmountSum: min_amount_sum,
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
				network: z.string().min(1).describe(NETWORK_DESCRIPTION),
				deposit_addresses: z.union([z.string().min(1), z.array(z.string().min(1))]).describe("Comma-separated canonical suspected deposit/cashout identity keys, or an array. Min 1, max 5."),
				max_hops: z.number().int().min(1).max(5).optional().describe("Maximum reverse traceback hops. Default 2."),
				include_attachments: z.boolean().optional().describe("Include graph app report metadata")
			},
			_meta: { ui: { resourceUri: GRAPH_RESOURCE_URI } },
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
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
				const { traceDepositSources } = await import("./public-tools-CUzKPYod.mjs");
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
		if (!remoteToolNames.has("exposure_profile")) registerAppTool(server, "exposure_profile", {
			title: "Exposure Profile",
			description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.exposure_profile,
			inputSchema: {
				network: z.string().min(1).describe(NETWORK_DESCRIPTION),
				account: z.string().optional().describe("Canonical account identity key (<network>:<canonical_address>) to inspect. Provide exactly one of account, owner, or counterparty."),
				owner: z.string().optional().describe("Canonical owner identity key to inspect. Provide exactly one of account, owner, or counterparty."),
				counterparty: z.string().optional().describe("Canonical counterparty identity key to inspect. Provide exactly one of account, owner, or counterparty."),
				venue: z.string().optional().describe("Optional venue filter, such as Bittensor or Hyperliquid."),
				instrument: z.string().optional().describe("Optional instrument display or durable identifier filter, such as Subnet 19 or BTC-PERP."),
				instrument_type: z.string().optional().describe("Optional instrument type filter, such as subnet, perp, spot, vault, staking, or other."),
				start_timestamp_ms: z.number().min(0).optional().describe("Optional inclusive lower activity timestamp bound in milliseconds."),
				end_timestamp_ms: z.number().min(0).optional().describe("Optional inclusive upper activity timestamp bound in milliseconds."),
				limit: z.number().int().min(1).max(500).optional().describe("Maximum exposure rows to inspect. Default 100, max 500.")
			},
			_meta: { ui: { resourceUri: GRAPH_RESOURCE_URI } },
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true
			}
		}, async ({ network, account, owner, counterparty, venue, instrument, instrument_type, start_timestamp_ms, end_timestamp_ms, limit }) => {
			try {
				if (!remoteConnected) return {
					content: [{
						type: "text",
						text: `${remoteUnavailableMessage ?? `Graph MCP is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`
					}],
					isError: true
				};
				const { exposureProfile } = await import("./public-tools-CUzKPYod.mjs");
				const result = await exposureProfile(remoteClient, {
					network,
					account,
					owner,
					counterparty,
					venue,
					instrument,
					instrumentType: instrument_type,
					startTimestampMs: start_timestamp_ms,
					endTimestampMs: end_timestamp_ms,
					limit
				});
				const subject = account ?? owner ?? counterparty ?? "subject";
				await writeExposureArtifacts({
					summaryText: result.summaryText,
					structuredContent: result.structuredContent
				}, "exposure_profile", subject, network, workspaceArtifactsEnabled);
				return {
					content: [{
						type: "text",
						text: result.summaryText
					}],
					structuredContent: result.structuredContent,
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
						text: `Exposure profile failed: ${err.message}`
					}],
					isError: true
				};
			}
		});
		for (const tool of [
			{
				name: "exposure_quality",
				title: "Exposure Quality",
				failure: "Exposure quality failed"
			},
			{
				name: "exposure_carry",
				title: "Exposure Carry",
				failure: "Exposure carry failed"
			},
			{
				name: "exposure_crowding",
				title: "Exposure Crowding",
				failure: "Exposure crowding failed"
			},
			{
				name: "exposure_exit_pressure",
				title: "Exposure Exit Pressure",
				failure: "Exposure exit pressure failed"
			},
			{
				name: "exposure_correlation",
				title: "Exposure Correlation",
				failure: "Exposure correlation failed"
			},
			{
				name: "exposure_explain",
				title: "Exposure Explain",
				failure: "Exposure explain failed"
			}
		]) {
			if (remoteToolNames.has(tool.name)) continue;
			registerAppTool(server, tool.name, {
				title: tool.title,
				description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS[tool.name],
				inputSchema: knownPublicToolInputSchema(tool.name) ?? {},
				_meta: { ui: { resourceUri: GRAPH_RESOURCE_URI } },
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: true
				}
			}, async (args) => {
				try {
					if (!remoteConnected) return {
						content: [{
							type: "text",
							text: `${remoteUnavailableMessage ?? `Graph MCP is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`
						}],
						isError: true
					};
					const input = args;
					const { exposureCarry, exposureCorrelation, exposureCrowding, exposureExitPressure, exposureExplain, exposureQuality } = await import("./public-tools-CUzKPYod.mjs");
					const options = {
						network: String(input["network"] ?? ""),
						account: input["account"] === void 0 ? void 0 : String(input["account"]),
						owner: input["owner"] === void 0 ? void 0 : String(input["owner"]),
						counterparty: input["counterparty"] === void 0 ? void 0 : String(input["counterparty"]),
						venue: input["venue"] === void 0 ? void 0 : String(input["venue"]),
						instrument: input["instrument"] === void 0 ? void 0 : String(input["instrument"]),
						market: input["market"] === void 0 ? void 0 : String(input["market"]),
						instrumentType: input["instrument_type"] === void 0 ? void 0 : String(input["instrument_type"]),
						startTimestampMs: typeof input["start_timestamp_ms"] === "number" ? input["start_timestamp_ms"] : void 0,
						endTimestampMs: typeof input["end_timestamp_ms"] === "number" ? input["end_timestamp_ms"] : void 0,
						limit: typeof input["limit"] === "number" ? input["limit"] : void 0,
						candidateAccounts: input["candidate_accounts"],
						positionId: input["position_id"] === void 0 ? void 0 : String(input["position_id"])
					};
					const result = tool.name === "exposure_quality" ? await exposureQuality(remoteClient, options) : tool.name === "exposure_carry" ? await exposureCarry(remoteClient, options) : tool.name === "exposure_crowding" ? await exposureCrowding(remoteClient, options) : tool.name === "exposure_exit_pressure" ? await exposureExitPressure(remoteClient, options) : tool.name === "exposure_correlation" ? await exposureCorrelation(remoteClient, options) : await exposureExplain(remoteClient, options);
					const subject = options.account ?? options.owner ?? options.counterparty ?? options.instrument ?? options.market ?? "subject";
					await writeExposureArtifacts({
						summaryText: result.summaryText,
						structuredContent: result.structuredContent
					}, tool.name, subject, options.network, workspaceArtifactsEnabled);
					return {
						content: [{
							type: "text",
							text: result.summaryText
						}],
						structuredContent: result.structuredContent,
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
							text: `${tool.failure}: ${err.message}`
						}],
						isError: true
					};
				}
			});
		}
		server.registerTool("help", {
			description: "Show Chain Insights overview, available tools, and investigation workflow.",
			inputSchema: z.object({}).passthrough()
		}, async () => ({
			content: [{
				type: "text",
				text: workspaceArtifactsEnabled ? [
					"Chain Insights workspace for AI agents. Workspaces are plain local files for reports, artifacts, graphs, and published outputs.",
					"",
					CHAIN_INSIGHTS_WORKFLOW,
					"",
					"Investigation tools:",
					"- network_capabilities: inspect supported networks, data layers, tool availability, retention windows, and freshness.",
					"- aml_address_risk: screen a canonical identity key for AML risk, behavior, neighborhood, member addresses, exchange exposure, and optional compare_address connection checks.",
					"- exposure_profile: explain staking or trading exposure around one account, owner, or counterparty.",
					"- exposure_quality: score whether exposure behavior looks disciplined, fragile, lucky, or noisy.",
					"- exposure_carry: explain carry earned or paid from staking, trading, funding, fees, emissions, or dividends.",
					"- exposure_crowding: measure side concentration for a market, subnet, hotkey, vault, or strategy.",
					"- exposure_exit_pressure: explain liquidation, slippage, unstake, funding pain, or other exit pressure.",
					"- exposure_correlation: compare accounts for possible copy, overlap, or strategy-cluster behavior.",
					"- exposure_explain: explain a specific exposure lifecycle, trade, position, stake, rotation, or incident.",
					"- aml_trace_victim_funds: trace up to five victim/source addresses forward to exchange deposit candidates.",
					"- aml_trace_deposit_sources: trace backward from suspected deposit/cashout addresses to upstream funders and shared-source convergence.",
					"- aml_trace_suspect_funds: trace up to five suspected scammer, mule, operator, or laundering-ring addresses forward to cashout topology.",
					"- graph_query: run read-only GQL/Cypher through the universal graph endpoint. Use USE live_topology, USE archive_topology, or USE facts.",
					"- graph_query_batch: run related read-only graph-language queries through one paid graph call.",
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
					"Local workspace persistence, wallet, and graph report attachment tools are disabled in this mode.",
					"",
					"Available graph-backed tools:",
					"- network_capabilities: inspect supported networks, data layers, tool availability, retention windows, and freshness.",
					"- aml_address_risk: screen a canonical identity key for AML risk, behavior, neighborhood, member addresses, exchange exposure, and optional compare_address connection checks.",
					"- exposure_profile: explain staking or trading exposure around one account, owner, or counterparty.",
					"- exposure_quality: score whether exposure behavior looks disciplined, fragile, lucky, or noisy.",
					"- exposure_carry: explain carry earned or paid from staking, trading, funding, fees, emissions, or dividends.",
					"- exposure_crowding: measure side concentration for a market, subnet, hotkey, vault, or strategy.",
					"- exposure_exit_pressure: explain liquidation, slippage, unstake, funding pain, or other exit pressure.",
					"- exposure_correlation: compare accounts for possible copy, overlap, or strategy-cluster behavior.",
					"- exposure_explain: explain a specific exposure lifecycle, trade, position, stake, rotation, or incident.",
					"- aml_trace_victim_funds: trace up to five victim/source addresses forward to exchange deposit candidates.",
					"- aml_trace_deposit_sources: trace backward from suspected deposit/cashout addresses to upstream funders and shared-source convergence.",
					"- aml_trace_suspect_funds: trace up to five suspected scammer, mule, operator, or laundering-ring addresses forward to cashout topology.",
					"- graph_query: run read-only GQL/Cypher through the universal graph endpoint. Use USE live_topology, USE archive_topology, or USE facts.",
					"- graph_query_batch: run related read-only graph-language queries through one paid graph call.",
					"",
					GRAPH_SCHEMA_HINTS
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