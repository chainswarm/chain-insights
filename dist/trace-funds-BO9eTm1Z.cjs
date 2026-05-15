const require_chunk = require("./chunk-CZWwpsFl.cjs");
const require_active = require("./active-MGRSlbaM.cjs");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_fs_promises = require("node:fs/promises");
//#region src/investigation/trace-funds.ts
const SCHEMA_QUERY_SET = [
	{
		id: "node_labels",
		query: "MATCH (n) UNWIND labels(n) AS label RETURN label, count(*) AS count ORDER BY count DESC LIMIT 100"
	},
	{
		id: "relationship_types",
		query: "MATCH ()-[r]->() RETURN type(r) AS relationship_type, count(*) AS count ORDER BY count DESC LIMIT 100"
	},
	{
		id: "address_property_keys",
		query: "MATCH (n:Address) WITH keys(n) AS keys LIMIT 1000 UNWIND keys AS property_key RETURN property_key, count(*) AS sample_count ORDER BY sample_count DESC, property_key LIMIT 200"
	},
	{
		id: "flows_to_property_keys",
		query: "MATCH ()-[r:FLOWS_TO]->() WITH keys(r) AS keys LIMIT 1000 UNWIND keys AS property_key RETURN property_key, count(*) AS sample_count ORDER BY sample_count DESC, property_key LIMIT 200"
	}
];
function clampInt(value, fallback, min, max) {
	if (!Number.isFinite(value)) return fallback;
	return Math.max(min, Math.min(max, Math.trunc(value)));
}
function escapeCypherString(value) {
	return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}
function sanitizeSegment(value) {
	return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80) || "trace";
}
function outputRoot(config) {
	return require_active.findActiveWorkspace()?.root ?? config.dataDir;
}
async function ensureDirs(root) {
	await (0, node_fs_promises.mkdir)(node_path.default.join(root, ".chain-insights", "schema"), {
		recursive: true,
		mode: 448
	});
	await (0, node_fs_promises.mkdir)(node_path.default.join(root, "reports", "graphs"), {
		recursive: true,
		mode: 448
	});
	await (0, node_fs_promises.mkdir)(node_path.default.join(root, "reports", "tables"), {
		recursive: true,
		mode: 448
	});
}
function textFromToolResult(result) {
	return (result.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join("\n");
}
function parseBatchResult(result) {
	const text = textFromToolResult(result).trim();
	if (!text) throw new Error("graph_query_batch returned no text content");
	const parsed = JSON.parse(text);
	if (!parsed.facts?.queries) throw new Error("graph_query_batch response did not include facts.queries");
	return parsed;
}
async function callGraphBatch(remoteClient, network, queries) {
	const result = await remoteClient.callTool({
		name: "graph_query_batch",
		arguments: {
			network,
			queries,
			per_query_timeout_seconds: 10
		}
	});
	if (result.isError) throw new Error(textFromToolResult(result) || "graph_query_batch failed");
	return parseBatchResult(result);
}
function resultsFor(batch, id) {
	const query = batch.facts?.queries?.find((entry) => entry.id === id);
	if (!query) return [];
	if (query.ok === false) throw new Error(query.error || `Query failed: ${id}`);
	return query.results ?? [];
}
function schemaFromBatch(network, batch) {
	return {
		schema: "chain-insights.runtime_graph_schema.v1",
		network,
		source: "graph_query_batch",
		node_labels: resultsFor(batch, "node_labels"),
		relationship_types: resultsFor(batch, "relationship_types"),
		address_property_keys: resultsFor(batch, "address_property_keys").map((row) => row["property_key"]),
		flows_to_property_keys: resultsFor(batch, "flows_to_property_keys").map((row) => row["property_key"]),
		recommended_flow_projection: [
			"src.address AS src",
			"dst.address AS dst",
			"r.amount_sum AS amount_sum",
			"r.amount_usd_sum AS amount_usd_sum",
			"r.tx_count AS tx_count",
			"r.first_tx_id AS first_tx_id",
			"r.last_tx_id AS last_tx_id",
			"dst.labels AS dst_labels",
			"dst.degree_in AS dst_degree_in",
			"dst.degree_out AS dst_degree_out"
		]
	};
}
async function loadOrCaptureSchema(remoteClient, root, network) {
	const filePath = node_path.default.join(root, ".chain-insights", "schema", `${sanitizeSegment(network)}.graph-schema.json`);
	try {
		return {
			schema: JSON.parse(await (0, node_fs_promises.readFile)(filePath, "utf8")),
			filePath
		};
	} catch (err) {
		if (err.code !== "ENOENT") throw err;
	}
	const schema = schemaFromBatch(network, await callGraphBatch(remoteClient, network, SCHEMA_QUERY_SET));
	await (0, node_fs_promises.writeFile)(filePath, JSON.stringify(schema, null, 2) + "\n", { mode: 384 });
	return {
		schema,
		filePath
	};
}
function flowQuery(id, address, limit, minAmountSum) {
	const minFilter = minAmountSum > 0 ? ` AND r.amount_sum >= ${minAmountSum}` : "";
	return {
		id,
		query: [
			`MATCH (src:Address {address: "${escapeCypherString(address)}"})-[r:FLOWS_TO]->(dst)`,
			`WHERE r.amount_sum IS NOT NULL${minFilter} AND NOT ('Exchange' IN labels(src))`,
			"RETURN src.address AS src, labels(src) AS src_labels, dst.address AS dst, labels(dst) AS dst_labels, r.amount_sum AS amount_sum, r.amount_usd_sum AS amount_usd_sum, r.tx_count AS tx_count, r.first_tx_id AS first_tx_id, r.last_tx_id AS last_tx_id, dst.degree_in AS dst_degree_in, dst.degree_out AS dst_degree_out, ('Exchange' IN labels(dst)) AS terminal_exchange",
			"ORDER BY r.amount_usd_sum DESC, r.amount_sum DESC",
			`LIMIT ${limit}`
		].join(" ")
	};
}
function numberValue(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function stringArrayValue(value) {
	return Array.isArray(value) ? value.map(String) : void 0;
}
function flowFromRow(hop, row) {
	const src = typeof row["src"] === "string" ? row["src"] : null;
	const dst = typeof row["dst"] === "string" ? row["dst"] : null;
	const amount = numberValue(row["amount_sum"]);
	if (!src || !dst || amount === void 0) return null;
	return {
		hop,
		src,
		dst,
		amount_sum: amount,
		amount_usd_sum: numberValue(row["amount_usd_sum"]),
		tx_count: numberValue(row["tx_count"]),
		first_tx_id: typeof row["first_tx_id"] === "string" ? row["first_tx_id"] : void 0,
		last_tx_id: typeof row["last_tx_id"] === "string" ? row["last_tx_id"] : void 0,
		src_labels: stringArrayValue(row["src_labels"]),
		dst_labels: stringArrayValue(row["dst_labels"]),
		dst_degree_in: numberValue(row["dst_degree_in"]),
		dst_degree_out: numberValue(row["dst_degree_out"]),
		terminal_exchange: row["terminal_exchange"] === true || stringArrayValue(row["dst_labels"])?.includes("Exchange") === true
	};
}
function isExchangeFlow(flow) {
	return flow.terminal_exchange || flow.dst_labels?.includes("Exchange") === true;
}
async function collectFlows(remoteClient, options) {
	const flows = [];
	const visited = new Set([options.seedAddress]);
	let frontier = [options.seedAddress];
	for (let hop = 1; hop <= options.maxHops && frontier.length > 0; hop += 1) {
		const queries = frontier.slice(0, 20).map((address, index) => flowQuery(`hop_${hop}_${index + 1}`, address, options.perAddressLimit, options.minAmountSum));
		const batch = await callGraphBatch(remoteClient, options.network, queries);
		const next = /* @__PURE__ */ new Set();
		for (const query of batch.facts?.queries ?? []) for (const row of query.results ?? []) {
			const flow = flowFromRow(hop, row);
			if (!flow) continue;
			flows.push(flow);
			if (!isExchangeFlow(flow) && !visited.has(flow.dst)) next.add(flow.dst);
		}
		for (const address of next) visited.add(address);
		frontier = [...next];
	}
	return flows;
}
function buildGraph(seedAddress, network, flows) {
	const totals = /* @__PURE__ */ new Map();
	const ensure = (address) => {
		if (!totals.has(address)) totals.set(address, {
			in: 0,
			out: 0,
			labels: [],
			role: address === seedAddress ? "victim" : null
		});
		return totals.get(address);
	};
	for (const flow of flows) {
		ensure(flow.src).out += flow.amount_usd_sum ?? flow.amount_sum;
		const dst = ensure(flow.dst);
		dst.in += flow.amount_usd_sum ?? flow.amount_sum;
		dst.labels = flow.dst_labels ?? [];
		if (isExchangeFlow(flow)) dst.role = "exchange";
	}
	return {
		schema: "chain-insights.graph.v1",
		nodes: [...totals.entries()].map(([address, data]) => ({
			address,
			labels: data.labels,
			address_type: data.role === "exchange" ? "exchange" : "wallet",
			role: data.role,
			flow_in_usd: data.in,
			flow_out_usd: data.out,
			risk_level: null,
			pattern_flags: []
		})),
		edges: flows.map((flow) => ({
			from_address: flow.src,
			to_address: flow.dst,
			usd_amount: flow.amount_usd_sum ?? flow.amount_sum,
			amount_sum: flow.amount_sum,
			tx_count: flow.tx_count ?? 0,
			first_tx_id: flow.first_tx_id,
			last_tx_id: flow.last_tx_id,
			type: "FLOWS_TO",
			terminal_exchange: flow.terminal_exchange
		})),
		flows,
		edge_anchors: [],
		metadata: {
			seed_address: seedAddress,
			network,
			generated_at: (/* @__PURE__ */ new Date()).toISOString()
		}
	};
}
function buildMarkdownReport(seedAddress, network, flows, graphPath, schemaPath) {
	return [
		`# Trace Funds: ${seedAddress}`,
		"",
		`Network: \`${network}\``,
		`Schema: \`${schemaPath}\``,
		`Graph: \`${graphPath}\``,
		"",
		"## Flow Table",
		"",
		"| Hop | Source | Destination | amount_sum | amount_usd_sum | tx_count | first_tx_id | terminal_exchange |",
		"|---:|---|---|---:|---:|---:|---|---|",
		...flows.map((flow) => [
			`| ${flow.hop}`,
			`\`${flow.src}\``,
			`\`${flow.dst}\``,
			flow.amount_sum,
			flow.amount_usd_sum ?? "",
			flow.tx_count ?? "",
			flow.first_tx_id ? `\`${flow.first_tx_id}\`` : "",
			flow.terminal_exchange ? "yes" : "no"
		].join(" | ") + " |"),
		"",
		"## Mermaid",
		"",
		"```mermaid",
		"flowchart LR",
		...flows.map((flow, index) => `  n${index}["${flow.src.slice(0, 8)}..."] -->|"amount_sum ${flow.amount_sum}${flow.terminal_exchange ? "; exchange endpoint" : ""}"| m${index}["${flow.dst.slice(0, 8)}..."]`),
		"```"
	].join("\n") + "\n";
}
function compactEvidence(seedAddress, network, flows, schemaPath) {
	return {
		schema: "chain-insights.compact_evidence.v1",
		source: "trace_funds",
		network,
		seed_address: seedAddress,
		schema_ref: schemaPath,
		outgoing_flows: flows.map((flow) => ({
			hop: flow.hop,
			src: flow.src,
			dst: flow.dst,
			amount_sum: flow.amount_sum,
			amount_usd_sum: flow.amount_usd_sum,
			tx_count: flow.tx_count,
			first_tx_id: flow.first_tx_id,
			last_tx_id: flow.last_tx_id,
			src_labels: flow.src_labels,
			dst_labels: flow.dst_labels,
			dst_degree_in: flow.dst_degree_in,
			dst_degree_out: flow.dst_degree_out,
			terminal_exchange: flow.terminal_exchange
		}))
	};
}
function tableCsv(flows) {
	const rows = ["hop,src,dst,amount_sum,amount_usd_sum,tx_count,first_tx_id,last_tx_id,terminal_exchange"];
	for (const flow of flows) rows.push([
		flow.hop,
		flow.src,
		flow.dst,
		flow.amount_sum,
		flow.amount_usd_sum ?? "",
		flow.tx_count ?? "",
		flow.first_tx_id ?? "",
		flow.last_tx_id ?? "",
		flow.terminal_exchange ? "true" : "false"
	].map((value) => JSON.stringify(String(value))).join(","));
	return rows.join("\n") + "\n";
}
function summarize(seedAddress, network, flows, files, continuation) {
	const totalAmount = flows.reduce((sum, flow) => sum + flow.amount_sum, 0);
	const byHop = /* @__PURE__ */ new Map();
	for (const flow of flows) byHop.set(flow.hop, (byHop.get(flow.hop) ?? 0) + 1);
	const depositCount = continuation.depositAddresses.length;
	const exchangeCount = continuation.exchangeAddresses.length;
	return [
		`Trace complete for ${network}:${seedAddress}`,
		"",
		`Facts: ${flows.length} FLOWS_TO edge(s), sum of traced edge amount_sum values ${Number(totalAmount.toFixed(8))}.`,
		`By hop: ${[...byHop.entries()].map(([hop, count]) => `hop ${hop}: ${count}`).join(", ") || "none"}.`,
		`Exchange endpoints reached: ${exchangeCount}. Deposit candidate address(es): ${depositCount}.`,
		"",
		"Files written:",
		`- schema: ${files.schema}`,
		`- compact evidence JSON: ${files.compactEvidence}`,
		`- graph JSON: ${files.graph}`,
		`- table CSV: ${files.table}`,
		`- report: ${files.report}`,
		"",
		`Continuation hint: ${continuation.hint}`,
		continuation.depositAddresses.length > 0 ? `Deposit candidates: ${continuation.depositAddresses.join(", ")}` : "Deposit candidates: none reached in this bounded trace.",
		continuation.nextHopAddresses.length > 0 ? `Next addresses: ${continuation.nextHopAddresses.join(", ")}` : "Next addresses: none found in this trace."
	].join("\n");
}
async function traceFunds(remoteClient, config, options) {
	const seedAddress = options.seedAddress.trim();
	const network = options.network.trim();
	if (!seedAddress) throw new Error("seed_address is required");
	if (!network) throw new Error("network is required");
	const maxHops = clampInt(options.maxHops, 3, 1, 5);
	const perAddressLimit = clampInt(options.perAddressLimit, 5, 1, 10);
	const minAmountSum = Math.max(0, options.minAmountSum ?? 0);
	const root = outputRoot(config);
	await ensureDirs(root);
	const schemaResult = await loadOrCaptureSchema(remoteClient, root, network);
	const flows = await collectFlows(remoteClient, {
		seedAddress,
		network,
		maxHops,
		perAddressLimit,
		minAmountSum
	});
	const slug = `${(/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}_${sanitizeSegment(seedAddress.slice(0, 16))}`;
	const compact = compactEvidence(seedAddress, network, flows, schemaResult.filePath);
	const graph = buildGraph(seedAddress, network, flows);
	const compactPath = node_path.default.join(root, "reports", "tables", `${slug}.compact-evidence.json`);
	const graphPath = node_path.default.join(root, "reports", "graphs", `${slug}.graph.json`);
	const tablePath = node_path.default.join(root, "reports", "tables", `${slug}.flows.csv`);
	const reportPath = node_path.default.join(root, "reports", `${slug}.trace-report.md`);
	await (0, node_fs_promises.writeFile)(compactPath, JSON.stringify(compact, null, 2) + "\n", { mode: 384 });
	await (0, node_fs_promises.writeFile)(graphPath, JSON.stringify(graph, null, 2) + "\n", { mode: 384 });
	await (0, node_fs_promises.writeFile)(tablePath, tableCsv(flows), { mode: 384 });
	await (0, node_fs_promises.writeFile)(reportPath, buildMarkdownReport(seedAddress, network, flows, graphPath, schemaResult.filePath), { mode: 384 });
	if (options.caseId) {
		const { EvidenceStore } = await Promise.resolve().then(() => require("./cases-C9JmWEjR.cjs"));
		await EvidenceStore.append(options.caseId, {
			source: "trace_funds",
			queryParams: `network=${network} seed_address=${seedAddress} max_hops=${maxHops} per_address_limit=${perAddressLimit} min_amount_sum=${minAmountSum}`,
			content: JSON.stringify(compact, null, 2)
		});
	}
	const exchangeFlows = flows.filter(isExchangeFlow);
	const depositAddresses = [...new Set(exchangeFlows.map((flow) => flow.src))];
	const exchangeAddresses = [...new Set(exchangeFlows.map((flow) => flow.dst))];
	const outgoingSources = new Set(flows.map((flow) => flow.src));
	const leaves = [...new Set(flows.filter((flow) => !isExchangeFlow(flow)).map((flow) => flow.dst).filter((address) => !outgoingSources.has(address)))];
	const continuation = {
		nextHopAddresses: leaves.slice(0, 20),
		depositAddresses,
		exchangeAddresses,
		hint: depositAddresses.length > 0 ? `Found ${depositAddresses.length} deposit candidate(s), defined as the address one hop before an Exchange-labeled node. Do not continue through exchange nodes.` : leaves.length > 0 ? `No exchange endpoint reached yet. Continue from ${leaves.length} non-exchange leaf destination(s) with the same tool, or raise max_hops if the current trace stopped early.` : "No exchange endpoint or non-exchange leaf destinations found; inspect graph/report files or lower min_amount_sum."
	};
	const files = {
		schema: schemaResult.filePath,
		compactEvidence: compactPath,
		graph: graphPath,
		table: tablePath,
		report: reportPath
	};
	return {
		summaryText: summarize(seedAddress, network, flows, files, continuation),
		compactEvidence: compact,
		graphData: graph,
		files,
		continuation
	};
}
//#endregion
exports.traceFunds = traceFunds;
