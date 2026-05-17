const require_chunk = require("./chunk-CZWwpsFl.cjs");
const require_output_root = require("./output-root-BtL2lJgv.cjs");
const require_graph_normalizer = require("./graph-normalizer-CmuMr1s3.cjs");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_fs_promises = require("node:fs/promises");
//#region src/investigation/trace-funds.ts
var AliasTracker = class {
	byAddress = /* @__PURE__ */ new Map();
	byAlias = /* @__PURE__ */ new Map();
	counters = /* @__PURE__ */ new Map();
	assign(address, prefix) {
		const existing = this.byAddress.get(address);
		if (existing) return existing;
		const next = (this.counters.get(prefix) ?? 0) + 1;
		this.counters.set(prefix, next);
		const alias = `${prefix}${next}`;
		this.byAddress.set(address, alias);
		this.byAlias.set(alias, address);
		return alias;
	}
	alias(address) {
		return this.byAddress.get(address);
	}
	addressMap() {
		return Object.fromEntries([...this.byAlias.entries()].sort(([a], [b]) => a.localeCompare(b, void 0, { numeric: true })));
	}
	compactAddressMap(maxIntermediaries = 20, maxSourceExchanges = 20, maxLeads = 20) {
		const counts = /* @__PURE__ */ new Map();
		const entries = [...this.byAlias.entries()].filter(([alias]) => {
			const prefix = alias.slice(0, 1);
			if ([
				"V",
				"D",
				"E"
			].includes(prefix)) return true;
			const next = (counts.get(prefix) ?? 0) + 1;
			counts.set(prefix, next);
			if (prefix === "I") return next <= maxIntermediaries;
			if (prefix === "X") return next <= maxSourceExchanges;
			if (prefix === "L") return next <= maxLeads;
			return true;
		});
		return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b, void 0, { numeric: true })));
	}
};
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
function escapeCypherString$1(value) {
	return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}
function sanitizeSegment(value) {
	return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80) || "trace";
}
async function ensureDirs(paths) {
	await (0, node_fs_promises.mkdir)(paths.schemaDir, {
		recursive: true,
		mode: 448
	});
	await (0, node_fs_promises.mkdir)(paths.reportsRoot, {
		recursive: true,
		mode: 448
	});
	await (0, node_fs_promises.mkdir)(paths.reportGraphsRoot, {
		recursive: true,
		mode: 448
	});
	await (0, node_fs_promises.mkdir)(paths.reportTablesRoot, {
		recursive: true,
		mode: 448
	});
	await (0, node_fs_promises.mkdir)(paths.artifactsRoot, {
		recursive: true,
		mode: 448
	});
	await (0, node_fs_promises.mkdir)(paths.logsRoot, {
		recursive: true,
		mode: 448
	});
}
function textFromToolResult$1(result) {
	return (result.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join("\n");
}
function parseBatchResult$1(result) {
	const text = textFromToolResult$1(result).trim();
	if (!text) throw new Error("graph_query_batch returned no text content");
	const parsed = JSON.parse(text);
	if (!parsed.facts?.queries) throw new Error("graph_query_batch response did not include facts.queries");
	return parsed;
}
async function callGraphBatch$1(remoteClient, network, queries) {
	const result = await remoteClient.callTool({
		name: "graph_query_batch",
		arguments: {
			network,
			queries,
			per_query_timeout_seconds: 10
		}
	});
	if (result.isError) throw new Error(textFromToolResult$1(result) || "graph_query_batch failed");
	return parseBatchResult$1(result);
}
function resultsFor$1(batch, id) {
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
		node_labels: resultsFor$1(batch, "node_labels"),
		relationship_types: resultsFor$1(batch, "relationship_types"),
		address_property_keys: resultsFor$1(batch, "address_property_keys").map((row) => row["property_key"]),
		flows_to_property_keys: resultsFor$1(batch, "flows_to_property_keys").map((row) => row["property_key"]),
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
async function loadOrCaptureSchema(remoteClient, paths, network) {
	const filePath = node_path.default.join(paths.schemaDir, `${sanitizeSegment(network)}.graph-schema.json`);
	try {
		return {
			schema: JSON.parse(await (0, node_fs_promises.readFile)(filePath, "utf8")),
			filePath
		};
	} catch (err) {
		if (err.code !== "ENOENT") throw err;
	}
	const schema = schemaFromBatch(network, await callGraphBatch$1(remoteClient, network, SCHEMA_QUERY_SET));
	await (0, node_fs_promises.writeFile)(filePath, JSON.stringify(schema, null, 2) + "\n", { mode: 384 });
	return {
		schema,
		filePath
	};
}
function forwardExchangeQuery(address, limit, minAmountSum, maxHops) {
	const amountFilter = minAmountSum > 0 ? ` AND e.amount_sum >= ${minAmountSum}` : "";
	return {
		id: "forward_exchange_paths",
		query: [
			`MATCH p = (s:Address {address: "${escapeCypherString$1(address)}"})-[:FLOWS_TO *BFS (e, v | e.amount_sum IS NOT NULL${amountFilter})]->(t:Exchange)`,
			`WHERE s <> t AND size(nodes(p)) - 1 <= ${maxHops} AND NOT any(n IN nodes(p)[1..-1] WHERE "Exchange" IN labels(n))`,
			"WITH p, t, [n IN nodes(p) | n.address] AS addresses, [n IN nodes(p) | labels(n)] AS node_labels, [r IN relationships(p) | {amount_sum: r.amount_sum, amount_usd_sum: r.amount_usd_sum, tx_count: r.tx_count, first_tx_id: r.first_tx_id, last_tx_id: r.last_tx_id}] AS edge_props",
			"RETURN addresses, node_labels, edge_props, t.address AS exchange_address, labels(t) AS exchange_labels, size(nodes(p)) - 1 AS hops",
			"ORDER BY hops ASC",
			`LIMIT ${limit}`
		].join(" ")
	};
}
function backwardSourceQuery(id, depositAddress) {
	return {
		id,
		query: [
			`MATCH (dep:Address {address: "${escapeCypherString$1(depositAddress)}"})`,
			"MATCH path=(dep)<-[:FLOWS_TO *BFS (e, v | true)]-(source:Exchange)",
			"WHERE source <> dep AND NOT any(n IN nodes(path)[1..-1] WHERE \"Exchange\" IN labels(n))",
			"RETURN dep.address AS deposit_address, source.address AS source_exchange, labels(source) AS source_labels, size(nodes(path)) - 1 AS hops, [n IN nodes(path) | n.address] AS addresses, [n IN nodes(path) | labels(n)] AS node_labels",
			"LIMIT 20"
		].join(" ")
	};
}
function reverseLeadsQuery(depositAddresses) {
	return {
		id: "reverse_1hop",
		query: [
			`UNWIND [${depositAddresses.map((address) => `"${escapeCypherString$1(address)}"`).join(", ")}] AS dep_addr`,
			"MATCH (sender:Address)-[r:FLOWS_TO]->(deposit:Address {address: dep_addr})",
			"WHERE NOT (\"Exchange\" IN labels(sender)) AND sender.address <> dep_addr",
			"RETURN DISTINCT sender.address AS address, labels(sender) AS labels, coalesce(sender.degree_in, 0) AS degree_in, coalesce(sender.degree_out, 0) AS degree_out, coalesce(sender.total_volume_usd, 0) AS total_volume_usd, dep_addr AS deposit_address, r.amount_usd_sum AS amount_usd",
			"ORDER BY r.amount_usd_sum DESC",
			`LIMIT ${Math.max(50, depositAddresses.length * 50)}`
		].join(" ")
	};
}
function edgeKey(src, dst) {
	return `${src}\u0000${dst}`;
}
function directEdgePropsQuery(flows) {
	const pairs = [...new Map(flows.map((flow) => [edgeKey(flow.src, flow.dst), {
		src: flow.src,
		dst: flow.dst
	}])).values()];
	if (pairs.length === 0) return null;
	return {
		id: "direct_edge_props",
		query: [
			"MATCH (a:Address)-[r:FLOWS_TO]->(b:Address)",
			`WHERE ${pairs.map((pair) => `(a.address = "${escapeCypherString$1(pair.src)}" AND b.address = "${escapeCypherString$1(pair.dst)}")`).join(" OR ")}`,
			"RETURN a.address AS src, b.address AS dst, r.amount_sum AS amount_sum, r.amount_usd_sum AS amount_usd_sum, r.tx_count AS tx_count, r.first_tx_id AS first_tx_id, r.last_tx_id AS last_tx_id",
			`LIMIT ${pairs.length}`
		].join(" ")
	};
}
function numberValue(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function stringArrayValue(value) {
	return Array.isArray(value) ? value.map(String) : void 0;
}
function uniqueStrings(values) {
	return [...new Set(values ?? [])];
}
function isExchangeFlow(flow) {
	return flow.terminal_exchange || flow.dst_labels?.includes("Exchange") === true;
}
function depositFromRow(row) {
	const pathAddresses = stringArrayValue(row["addresses"]) ?? [];
	if (pathAddresses.length < 2) return null;
	const exchangeAddress = typeof row["exchange_address"] === "string" ? row["exchange_address"] : pathAddresses[pathAddresses.length - 1];
	const edgeProps = Array.isArray(row["edge_props"]) ? row["edge_props"] : [];
	const terminalEdge = edgeProps[edgeProps.length - 1] ?? {};
	return {
		address: pathAddresses[pathAddresses.length - 2],
		exchangeAddress,
		exchangeLabels: stringArrayValue(row["exchange_labels"]),
		amount_sum: numberValue(terminalEdge["amount_sum"]),
		amount_usd_sum: numberValue(terminalEdge["amount_usd_sum"]),
		hops: numberValue(row["hops"]) ?? pathAddresses.length - 1,
		path: pathAddresses
	};
}
function flowsFromForwardRows(rows) {
	const flows = [];
	const deposits = [];
	const seenEdges = /* @__PURE__ */ new Set();
	for (const row of rows) {
		const pathAddresses = stringArrayValue(row["addresses"]) ?? [];
		const nodeLabels = Array.isArray(row["node_labels"]) ? row["node_labels"].map((labels) => stringArrayValue(labels) ?? []) : [];
		const edgeProps = Array.isArray(row["edge_props"]) ? row["edge_props"] : [];
		const deposit = depositFromRow(row);
		if (deposit) deposits.push(deposit);
		for (let index = 0; index < pathAddresses.length - 1; index += 1) {
			const src = pathAddresses[index];
			const dst = pathAddresses[index + 1];
			const edge = edgeProps[index] ?? {};
			const amount = numberValue(edge["amount_sum"]) ?? numberValue(edge["amount_usd_sum"]) ?? 0;
			const terminal = index === pathAddresses.length - 2;
			const key = `${src}->${dst}`;
			if (seenEdges.has(key)) continue;
			seenEdges.add(key);
			flows.push({
				hop: index + 1,
				src,
				dst,
				amount_sum: amount,
				amount_usd_sum: numberValue(edge["amount_usd_sum"]),
				tx_count: numberValue(edge["tx_count"]),
				first_tx_id: typeof edge["first_tx_id"] === "string" ? edge["first_tx_id"] : void 0,
				last_tx_id: typeof edge["last_tx_id"] === "string" ? edge["last_tx_id"] : void 0,
				src_labels: nodeLabels[index],
				dst_labels: nodeLabels[index + 1],
				terminal_exchange: terminal
			});
		}
	}
	return {
		flows,
		deposits
	};
}
async function hydrateDirectEdgeProps(remoteClient, network, flows, deposits) {
	const query = directEdgePropsQuery(flows);
	if (!query) return;
	const batch = await callGraphBatch$1(remoteClient, network, [query]);
	const edgeProps = /* @__PURE__ */ new Map();
	for (const row of resultsFor$1(batch, "direct_edge_props")) {
		const src = typeof row["src"] === "string" ? row["src"] : "";
		const dst = typeof row["dst"] === "string" ? row["dst"] : "";
		if (!src || !dst) continue;
		edgeProps.set(edgeKey(src, dst), row);
	}
	for (const flow of flows) {
		const props = edgeProps.get(edgeKey(flow.src, flow.dst));
		if (!props) continue;
		flow.amount_sum = numberValue(props["amount_sum"]) ?? flow.amount_sum;
		flow.amount_usd_sum = numberValue(props["amount_usd_sum"]);
		flow.tx_count = numberValue(props["tx_count"]);
		flow.first_tx_id = typeof props["first_tx_id"] === "string" ? props["first_tx_id"] : void 0;
		flow.last_tx_id = typeof props["last_tx_id"] === "string" ? props["last_tx_id"] : void 0;
	}
	for (const deposit of deposits) {
		const props = edgeProps.get(edgeKey(deposit.address, deposit.exchangeAddress));
		if (!props) continue;
		deposit.amount_sum = numberValue(props["amount_sum"]);
		deposit.amount_usd_sum = numberValue(props["amount_usd_sum"]);
	}
}
async function collectProbeTrace(remoteClient, options) {
	const { flows, deposits } = flowsFromForwardRows(resultsFor$1(await callGraphBatch$1(remoteClient, options.network, [forwardExchangeQuery(options.seedAddress, Math.max(options.perAddressLimit * 20, 200), options.minAmountSum, options.maxHops)]), "forward_exchange_paths"));
	await hydrateDirectEdgeProps(remoteClient, options.network, flows, deposits);
	const uniqueDepositAddresses = [...new Set(deposits.map((deposit) => deposit.address))];
	const sourceMatches = [];
	if (uniqueDepositAddresses.length > 0) {
		const backwardBatch = await callGraphBatch$1(remoteClient, options.network, uniqueDepositAddresses.slice(0, 20).map((address, index) => backwardSourceQuery(`backward_from_deposit_${index + 1}`, address)));
		for (const query of backwardBatch.facts?.queries ?? []) for (const row of query.results ?? []) {
			const pathAddresses = stringArrayValue(row["addresses"]) ?? [];
			const depositAddress = typeof row["deposit_address"] === "string" ? row["deposit_address"] : pathAddresses[0];
			const sourceExchange = typeof row["source_exchange"] === "string" ? row["source_exchange"] : pathAddresses[pathAddresses.length - 1];
			if (!depositAddress || !sourceExchange) continue;
			sourceMatches.push({
				deposit_address: depositAddress,
				source_exchange: sourceExchange,
				source_labels: stringArrayValue(row["source_labels"]),
				hops: numberValue(row["hops"]) ?? Math.max(pathAddresses.length - 1, 0),
				path: pathAddresses
			});
		}
	}
	const reverseLeads = [];
	if (uniqueDepositAddresses.length > 0) {
		const reverseBatch = await callGraphBatch$1(remoteClient, options.network, [reverseLeadsQuery(uniqueDepositAddresses)]);
		for (const row of resultsFor$1(reverseBatch, "reverse_1hop")) {
			const address = typeof row["address"] === "string" ? row["address"] : "";
			const depositAddress = typeof row["deposit_address"] === "string" ? row["deposit_address"] : "";
			if (!address || !depositAddress) continue;
			const labels = stringArrayValue(row["labels"]) ?? [];
			const degreeIn = numberValue(row["degree_in"]) ?? 0;
			const totalVolume = numberValue(row["total_volume_usd"]) ?? 0;
			const reason = labels.length > 0 ? "labeled_entity" : degreeIn > 50 ? "fan_in_hub" : totalVolume > 1e5 ? "high_volume_sender" : "";
			if (!reason) continue;
			reverseLeads.push({
				address,
				labels,
				degree_in: degreeIn,
				degree_out: numberValue(row["degree_out"]),
				total_volume_usd: totalVolume,
				deposit_address: depositAddress,
				amount_usd: numberValue(row["amount_usd"]),
				reason
			});
		}
	}
	return {
		flows,
		deposits,
		sourceMatches,
		reverseLeads
	};
}
function buildAliases(seedAddress, deposits, sourceMatches, reverseLeads) {
	const aliases = new AliasTracker();
	aliases.assign(seedAddress, "V");
	for (const deposit of deposits) {
		for (const address of deposit.path.slice(1, -2)) aliases.assign(address, "I");
		aliases.assign(deposit.address, "D");
		aliases.assign(deposit.exchangeAddress, "E");
	}
	for (const source of sourceMatches) {
		aliases.assign(source.source_exchange, "X");
		for (const address of source.path.slice(1, -1)) aliases.assign(address, "I");
	}
	for (const lead of reverseLeads) aliases.assign(lead.address, "L");
	return aliases;
}
function buildGraph(seedAddress, network, flows, deposits, sourceMatches, reverseLeads) {
	const totals = /* @__PURE__ */ new Map();
	const ensure = (address) => {
		if (!totals.has(address)) totals.set(address, {
			in: 0,
			out: 0,
			rawLabels: [],
			role: address === seedAddress ? "seed" : null
		});
		return totals.get(address);
	};
	const mergeLabels = (address, labels) => {
		const node = ensure(address);
		node.rawLabels = uniqueStrings([...node.rawLabels, ...labels ?? []]);
		return node;
	};
	for (const flow of flows) {
		const src = mergeLabels(flow.src, flow.src_labels);
		src.out += flow.amount_usd_sum ?? flow.amount_sum;
		const dst = mergeLabels(flow.dst, flow.dst_labels);
		dst.in += flow.amount_usd_sum ?? flow.amount_sum;
		if (isExchangeFlow(flow)) dst.role = "exchange";
	}
	for (const deposit of deposits) {
		const node = ensure(deposit.address);
		node.role = "deposit_candidate";
		mergeLabels(deposit.exchangeAddress, deposit.exchangeLabels);
	}
	for (const source of sourceMatches) {
		const node = mergeLabels(source.source_exchange, source.source_labels);
		node.role = "exchange";
	}
	for (const lead of reverseLeads) {
		const node = mergeLabels(lead.address, lead.labels);
		node.role = "lead";
		const deposit = ensure(lead.deposit_address);
		deposit.in += lead.amount_usd ?? 0;
	}
	return require_graph_normalizer.normalizeGraphPayload({
		schema: "chain-insights.graph.v1",
		nodes: [...totals.entries()].map(([address, data]) => {
			const rawLabels = uniqueStrings(data.rawLabels);
			return {
				address,
				role: data.role,
				labels: rawLabels,
				flow_in_usd: data.in,
				flow_out_usd: data.out
			};
		}),
		edges: [
			...flows.map((flow) => ({
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
			...sourceMatches.map((source) => ({
				from_address: source.source_exchange,
				to_address: source.deposit_address,
				usd_amount: 0,
				amount_sum: 0,
				tx_count: 0,
				type: "FLOWS_TO",
				direction: "traceback"
			})),
			...reverseLeads.map((lead) => ({
				from_address: lead.address,
				to_address: lead.deposit_address,
				usd_amount: lead.amount_usd ?? 0,
				amount_sum: lead.amount_usd ?? 0,
				tx_count: 0,
				type: "FLOWS_TO",
				direction: "reverse_1hop_lead"
			}))
		],
		flows,
		deposits,
		source_matches: sourceMatches,
		reverse_leads: reverseLeads,
		edge_anchors: [],
		metadata: {
			seed_address: seedAddress,
			network,
			generated_at: (/* @__PURE__ */ new Date()).toISOString()
		}
	});
}
function buildMarkdownReport(seedAddress, network, flows, deposits, sourceMatches, reverseLeads, aliases, graphPath, schemaPath) {
	return [
		`# Trace Funds: ${seedAddress}`,
		"",
		`Network: \`${network}\``,
		`Schema: \`${schemaPath}\``,
		`Graph: \`${graphPath}\``,
		"",
		"## Probe Summary",
		"",
		`- Exchange endpoint(s): ${[...new Set(deposits.map((deposit) => aliases.alias(deposit.exchangeAddress) ?? deposit.exchangeAddress))].join(", ") || "none"}`,
		`- Deposit candidate(s): ${[...new Set(deposits.map((deposit) => aliases.alias(deposit.address) ?? deposit.address))].join(", ") || "none"}`,
		`- Traceback source exchange path(s): ${sourceMatches.length}`,
		`- Reverse 1-hop lead(s): ${reverseLeads.length}`,
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
function probeEvidence(seedAddress, network, schemaPath, aliases, flows, deposits, sourceMatches, reverseLeads) {
	return {
		schema: "chain-insights.probe_evidence.v1",
		source: "track_funds",
		network,
		seed_address: seedAddress,
		schema_ref: schemaPath,
		address_map: aliases.addressMap(),
		fund_flows: [...deposits.map((deposit, index) => ({
			id: `F${index + 1}`,
			type: "deposit",
			path: deposit.path.map((address) => aliases.alias(address) ?? address),
			deposit: aliases.alias(deposit.address),
			exchange: aliases.alias(deposit.exchangeAddress),
			amount_sum: deposit.amount_sum,
			amount_usd_sum: deposit.amount_usd_sum,
			hops: deposit.hops
		})), ...sourceMatches.map((source, index) => ({
			id: `S${index + 1}`,
			type: "source",
			path: [...source.path].reverse().map((address) => aliases.alias(address) ?? address),
			source_exchange: aliases.alias(source.source_exchange),
			deposit: aliases.alias(source.deposit_address),
			hops: source.hops
		}))],
		reverse_leads: reverseLeads.map((lead) => ({
			alias: aliases.alias(lead.address),
			address: lead.address,
			reason: lead.reason,
			labels: lead.labels,
			deposit: aliases.alias(lead.deposit_address),
			amount_usd: lead.amount_usd
		})),
		outgoing_flows: flows.map((flow) => ({
			hop: flow.hop,
			src: aliases.alias(flow.src) ?? flow.src,
			dst: aliases.alias(flow.dst) ?? flow.dst,
			amount_sum: flow.amount_sum,
			amount_usd_sum: flow.amount_usd_sum,
			tx_count: flow.tx_count,
			first_tx_id: flow.first_tx_id,
			last_tx_id: flow.last_tx_id,
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
function htmlEscape(value) {
	return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#39;");
}
function buildTableHtml(seedAddress, network, flows, deposits, sourceMatches, reverseLeads) {
	const headers = [
		"hop",
		"src",
		"dst",
		"amount_sum",
		"amount_usd_sum",
		"tx_count",
		"first_tx_id",
		"last_tx_id",
		"terminal_exchange_display"
	];
	const headerLabels = {
		hop: "Hop",
		src: "Source",
		dst: "Destination",
		amount_sum: "amount_sum",
		amount_usd_sum: "amount_usd_sum",
		tx_count: "tx_count",
		first_tx_id: "first_tx_id",
		last_tx_id: "last_tx_id",
		terminal_exchange_display: "terminal_exchange"
	};
	const rows = flows.map((flow) => {
		const values = {
			...flow,
			terminal_exchange_display: flow.terminal_exchange ? "yes" : "no"
		};
		return `<tr>${headers.map((header) => `<td>${htmlEscape(values[header])}</td>`).join("")}</tr>`;
	}).join("\n");
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trace Funds Table - ${htmlEscape(seedAddress)}</title>
<style>
  :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0b0d12; color: #f4f2ea; }
  body { margin: 0; background: #0b0d12; color: #f4f2ea; }
  main { padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 8px; font-weight: 650; }
  .meta { display: grid; gap: 6px; margin: 0 0 20px; color: rgba(244,242,234,.72); font-size: 13px; }
  .summary { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 20px; }
  .pill { border: 1px solid rgba(242,221,166,.25); background: rgba(242,221,166,.08); border-radius: 999px; padding: 6px 10px; font-size: 12px; color: #f2dda6; }
  .table-wrap { overflow: auto; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; background: #10131b; }
  table { border-collapse: collapse; width: 100%; min-width: 1180px; font-size: 12px; }
  th, td { border-bottom: 1px solid rgba(255,255,255,.08); padding: 8px 10px; text-align: left; vertical-align: top; }
  th { position: sticky; top: 0; background: #161a24; color: #f2dda6; font-weight: 600; z-index: 1; }
  td { color: rgba(244,242,234,.86); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  tr:hover td { background: rgba(242,221,166,.045); }
</style>
</head>
<body>
<main>
  <h1>Trace Funds Table</h1>
  <div class="meta">
    <div>Network: <strong>${htmlEscape(network)}</strong></div>
    <div>Seed: <strong>${htmlEscape(seedAddress)}</strong></div>
    <div>Generated: <strong>${htmlEscape((/* @__PURE__ */ new Date()).toISOString())}</strong></div>
  </div>
  <div class="summary">
    <span class="pill">${flows.length} FLOWS_TO edges</span>
    <span class="pill">${deposits.length} deposit candidates</span>
    <span class="pill">${sourceMatches.length} traceback source paths</span>
    <span class="pill">${reverseLeads.length} reverse 1-hop leads</span>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr>${headers.map((header) => `<th>${htmlEscape(headerLabels[header])}</th>`).join("")}</tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>
</main>
</body>
</html>
`;
}
function summarize(seedAddress, network, flows, sourceMatches, reverseLeads, aliases, files, continuation) {
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
		`Traceback source path(s): ${sourceMatches.length}. Reverse 1-hop lead(s): ${reverseLeads.length}.`,
		"",
		"Files written:",
		`- schema: ${files.schema}`,
		`- compact evidence JSON: ${files.compactEvidence}`,
		`- graph JSON: ${files.graph}`,
		`- graph HTML: ${files.graphHtml}`,
		`- table CSV: ${files.table}`,
		`- table HTML: ${files.tableHtml}`,
		`- report: ${files.report}`,
		"",
		`Continuation hint: ${continuation.hint}`,
		continuation.depositAddresses.length > 0 ? `Deposit candidates: ${continuation.depositAddresses.map((address) => aliases.alias(address) ?? address).join(", ")}` : "Deposit candidates: none reached in this bounded trace.",
		continuation.nextHopAddresses.length > 0 ? `Next addresses: ${continuation.nextHopAddresses.join(", ")}` : "Next addresses: none found in this trace."
	].join("\n");
}
async function runFundFlowProbe(remoteClient, _config, options) {
	const seedAddress = options.seedAddress.trim();
	const network = options.network.trim();
	if (!seedAddress) throw new Error("seed_address is required");
	if (!network) throw new Error("network is required");
	const maxHops = clampInt(options.maxHops, 3, 1, 5);
	const perAddressLimit = clampInt(options.perAddressLimit, 5, 1, 10);
	const minAmountSum = Math.max(0, options.minAmountSum ?? 0);
	const paths = require_output_root.workspaceOutputPaths();
	await ensureDirs(paths);
	const schemaResult = await loadOrCaptureSchema(remoteClient, paths, network);
	const { flows, deposits, sourceMatches, reverseLeads } = await collectProbeTrace(remoteClient, {
		seedAddress,
		network,
		maxHops,
		perAddressLimit,
		minAmountSum
	});
	const aliases = buildAliases(seedAddress, deposits, sourceMatches, reverseLeads);
	const slug = `${(/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}_${sanitizeSegment(seedAddress.slice(0, 16))}`;
	const compact = probeEvidence(seedAddress, network, schemaResult.filePath, aliases, flows, deposits, sourceMatches, reverseLeads);
	const graph = buildGraph(seedAddress, network, flows, deposits, sourceMatches, reverseLeads);
	const compactPath = node_path.default.join(paths.reportTablesRoot, `${slug}.compact-evidence.json`);
	const graphPath = node_path.default.join(paths.reportGraphsRoot, `${slug}.graph.json`);
	const graphHtmlPath = node_path.default.join(paths.reportsRoot, `${slug}.graph.html`);
	const tablePath = node_path.default.join(paths.reportTablesRoot, `${slug}.flows.csv`);
	const tableHtmlPath = node_path.default.join(paths.reportsRoot, `${slug}.table.html`);
	const reportPath = node_path.default.join(paths.reportsRoot, `${slug}.trace-report.md`);
	const { generateInlineGraphHtml } = await Promise.resolve().then(() => require("./html-generator-DgzOxSFq.cjs")).then((n) => n.html_generator_exports);
	await (0, node_fs_promises.writeFile)(compactPath, JSON.stringify(compact, null, 2) + "\n", { mode: 384 });
	await (0, node_fs_promises.writeFile)(graphPath, JSON.stringify(graph, null, 2) + "\n", { mode: 384 });
	await (0, node_fs_promises.writeFile)(graphHtmlPath, generateInlineGraphHtml(graph), { mode: 384 });
	await (0, node_fs_promises.writeFile)(tablePath, tableCsv(flows), { mode: 384 });
	await (0, node_fs_promises.writeFile)(tableHtmlPath, buildTableHtml(seedAddress, network, flows, deposits, sourceMatches, reverseLeads), { mode: 384 });
	await (0, node_fs_promises.writeFile)(reportPath, buildMarkdownReport(seedAddress, network, flows, deposits, sourceMatches, reverseLeads, aliases, graphPath, schemaResult.filePath), { mode: 384 });
	if (options.caseId) {
		const { EvidenceStore } = await Promise.resolve().then(() => require("./cases-D8HCXUWD.cjs"));
		await EvidenceStore.append(options.caseId, {
			source: "track_funds",
			queryParams: `network=${network} seed_address=${seedAddress} max_hops=${maxHops} per_address_limit=${perAddressLimit} min_amount_sum=${minAmountSum}`,
			content: JSON.stringify({
				schema: "chain-insights.evidence_pointer.v1",
				source: "track_funds",
				network,
				seed_address: seedAddress,
				address_map: aliases.compactAddressMap(),
				files: {
					compactEvidence: compactPath,
					graph: graphPath,
					graphHtml: graphHtmlPath,
					table: tablePath,
					tableHtml: tableHtmlPath,
					report: reportPath
				},
				facts: {
					flow_count: flows.length,
					deposit_candidates: [...new Set(deposits.map((deposit) => aliases.alias(deposit.address) ?? deposit.address))],
					exchange_endpoints: [...new Set(deposits.map((deposit) => aliases.alias(deposit.exchangeAddress) ?? deposit.exchangeAddress))],
					traceback_source_paths: sourceMatches.length,
					reverse_leads: reverseLeads.length
				}
			}, null, 2)
		});
	}
	const depositAddresses = [...new Set(deposits.map((deposit) => deposit.address))];
	const exchangeAddresses = [...new Set(deposits.map((deposit) => deposit.exchangeAddress))];
	const leaves = [];
	const continuation = {
		nextHopAddresses: leaves.slice(0, 20),
		depositAddresses,
		exchangeAddresses,
		hint: depositAddresses.length > 0 ? `Found ${depositAddresses.length} deposit candidate(s), defined as the address one hop before an Exchange-labeled node. Do not continue through exchange nodes.` : leaves.length > 0 ? `No exchange endpoint reached yet. Continue from ${leaves.length} non-exchange leaf destination(s) with the same tool, or raise the result budget if the current trace stopped early.` : "No exchange endpoint or non-exchange leaf destinations found; inspect graph/report files or lower min_amount_sum."
	};
	const files = {
		schema: schemaResult.filePath,
		compactEvidence: compactPath,
		graph: graphPath,
		graphHtml: graphHtmlPath,
		table: tablePath,
		tableHtml: tableHtmlPath,
		report: reportPath
	};
	return {
		summaryText: summarize(seedAddress, network, flows, sourceMatches, reverseLeads, aliases, files, continuation),
		compactEvidence: compact,
		graphData: graph,
		files,
		continuation,
		addressMap: aliases.compactAddressMap()
	};
}
//#endregion
//#region src/investigation/public-tools.ts
function escapeCypherString(value) {
	return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
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
function resultsFor(batch, id) {
	const query = batch.facts?.queries?.find((entry) => entry.id === id);
	if (!query) return [];
	if (query.ok === false) throw new Error(query.error || `Query failed: ${id}`);
	return query.results ?? [];
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
function parseAddressList(value) {
	return (Array.isArray(value) ? value.join(",") : value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
}
function addressProfileQuery(address) {
	return {
		id: "address_profile",
		query: [
			`MATCH (a:Address {address: "${escapeCypherString(address)}"})`,
			"RETURN a.address AS address, labels(a) AS labels, a.confluence_score AS confluence_score, a.ml_risk_level AS ml_risk_level, a.degree_in AS degree_in, a.degree_out AS degree_out, a.total_volume_usd AS total_volume_usd",
			"LIMIT 1"
		].join(" ")
	};
}
function exchangeOutflowsQuery(address) {
	return {
		id: "exchange_outflows",
		query: [
			`MATCH p = (a:Address {address: "${escapeCypherString(address)}"})-[:FLOWS_TO *BFS (e, v | true)]->(exchange:Exchange)`,
			"WHERE a <> exchange AND NOT any(n IN nodes(p)[1..-1] WHERE \"Exchange\" IN labels(n))",
			"WITH p, exchange, [n IN nodes(p) | n.address] AS path, relationships(p) AS rels",
			"WITH p, exchange, path, rels, rels[size(rels)-1] AS terminal",
			"RETURN \"outflow\" AS direction, exchange.address AS exchange_address, labels(exchange) AS exchange_labels, path[size(path)-2] AS deposit_address, size(path)-1 AS hops, terminal.amount_sum AS amount_sum, terminal.amount_usd_sum AS amount_usd_sum, terminal.tx_count AS tx_count, path",
			"ORDER BY amount_usd_sum DESC, amount_sum DESC",
			"LIMIT 10"
		].join(" ")
	};
}
function exchangeInflowsQuery(address) {
	return {
		id: "exchange_inflows",
		query: [
			`MATCH p = (exchange:Exchange)-[:FLOWS_TO *BFS (e, v | true)]->(a:Address {address: "${escapeCypherString(address)}"})`,
			"WHERE a <> exchange AND NOT any(n IN nodes(p)[1..-1] WHERE \"Exchange\" IN labels(n))",
			"WITH p, exchange, [n IN nodes(p) | n.address] AS path, relationships(p) AS rels",
			"WITH p, exchange, path, rels, rels[size(rels)-1] AS terminal",
			"RETURN \"inflow\" AS direction, exchange.address AS exchange_address, labels(exchange) AS exchange_labels, path[1] AS withdrawal_address, size(path)-1 AS hops, terminal.amount_sum AS amount_sum, terminal.amount_usd_sum AS amount_usd_sum, terminal.tx_count AS tx_count, path",
			"ORDER BY amount_usd_sum DESC, amount_sum DESC",
			"LIMIT 10"
		].join(" ")
	};
}
function connectionProbeQuery(address, compareAddress) {
	return {
		id: "connection_probe",
		query: [
			`MATCH p = (a:Address {address: "${escapeCypherString(address)}"})-[:FLOWS_TO *BFS (e, v | true)]-(b:Address {address: "${escapeCypherString(compareAddress)}"})`,
			"RETURN [n IN nodes(p) | n.address] AS path, size(nodes(p))-1 AS hops",
			"ORDER BY hops ASC",
			"LIMIT 5"
		].join(" ")
	};
}
function formatExchangeRows(rows) {
	return rows.map((row) => {
		const direction = String(row["direction"] ?? "flow");
		const exchange = String(row["exchange_address"] ?? "");
		const amount = row["amount_sum"] ?? row["amount_usd_sum"] ?? "";
		return `- ${direction}: ${exchange} (${row["hops"] ?? ""} hop(s), amount ${amount})`;
	});
}
function buildRiskGraph(address, rows, network) {
	const nodes = /* @__PURE__ */ new Map();
	nodes.set(address, {
		address,
		role: "subject",
		labels: ["Address"],
		address_type: "wallet"
	});
	const edges = [];
	for (const row of rows) {
		const path = Array.isArray(row["path"]) ? row["path"].map(String) : [];
		for (const entry of path) if (!nodes.has(entry)) nodes.set(entry, {
			address: entry,
			role: null,
			labels: [],
			address_type: "wallet"
		});
		const exchange = typeof row["exchange_address"] === "string" ? row["exchange_address"] : "";
		if (exchange) nodes.set(exchange, {
			address: exchange,
			role: "exchange",
			labels: row["exchange_labels"] ?? ["Exchange"],
			address_type: "exchange"
		});
		for (let index = 0; index < path.length - 1; index += 1) edges.push({
			from_address: path[index],
			to_address: path[index + 1],
			usd_amount: row["amount_usd_sum"] ?? row["amount_sum"] ?? 0,
			amount_sum: row["amount_sum"] ?? 0,
			tx_count: row["tx_count"] ?? 0,
			type: "FLOWS_TO",
			direction: row["direction"]
		});
	}
	return require_graph_normalizer.normalizeGraphPayload({
		schema: "chain-insights.graph.v1",
		nodes: [...nodes.values()],
		edges,
		flows: [],
		edge_anchors: [],
		metadata: {
			address,
			network,
			generated_at: (/* @__PURE__ */ new Date()).toISOString()
		}
	});
}
async function addressRisk(remoteClient, options) {
	const address = options.address.trim();
	const network = options.network.trim();
	const compareAddress = options.compareAddress?.trim() ?? "";
	if (!address) throw new Error("address is required");
	if (!network) throw new Error("network is required");
	const batch = await callGraphBatch(remoteClient, network, [
		addressProfileQuery(address),
		exchangeOutflowsQuery(address),
		exchangeInflowsQuery(address),
		...compareAddress ? [connectionProbeQuery(address, compareAddress)] : [{
			id: "connection_probe",
			query: "RETURN [] AS path LIMIT 0"
		}]
	]);
	const profile = resultsFor(batch, "address_profile")[0] ?? { address };
	const outflows = resultsFor(batch, "exchange_outflows");
	const inflows = resultsFor(batch, "exchange_inflows");
	const connections = compareAddress ? resultsFor(batch, "connection_probe") : [];
	const exchangeRows = [...outflows, ...inflows];
	const graphData = buildRiskGraph(address, exchangeRows, network);
	const lines = [
		`Address risk for ${network}:${address}`,
		"",
		`Risk: ${profile["ml_risk_level"] ?? "unknown"}${profile["confluence_score"] !== void 0 ? ` (${profile["confluence_score"]})` : ""}`,
		`Graph degree: in ${profile["degree_in"] ?? "unknown"}, out ${profile["degree_out"] ?? "unknown"}.`,
		"",
		"Exchange behavior",
		exchangeRows.length > 0 ? formatExchangeRows(exchangeRows).join("\n") : "- No exchange inflow/outflow paths found in bounded search."
	];
	if (compareAddress) lines.push("", `Connection compare target: ${compareAddress}`, connections.length > 0 ? `Connection paths found: ${connections.length}` : "Connection paths found: 0");
	return {
		summaryText: lines.join("\n"),
		structuredContent: {
			schema: "chain-insights.result.v1",
			tool: "address_risk",
			facts: {
				subject: {
					network,
					addresses: compareAddress ? [address, compareAddress] : [address]
				},
				risk: {
					level: profile["ml_risk_level"] ?? null,
					score: profile["confluence_score"] ?? null
				},
				exchange_behavior: {
					outflows,
					inflows
				},
				connection: compareAddress ? {
					compare_address: compareAddress,
					paths: connections
				} : void 0
			}
		},
		graphData
	};
}
async function trackFunds(remoteClient, config, options) {
	const network = options.network.trim();
	const trusted = parseAddressList(options.trustedAddresses);
	const untrusted = parseAddressList(options.untrustedAddresses);
	if (!network) throw new Error("network is required");
	if (trusted.length < 1) throw new Error("trusted_addresses must contain at least 1 address");
	if (trusted.length > 5) throw new Error("trusted_addresses cannot exceed 5 addresses");
	if (untrusted.length > 5) throw new Error("untrusted_addresses cannot exceed 5 addresses");
	const overlap = trusted.filter((address) => untrusted.includes(address));
	if (overlap.length > 0) throw new Error(`Address(es) appear in both trusted and untrusted lists: ${overlap.join(", ")}`);
	const runs = [];
	for (const address of trusted) runs.push({
		role: "trusted",
		address,
		result: await runFundFlowProbe(remoteClient, config, {
			seedAddress: address,
			network,
			caseId: options.caseId,
			maxHops: options.maxHops,
			perAddressLimit: options.perAddressLimit,
			minAmountSum: options.minAmountSum
		})
	});
	for (const address of untrusted) runs.push({
		role: "untrusted",
		address,
		result: await runFundFlowProbe(remoteClient, config, {
			seedAddress: address,
			network,
			caseId: options.caseId,
			maxHops: options.maxHops,
			perAddressLimit: options.perAddressLimit,
			minAmountSum: options.minAmountSum
		})
	});
	const graphData = require_graph_normalizer.normalizeGraphPayload({
		schema: "chain-insights.graph.v1",
		nodes: runs.flatMap((run) => Array.isArray(run.result.graphData.nodes) ? run.result.graphData.nodes : []),
		edges: runs.flatMap((run) => Array.isArray(run.result.graphData.edges) ? run.result.graphData.edges : []),
		flows: runs.flatMap((run) => Array.isArray(run.result.graphData.flows) ? run.result.graphData.flows : []),
		edge_anchors: [],
		metadata: {
			network,
			trusted_addresses: trusted,
			untrusted_addresses: untrusted,
			generated_at: (/* @__PURE__ */ new Date()).toISOString()
		}
	});
	return {
		summaryText: [
			`Track funds complete for ${network}`,
			"",
			`Trusted addresses: ${trusted.join(", ")}`,
			`Untrusted addresses: ${untrusted.join(", ") || "none"}`,
			"",
			...runs.map((run) => `## ${run.role}: ${run.address}\n${run.result.summaryText}`)
		].join("\n"),
		structuredContent: {
			schema: "chain-insights.result.v1",
			tool: "track_funds",
			facts: {
				network,
				trusted_addresses: trusted,
				untrusted_addresses: untrusted,
				runs: runs.map((run) => ({
					role: run.role,
					address: run.address,
					files: run.result.files,
					continuation: run.result.continuation,
					address_map: run.result.addressMap
				}))
			}
		},
		graphData
	};
}
//#endregion
exports.addressRisk = addressRisk;
exports.trackFunds = trackFunds;
