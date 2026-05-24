const require_chunk = require("./chunk-CZWwpsFl.cjs");
const require_output_root = require("./output-root-CFYms3ad.cjs");
const require_graph_normalizer = require("./graph-normalizer-DeIj6Ses.cjs");
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
const GRAPH_QUERY_BATCH_TIMEOUT_SECONDS$1 = 120;
const GRAPH_QUERY_BATCH_REQUEST_TIMEOUT_MS$1 = 300 * 1e3;
const SCHEMA_QUERY_SET = [
	{
		id: "node_labels",
		query: "MATCH (n:Address) RETURN \"Address\" AS node_label, count(n) AS sample_count LIMIT 1"
	},
	{
		id: "relationship_types",
		query: "MATCH (:Address)-[r:FLOWS_TO]->(:Address) RETURN \"FLOWS_TO\" AS rel_name, count(r) AS sample_count LIMIT 1"
	},
	{
		id: "address_property_keys",
		query: "MATCH (n:Address) RETURN \"address\" AS property_key, count(n) AS sample_count LIMIT 1"
	},
	{
		id: "flows_to_property_keys",
		query: "MATCH (:Address)-[r:FLOWS_TO]->(:Address) RETURN \"amount_sum\" AS property_key, count(r) AS sample_count LIMIT 1"
	}
];
function clampInt$1(value, fallback, min, max) {
	if (!Number.isFinite(value)) return fallback;
	return Math.max(min, Math.min(max, Math.trunc(value)));
}
function escapeCypherString$2(value) {
	return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}
function sanitizeSegment$1(value) {
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
	await (0, node_fs_promises.mkdir)(paths.logsRoot, {
		recursive: true,
		mode: 448
	});
}
function textFromToolResult$2(result) {
	return (result.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join("\n");
}
function parseGraphBatchResult$2(result) {
	const text = textFromToolResult$2(result).trim();
	if (!text) throw new Error("graph_query_batch returned no text content");
	const parsed = JSON.parse(text);
	if (!parsed.facts?.queries) throw new Error("graph_query_batch response did not include facts.queries");
	return parsed;
}
function topologyGraphQuery$1(query) {
	const trimmed = query.trim();
	if (/^USE\s+/i.test(trimmed)) return trimmed;
	return `USE live_topology ${trimmed}`;
}
async function callGraphBatch$2(remoteClient, network, queries) {
	const result = await remoteClient.callTool({
		name: "graph_query_batch",
		arguments: {
			network,
			queries: queries.map((query) => ({
				...query,
				query: topologyGraphQuery$1(query.query)
			})),
			per_query_timeout_seconds: GRAPH_QUERY_BATCH_TIMEOUT_SECONDS$1
		}
	}, void 0, {
		timeout: GRAPH_QUERY_BATCH_REQUEST_TIMEOUT_MS$1,
		maxTotalTimeout: GRAPH_QUERY_BATCH_REQUEST_TIMEOUT_MS$1
	});
	if (result.isError) throw new Error(textFromToolResult$2(result) || "graph_query_batch failed");
	return parseGraphBatchResult$2(result);
}
function resultsFor(batch, id) {
	const query = batch.facts?.queries?.find((entry) => entry.id === id);
	if (!query) return [];
	if (query.ok === false) throw new Error(query.error || `Query failed: ${id}`);
	return query.results ?? [];
}
function schemaFromGraphBatch(network, batch) {
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
			"dst.lifetime_degree_in AS dst_degree_in",
			"dst.lifetime_degree_out AS dst_degree_out"
		]
	};
}
async function loadOrCaptureTopologySchema(remoteClient, paths, network) {
	const filePath = node_path.default.join(paths.schemaDir, `${sanitizeSegment$1(network)}.graph-schema.json`);
	try {
		return {
			schema: JSON.parse(await (0, node_fs_promises.readFile)(filePath, "utf8")),
			filePath
		};
	} catch (err) {
		if (err.code !== "ENOENT") throw err;
	}
	const schema = schemaFromGraphBatch(network, await callGraphBatch$2(remoteClient, network, SCHEMA_QUERY_SET));
	await (0, node_fs_promises.writeFile)(filePath, JSON.stringify(schema, null, 2) + "\n", { mode: 384 });
	return {
		schema,
		filePath
	};
}
function flowEdgeMap$1(variableName) {
	return `{amount_sum: ${variableName}.amount_sum, amount_usd_sum: ${variableName}.amount_usd_sum, tx_count: ${variableName}.tx_count, first_tx_id: ${variableName}.first_tx_id, last_tx_id: ${variableName}.last_tx_id}`;
}
function pathNodeMap$1(variableName) {
	return `{address: ${variableName}.address, labels: ${variableName}.labels, system_labels: ${variableName}.labels, address_type: ${variableName}.address_type, address_subtypes: ${variableName}.address_subtypes}`;
}
function forwardExchangeQueries(address, limit, minAmountSum, maxHops) {
	return Array.from({ length: maxHops }, (_, index) => forwardExchangeQueryAtDepth(address, limit, minAmountSum, index + 1));
}
function forwardExchangeQueryAtDepth(address, limit, minAmountSum, depth) {
	const intermediateVariables = Array.from({ length: Math.max(depth - 1, 0) }, (_, index) => `n${index + 1}`);
	const nodeVariables = [
		"s",
		...intermediateVariables,
		"t"
	];
	const edgeVariables = Array.from({ length: depth }, (_, index) => `r${index + 1}`);
	const relationshipChain = edgeVariables.map((edgeVariable, index) => {
		return `-[${edgeVariable}:FLOWS_TO]->(${index === edgeVariables.length - 1 ? "t" : intermediateVariables[index]}:Address)`;
	}).join("");
	const amountPredicates = edgeVariables.map((edgeVariable) => `${edgeVariable}.amount_sum IS NOT NULL${minAmountSum > 0 ? ` AND ${edgeVariable}.amount_sum >= ${minAmountSum}` : ""}`);
	const predicates = [
		"s <> t",
		"t.is_exchange IS NOT NULL",
		...intermediateVariables.map((nodeVariable) => `${nodeVariable}.is_exchange IS NULL`),
		...amountPredicates
	];
	const depositVariable = nodeVariables[nodeVariables.length - 2];
	return {
		id: `forward_exchange_paths_${depth}`,
		query: [
			`MATCH (s:Address {address: "${escapeCypherString$2(address)}"})${relationshipChain}`,
			`WHERE ${predicates.join(" AND ")}`,
			`RETURN [${nodeVariables.map((nodeVariable) => `${nodeVariable}.address`).join(", ")}] AS addresses, [${nodeVariables.map((nodeVariable) => `${nodeVariable}.labels`).join(", ")}] AS node_labels, [${nodeVariables.map(pathNodeMap$1).join(", ")}] AS path_nodes, [${edgeVariables.map(flowEdgeMap$1).join(", ")}] AS edge_props, t.address AS exchange_address, t.labels AS exchange_display_labels, t.labels AS exchange_labels, t.address_type AS exchange_address_type, t.address_subtypes AS exchange_address_subtypes, ${depositVariable}.address AS deposit_address, ${depth} AS hops`,
			"ORDER BY hops ASC",
			`LIMIT ${limit}`
		].join(" ")
	};
}
function backwardSourceQueries(idPrefix, depositAddress, maxHops) {
	return Array.from({ length: maxHops }, (_, index) => backwardSourceQueryAtDepth(`${idPrefix}_${index + 1}`, depositAddress, index + 1));
}
function backwardSourceQueryAtDepth(id, depositAddress, depth) {
	const intermediateVariables = Array.from({ length: Math.max(depth - 1, 0) }, (_, index) => `n${index + 1}`);
	const nodeVariables = [
		"dep",
		...intermediateVariables,
		"source"
	];
	const edgeVariables = Array.from({ length: depth }, (_, index) => `r${index + 1}`);
	const relationshipChain = edgeVariables.map((edgeVariable, index) => {
		return `<-[${edgeVariable}:FLOWS_TO]-(${index === edgeVariables.length - 1 ? "source" : intermediateVariables[index]}:Address)`;
	}).join("");
	const intermediatePredicates = intermediateVariables.map((nodeVariable) => `${nodeVariable}.is_exchange IS NULL`);
	return {
		id,
		query: [
			`MATCH (dep:Address {address: "${escapeCypherString$2(depositAddress)}"})`,
			`MATCH (dep)${relationshipChain}`,
			`WHERE source <> dep AND source.is_exchange IS NOT NULL${intermediatePredicates.length > 0 ? ` AND ${intermediatePredicates.join(" AND ")}` : ""}`,
			`RETURN dep.address AS deposit_address, source.address AS source_exchange, source.labels AS source_display_labels, source.labels AS source_labels, source.address_type AS source_address_type, source.address_subtypes AS source_address_subtypes, ${depth} AS hops, [${nodeVariables.map((nodeVariable) => `${nodeVariable}.address`).join(", ")}] AS addresses, [${nodeVariables.map((nodeVariable) => `${nodeVariable}.labels`).join(", ")}] AS node_labels, [${nodeVariables.map(pathNodeMap$1).join(", ")}] AS path_nodes`,
			"LIMIT 20"
		].join(" ")
	};
}
function reverseLeadsQuery(depositAddresses) {
	return {
		id: "reverse_1hop",
		query: [
			"MATCH (sender:Address)-[r:FLOWS_TO]->(deposit:Address)",
			`WHERE (${depositAddresses.map((address) => `deposit.address = "${escapeCypherString$2(address)}"`).join(" OR ")}) AND sender.is_exchange IS NULL AND sender.address <> deposit.address`,
			"RETURN DISTINCT sender.address AS address, sender.labels AS display_labels, sender.labels AS system_labels, sender.address_type AS address_type, sender.address_subtypes AS address_subtypes, coalesce(sender.lifetime_degree_in, 0) AS degree_in, coalesce(sender.lifetime_degree_out, 0) AS degree_out, coalesce(sender.total_volume_usd, 0) AS total_volume_usd, deposit.address AS deposit_address, r.amount_usd_sum AS amount_usd",
			"ORDER BY r.amount_usd_sum DESC",
			`LIMIT ${Math.max(50, depositAddresses.length * 50)}`
		].join(" ")
	};
}
function edgeKey$1(src, dst) {
	return `${src}\u0000${dst}`;
}
function directEdgePropsQuery(flows) {
	const pairs = [...new Map(flows.map((flow) => [edgeKey$1(flow.src, flow.dst), {
		src: flow.src,
		dst: flow.dst
	}])).values()];
	if (pairs.length === 0) return null;
	return {
		id: "direct_edge_props",
		query: [
			"MATCH (a:Address)-[r:FLOWS_TO]->(b:Address)",
			`WHERE (${pairs.map((pair) => `(a.address = "${escapeCypherString$2(pair.src)}" AND b.address = "${escapeCypherString$2(pair.dst)}")`).join(" OR ")})`,
			"RETURN a.address AS src, b.address AS dst, r.amount_sum AS amount_sum, r.amount_usd_sum AS amount_usd_sum, r.tx_count AS tx_count, r.first_tx_id AS first_tx_id, r.last_tx_id AS last_tx_id",
			`LIMIT ${pairs.length}`
		].join(" ")
	};
}
function numberValue$2(value) {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : void 0;
	}
}
function rowTerminalAmount(row) {
	const edgeProps = Array.isArray(row["edge_props"]) ? row["edge_props"] : [];
	const terminalEdge = edgeProps[edgeProps.length - 1];
	if (!terminalEdge) return void 0;
	return numberValue$2(terminalEdge["amount_sum"]) ?? numberValue$2(terminalEdge["amount_usd_sum"]);
}
function rowsMatchingMinimumAmount(rows, minAmountSum) {
	if (minAmountSum <= 0) return rows;
	return rows.filter((row) => (rowTerminalAmount(row) ?? 0) >= minAmountSum);
}
function stringArrayValue$1(value) {
	if (Array.isArray(value)) return value.map(String);
	if (typeof value === "string" && value.trim()) return [value];
}
function uniqueStrings(values) {
	return [...new Set(values ?? [])];
}
function nodeMetadataFromValue(value, fallbackAddress) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return fallbackAddress ? { address: fallbackAddress } : void 0;
	const record = value;
	const address = typeof record["address"] === "string" ? record["address"] : fallbackAddress;
	if (!address) return void 0;
	return {
		address,
		labels: stringArrayValue$1(record["labels"]),
		system_labels: stringArrayValue$1(record["system_labels"]),
		address_type: typeof record["address_type"] === "string" ? record["address_type"] : void 0,
		address_subtypes: stringArrayValue$1(record["address_subtypes"])
	};
}
function isExchangeFlow(flow) {
	return flow.terminal_exchange || flow.dst_labels?.includes("Exchange") === true || flow.dst_node?.system_labels?.includes("Exchange") === true;
}
function depositFromRow(row) {
	const pathAddresses = stringArrayValue$1(row["addresses"]) ?? [];
	if (pathAddresses.length < 2) return null;
	const exchangeAddress = typeof row["exchange_address"] === "string" ? row["exchange_address"] : pathAddresses[pathAddresses.length - 1];
	const edgeProps = Array.isArray(row["edge_props"]) ? row["edge_props"] : [];
	const terminalEdge = edgeProps[edgeProps.length - 1] ?? {};
	const pathNodes = Array.isArray(row["path_nodes"]) ? row["path_nodes"].map((node, index) => nodeMetadataFromValue(node, pathAddresses[index])).filter((node) => Boolean(node)) : void 0;
	const exchangeNode = {
		address: exchangeAddress,
		labels: stringArrayValue$1(row["exchange_display_labels"]),
		system_labels: stringArrayValue$1(row["exchange_system_labels"]) ?? stringArrayValue$1(row["exchange_labels"]),
		address_type: typeof row["exchange_address_type"] === "string" ? row["exchange_address_type"] : void 0,
		address_subtypes: stringArrayValue$1(row["exchange_address_subtypes"])
	};
	return {
		address: pathAddresses[pathAddresses.length - 2],
		exchangeAddress,
		exchangeLabels: stringArrayValue$1(row["exchange_labels"]),
		exchangeNode,
		amount_sum: numberValue$2(terminalEdge["amount_sum"]),
		amount_usd_sum: numberValue$2(terminalEdge["amount_usd_sum"]),
		hops: numberValue$2(row["hops"]) ?? pathAddresses.length - 1,
		path: pathAddresses,
		pathNodes
	};
}
function flowsFromForwardRows(rows) {
	const flows = [];
	const deposits = [];
	const seenEdges = /* @__PURE__ */ new Set();
	for (const row of rows) {
		const pathAddresses = stringArrayValue$1(row["addresses"]) ?? [];
		const nodeLabels = Array.isArray(row["node_labels"]) ? row["node_labels"].map((labels) => stringArrayValue$1(labels) ?? []) : [];
		const pathNodes = Array.isArray(row["path_nodes"]) ? row["path_nodes"].map((node, index) => nodeMetadataFromValue(node, pathAddresses[index])) : [];
		const edgeProps = Array.isArray(row["edge_props"]) ? row["edge_props"] : [];
		const deposit = depositFromRow(row);
		if (deposit) deposits.push(deposit);
		for (let index = 0; index < pathAddresses.length - 1; index += 1) {
			const src = pathAddresses[index];
			const dst = pathAddresses[index + 1];
			const edge = edgeProps[index] ?? {};
			const amount = numberValue$2(edge["amount_sum"]) ?? numberValue$2(edge["amount_usd_sum"]) ?? 0;
			const terminal = index === pathAddresses.length - 2;
			const key = `${src}->${dst}`;
			if (seenEdges.has(key)) continue;
			seenEdges.add(key);
			flows.push({
				hop: index + 1,
				src,
				dst,
				amount_sum: amount,
				amount_usd_sum: numberValue$2(edge["amount_usd_sum"]),
				tx_count: numberValue$2(edge["tx_count"]),
				first_tx_id: typeof edge["first_tx_id"] === "string" ? edge["first_tx_id"] : void 0,
				last_tx_id: typeof edge["last_tx_id"] === "string" ? edge["last_tx_id"] : void 0,
				src_labels: nodeLabels[index],
				dst_labels: nodeLabels[index + 1],
				src_node: pathNodes[index],
				dst_node: pathNodes[index + 1],
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
	const batch = await callGraphBatch$2(remoteClient, network, [query]);
	const edgeProps = /* @__PURE__ */ new Map();
	for (const row of resultsFor(batch, "direct_edge_props")) {
		const src = typeof row["src"] === "string" ? row["src"] : "";
		const dst = typeof row["dst"] === "string" ? row["dst"] : "";
		if (!src || !dst) continue;
		edgeProps.set(edgeKey$1(src, dst), row);
	}
	for (const flow of flows) {
		const props = edgeProps.get(edgeKey$1(flow.src, flow.dst));
		if (!props) continue;
		flow.amount_sum = numberValue$2(props["amount_sum"]) ?? flow.amount_sum;
		flow.amount_usd_sum = numberValue$2(props["amount_usd_sum"]);
		flow.tx_count = numberValue$2(props["tx_count"]);
		flow.first_tx_id = typeof props["first_tx_id"] === "string" ? props["first_tx_id"] : void 0;
		flow.last_tx_id = typeof props["last_tx_id"] === "string" ? props["last_tx_id"] : void 0;
	}
	for (const deposit of deposits) {
		const props = edgeProps.get(edgeKey$1(deposit.address, deposit.exchangeAddress));
		if (!props) continue;
		deposit.amount_sum = numberValue$2(props["amount_sum"]);
		deposit.amount_usd_sum = numberValue$2(props["amount_usd_sum"]);
	}
}
async function collectProbeTrace(remoteClient, options) {
	const { flows, deposits } = flowsFromForwardRows(rowsMatchingMinimumAmount(((await callGraphBatch$2(remoteClient, options.network, [...forwardExchangeQueries(options.seedAddress, Math.max(options.perAddressLimit * 20, 200), options.minAmountSum, options.maxHops)])).facts?.queries ?? []).filter((query) => query.id?.startsWith("forward_exchange_paths_")).flatMap((query) => {
		if (query.ok === false) throw new Error(query.error || `Query failed: ${query.id}`);
		return query.results ?? [];
	}), options.minAmountSum));
	await hydrateDirectEdgeProps(remoteClient, options.network, flows, deposits);
	const uniqueDepositAddresses = [...new Set(deposits.map((deposit) => deposit.address))];
	const sourceMatches = [];
	if (uniqueDepositAddresses.length > 0) {
		const backwardBatch = await callGraphBatch$2(remoteClient, options.network, uniqueDepositAddresses.slice(0, Math.max(1, Math.floor(20 / options.maxHops))).flatMap((address, index) => backwardSourceQueries(`backward_from_deposit_${index + 1}`, address, options.maxHops)));
		for (const query of backwardBatch.facts?.queries ?? []) for (const row of query.results ?? []) {
			const pathAddresses = stringArrayValue$1(row["addresses"]) ?? [];
			const pathNodes = Array.isArray(row["path_nodes"]) ? row["path_nodes"].map((node, index) => nodeMetadataFromValue(node, pathAddresses[index])).filter((node) => Boolean(node)) : void 0;
			const depositAddress = typeof row["deposit_address"] === "string" ? row["deposit_address"] : pathAddresses[0];
			const sourceExchange = typeof row["source_exchange"] === "string" ? row["source_exchange"] : pathAddresses[pathAddresses.length - 1];
			if (!depositAddress || !sourceExchange) continue;
			const sourceNode = {
				address: sourceExchange,
				labels: stringArrayValue$1(row["source_display_labels"]),
				system_labels: stringArrayValue$1(row["source_system_labels"]) ?? stringArrayValue$1(row["source_labels"]),
				address_type: typeof row["source_address_type"] === "string" ? row["source_address_type"] : void 0,
				address_subtypes: stringArrayValue$1(row["source_address_subtypes"])
			};
			sourceMatches.push({
				deposit_address: depositAddress,
				source_exchange: sourceExchange,
				source_labels: stringArrayValue$1(row["source_labels"]),
				sourceNode,
				hops: numberValue$2(row["hops"]) ?? Math.max(pathAddresses.length - 1, 0),
				path: pathAddresses,
				pathNodes
			});
		}
	}
	const reverseLeads = [];
	if (uniqueDepositAddresses.length > 0) {
		const reverseBatch = await callGraphBatch$2(remoteClient, options.network, [reverseLeadsQuery(uniqueDepositAddresses)]);
		for (const row of resultsFor(reverseBatch, "reverse_1hop")) {
			const address = typeof row["address"] === "string" ? row["address"] : "";
			const depositAddress = typeof row["deposit_address"] === "string" ? row["deposit_address"] : "";
			if (!address || !depositAddress) continue;
			const labels = stringArrayValue$1(row["display_labels"]) ?? stringArrayValue$1(row["labels"]) ?? [];
			const degreeIn = numberValue$2(row["degree_in"]) ?? 0;
			const degreeOut = numberValue$2(row["degree_out"]) ?? 0;
			const totalVolume = numberValue$2(row["total_volume_usd"]) ?? 0;
			const reason = labels.length > 0 ? "labeled_entity" : degreeIn > 50 ? "fan_in_hub" : degreeOut > 50 ? "fan_out_hub" : totalVolume > 1e5 ? "high_volume_sender" : "";
			if (!reason) continue;
			reverseLeads.push({
				address,
				labels,
				node: {
					address,
					labels,
					system_labels: stringArrayValue$1(row["system_labels"]),
					address_type: typeof row["address_type"] === "string" ? row["address_type"] : void 0,
					address_subtypes: stringArrayValue$1(row["address_subtypes"])
				},
				degree_in: degreeIn,
				degree_out: degreeOut,
				total_volume_usd: totalVolume,
				deposit_address: depositAddress,
				amount_usd: numberValue$2(row["amount_usd"]),
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
function buildGraph$1(seedAddress, network, flows, deposits, sourceMatches, reverseLeads) {
	const totals = /* @__PURE__ */ new Map();
	const ensure = (address) => {
		if (!totals.has(address)) totals.set(address, {
			in: 0,
			out: 0,
			labels: [],
			systemLabels: [],
			addressSubtypes: [],
			roles: new Set(address === seedAddress ? ["seed"] : [])
		});
		return totals.get(address);
	};
	const mergeNode = (address, metadata, role, systemLabelsFallback) => {
		const node = ensure(address);
		node.labels = uniqueStrings([...node.labels, ...metadata?.labels ?? []]);
		node.systemLabels = uniqueStrings([
			...node.systemLabels,
			...metadata?.system_labels ?? [],
			...systemLabelsFallback ?? []
		]);
		if (metadata?.address_type) node.addressType = metadata.address_type;
		node.addressSubtypes = uniqueStrings([...node.addressSubtypes, ...metadata?.address_subtypes ?? []]);
		if (role) node.roles.add(role);
		return node;
	};
	for (const flow of flows) {
		const src = mergeNode(flow.src, flow.src_node, void 0, flow.src_labels);
		src.out += flow.amount_usd_sum ?? flow.amount_sum;
		const dst = mergeNode(flow.dst, flow.dst_node, void 0, flow.dst_labels);
		dst.in += flow.amount_usd_sum ?? flow.amount_sum;
		if (isExchangeFlow(flow)) dst.roles.add("exchange");
	}
	for (const deposit of deposits) {
		for (const node of deposit.pathNodes ?? []) mergeNode(node.address, node);
		mergeNode(deposit.address, deposit.pathNodes?.find((node) => node.address === deposit.address), "deposit_candidate");
		mergeNode(deposit.exchangeAddress, deposit.exchangeNode, "exchange", deposit.exchangeLabels);
	}
	for (const source of sourceMatches) {
		for (const node of source.pathNodes ?? []) mergeNode(node.address, node);
		mergeNode(source.source_exchange, source.sourceNode, "exchange", source.source_labels);
	}
	for (const lead of reverseLeads) {
		mergeNode(lead.address, lead.node ?? {
			address: lead.address,
			labels: lead.labels
		}, "lead");
		const deposit = ensure(lead.deposit_address);
		deposit.in += lead.amount_usd ?? 0;
	}
	const sourceMatchEdges = sourceMatches.flatMap((source) => {
		const path = source.path.length >= 2 ? source.path : [source.deposit_address, source.source_exchange];
		const edges = [];
		for (let index = path.length - 1; index > 0; index -= 1) edges.push({
			source: path[index],
			target: path[index - 1],
			edge_type: "flows_to",
			usd_amount: 0,
			amount_sum: 0,
			tx_count: 0,
			direction: "traceback"
		});
		return edges;
	});
	return require_graph_normalizer.normalizeGraphPayload({
		schema: "chain-insights.graph.v1",
		nodes: [...totals.entries()].map(([address, data]) => ({
			id: address,
			address,
			node_type: "address",
			labels: uniqueStrings(data.labels),
			...data.systemLabels.length > 0 ? { system_labels: uniqueStrings(data.systemLabels) } : {},
			...data.addressType ? { address_type: data.addressType } : {},
			...data.addressSubtypes.length > 0 ? { address_subtypes: uniqueStrings(data.addressSubtypes) } : {},
			...data.roles.size > 0 ? { roles: [...data.roles] } : {},
			flow_in_usd: data.in,
			flow_out_usd: data.out
		})),
		edges: [
			...flows.map((flow) => ({
				source: flow.src,
				target: flow.dst,
				edge_type: "flows_to",
				usd_amount: flow.amount_usd_sum ?? flow.amount_sum,
				amount_sum: flow.amount_sum,
				tx_count: flow.tx_count ?? 0,
				first_tx_id: flow.first_tx_id,
				last_tx_id: flow.last_tx_id,
				terminal_exchange: flow.terminal_exchange
			})),
			...sourceMatchEdges,
			...reverseLeads.map((lead) => ({
				source: lead.address,
				target: lead.deposit_address,
				edge_type: "flows_to",
				usd_amount: lead.amount_usd ?? 0,
				amount_sum: lead.amount_usd ?? 0,
				tx_count: 0,
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
function summarize$1(seedAddress, network, flows, sourceMatches, reverseLeads, aliases, files, continuation) {
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
	const maxHops = clampInt$1(options.maxHops, 3, 1, 5);
	const perAddressLimit = clampInt$1(options.perAddressLimit, 5, 1, 10);
	const minAmountSum = Math.max(0, options.minAmountSum ?? 0);
	const paths = require_output_root.workspaceOutputPaths();
	await ensureDirs(paths);
	const schemaResult = await loadOrCaptureTopologySchema(remoteClient, paths, network);
	const { flows, deposits, sourceMatches, reverseLeads } = await collectProbeTrace(remoteClient, {
		seedAddress,
		network,
		maxHops,
		perAddressLimit,
		minAmountSum
	});
	const aliases = buildAliases(seedAddress, deposits, sourceMatches, reverseLeads);
	const slug = `${(/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}_${sanitizeSegment$1(seedAddress.slice(0, 16))}`;
	const compact = probeEvidence(seedAddress, network, schemaResult.filePath, aliases, flows, deposits, sourceMatches, reverseLeads);
	const graph = buildGraph$1(seedAddress, network, flows, deposits, sourceMatches, reverseLeads);
	const compactPath = node_path.default.join(paths.reportTablesRoot, `${slug}.compact-evidence.json`);
	const graphPath = node_path.default.join(paths.reportGraphsRoot, `${slug}.graph.json`);
	const graphHtmlPath = node_path.default.join(paths.reportsRoot, `${slug}.graph.html`);
	const tablePath = node_path.default.join(paths.reportTablesRoot, `${slug}.flows.csv`);
	const tableHtmlPath = node_path.default.join(paths.reportsRoot, `${slug}.table.html`);
	const reportPath = node_path.default.join(paths.reportsRoot, `${slug}.trace-report.md`);
	const { generateInlineGraphHtml } = await Promise.resolve().then(() => require("./html-generator-CAv81IWH.cjs")).then((n) => n.html_generator_exports);
	await (0, node_fs_promises.writeFile)(compactPath, JSON.stringify(compact, null, 2) + "\n", { mode: 384 });
	await (0, node_fs_promises.writeFile)(graphPath, JSON.stringify(graph, null, 2) + "\n", { mode: 384 });
	await (0, node_fs_promises.writeFile)(graphHtmlPath, generateInlineGraphHtml(graph), { mode: 384 });
	await (0, node_fs_promises.writeFile)(tablePath, tableCsv(flows), { mode: 384 });
	await (0, node_fs_promises.writeFile)(tableHtmlPath, buildTableHtml(seedAddress, network, flows, deposits, sourceMatches, reverseLeads), { mode: 384 });
	await (0, node_fs_promises.writeFile)(reportPath, buildMarkdownReport(seedAddress, network, flows, deposits, sourceMatches, reverseLeads, aliases, graphPath, schemaResult.filePath), { mode: 384 });
	if (options.caseId) {
		const { EvidenceStore } = await Promise.resolve().then(() => require("./cases-CDcNU91B.cjs"));
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
		hint: depositAddresses.length > 0 ? `Found ${depositAddresses.length} deposit candidate(s), defined as the address one hop before an exchange endpoint. Do not continue through exchange nodes.` : leaves.length > 0 ? `No exchange endpoint reached yet. Continue from ${leaves.length} non-exchange leaf destination(s) with the same tool, or raise the result budget if the current trace stopped early.` : "No exchange endpoint or non-exchange leaf destinations found; inspect graph/report files or lower min_amount_sum."
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
		summaryText: summarize$1(seedAddress, network, flows, sourceMatches, reverseLeads, aliases, files, continuation),
		compactEvidence: compact,
		graphData: graph,
		files,
		continuation,
		addressMap: aliases.compactAddressMap()
	};
}
//#endregion
//#region src/investigation/scam-topology.ts
const SCAM_TOPOLOGY_GRAPH_QUERY_TIMEOUT_SECONDS = 15;
const SCAM_TOPOLOGY_GRAPH_BATCH_REQUEST_TIMEOUT_MS = 900 * 1e3;
const SCAM_TOPOLOGY_MAX_BATCH_QUERIES = 20;
const SCAM_TOPOLOGY_ARCHIVE_BATCH_QUERIES = 1;
const SCAM_TOPOLOGY_DEPOSIT_CLUSTER_LIMIT = 200;
const SCAM_TOPOLOGY_DEFAULT_MAX_HOPS = 16;
const SCAM_TOPOLOGY_MAX_HOPS = 64;
const SCAM_TOPOLOGY_FRONTIER_LIMIT = 10;
const SCAM_TOPOLOGY_MAX_FRONTIER_SOURCES_PER_HOP = 50;
function parseAddressList$1(value) {
	const raw = Array.isArray(value) ? value.join(",") : value ?? "";
	return [...new Set(raw.split(",").map((entry) => entry.trim()).filter(Boolean))];
}
function stringArray(value) {
	if (Array.isArray(value)) return value.map(String).map((entry) => entry.trim()).filter(Boolean);
	if (typeof value === "string" && value.trim()) {
		const trimmed = value.trim();
		if (trimmed.startsWith("[")) try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) return parsed.map(String).map((entry) => entry.trim()).filter(Boolean);
		} catch {}
		return trimmed.split(",").map((entry) => entry.trim()).filter(Boolean);
	}
	return [];
}
function stringValue(value) {
	return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function numberValue$1(value) {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
}
function clampInt(value, fallback, min, max) {
	if (!Number.isFinite(value)) return fallback;
	return Math.max(min, Math.min(max, Math.trunc(value)));
}
function chunks(values, size) {
	const result = [];
	for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
	return result;
}
function sanitizeSegment(value) {
	return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80) || "scam-topology";
}
async function ensureScamTopologyDirs(paths) {
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
}
function escapeCypherString$1(value) {
	return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}
function textFromToolResult$1(result) {
	return (result.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join("\n");
}
function parseGraphBatchResult$1(result) {
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
			per_query_timeout_seconds: SCAM_TOPOLOGY_GRAPH_QUERY_TIMEOUT_SECONDS
		}
	}, void 0, {
		timeout: SCAM_TOPOLOGY_GRAPH_BATCH_REQUEST_TIMEOUT_MS,
		maxTotalTimeout: SCAM_TOPOLOGY_GRAPH_BATCH_REQUEST_TIMEOUT_MS
	});
	if (result.isError) throw new Error(textFromToolResult$1(result) || "graph_query_batch failed");
	return parseGraphBatchResult$1(result);
}
function graphForScope(graphScope) {
	return graphScope === "history" ? "archive_topology" : "live_topology";
}
function isExchangeFlag(value) {
	if (value === true) return true;
	if (value === false || value === null || value === void 0) return false;
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		return normalized === "true" || normalized === "1";
	}
	if (typeof value === "number") return value === 1;
	return false;
}
function hasExchangeLabel(labels) {
	return labels.some((label) => label.toLowerCase() === "exchange" || label.toLowerCase().includes("exchange"));
}
function isExchangeEndpoint(labels, isExchange, roles) {
	return isExchangeFlag(isExchange) || hasExchangeLabel(labels) || roles.some((role) => role.toLowerCase().includes("exchange"));
}
function isGenericContextLabel(label) {
	const normalized = label.trim().toLowerCase();
	return normalized === "exchange" || normalized === "validator" || /^miner subnet \d+$/.test(normalized) || /^subnet \d+(?: owner)?$/.test(normalized);
}
function exchangeNamesFromLabels(labels) {
	return [...new Set(labels.map((label) => label.trim().replace(/,\s*exchange$/i, "").trim()).filter((label) => label.length > 0 && !isGenericContextLabel(label)))];
}
function traversalProjection() {
	return [
		"src.address AS src",
		"dst.address AS dst",
		"src.labels AS src_labels",
		"dst.labels AS dst_labels",
		"src.is_exchange AS src_is_exchange",
		"dst.is_exchange AS dst_is_exchange",
		"r.amount_sum AS amount_sum",
		"r.amount_usd_sum AS amount_usd_sum",
		"r.tx_count AS tx_count",
		"r.first_seen_timestamp AS first_seen_timestamp",
		"r.last_seen_timestamp AS last_seen_timestamp",
		"r.first_tx_id AS first_tx_id",
		"r.last_tx_id AS last_tx_id"
	].join(", ");
}
function frontierQuery(graphScope, sourceAddress, hop, sourceIndex, perAddressLimit, minAmountSum, activityThresholdTimestamp) {
	const where = ["src.address <> dst.address"];
	if (minAmountSum !== void 0) where.push(`r.amount_sum >= ${minAmountSum}`);
	if (graphScope === "incident" && activityThresholdTimestamp !== void 0) where.push(`(r.first_seen_timestamp >= ${activityThresholdTimestamp} OR r.last_seen_timestamp >= ${activityThresholdTimestamp})`);
	return {
		id: sourceIndex === void 0 ? `${graphScope}_hop_${hop}` : `${graphScope}_hop_${hop}_source_${sourceIndex}`,
		query: [
			`USE ${graphForScope(graphScope)}`,
			`MATCH (src:Address {address: "${escapeCypherString$1(sourceAddress)}"})-[r:FLOWS_TO]->(dst:Address)`,
			`WHERE ${where.join(" AND ")}`,
			`RETURN ${traversalProjection()}`,
			"ORDER BY r.amount_sum DESC",
			`LIMIT ${perAddressLimit}`
		].join(" ")
	};
}
function activityThresholdFor(policy, incidentTimestampMs, entry) {
	if (policy === "global_incident") return incidentTimestampMs;
	return entry.arrivalTimestamp ?? incidentTimestampMs;
}
function edgeArrivalTimestamp(edge, threshold) {
	if (threshold === void 0) return edge.first_seen_timestamp ?? edge.last_seen_timestamp;
	if (edge.first_seen_timestamp !== void 0 && edge.first_seen_timestamp >= threshold) return edge.first_seen_timestamp;
	if (edge.last_seen_timestamp !== void 0 && edge.last_seen_timestamp >= threshold) return threshold;
	return edge.first_seen_timestamp ?? edge.last_seen_timestamp ?? threshold;
}
function depositClusterQuery(graphScope, depositAddress, index, minAmountSum) {
	const where = ["src.address <> dst.address", "src.is_exchange IS NULL"];
	if (minAmountSum !== void 0) where.push(`r.amount_sum >= ${minAmountSum}`);
	return {
		id: `${graphScope}_deposit_cluster_${index}`,
		query: [
			`USE ${graphForScope(graphScope)}`,
			`MATCH (src:Address)-[r:FLOWS_TO]->(dst:Address {address: "${escapeCypherString$1(depositAddress)}"})`,
			`WHERE ${where.join(" AND ")}`,
			`RETURN ${traversalProjection()}`,
			"ORDER BY r.amount_sum DESC",
			`LIMIT ${SCAM_TOPOLOGY_DEPOSIT_CLUSTER_LIMIT}`
		].join(" ")
	};
}
function edgeFromRow(row, graphScope, hop, context) {
	const src = stringValue(row["src"]) ?? stringValue(row["from_address"]);
	const dst = stringValue(row["dst"]) ?? stringValue(row["to_address"]);
	if (!src || !dst || src === dst) return null;
	const srcLabels = stringArray(row["src_labels"]);
	const dstLabels = stringArray(row["dst_labels"]);
	const srcRoles = stringArray(row["src_roles"]);
	const dstRoles = stringArray(row["dst_roles"]);
	const srcIsExchange = isExchangeEndpoint(srcLabels, row["src_is_exchange"], srcRoles);
	const dstIsExchange = isExchangeEndpoint(dstLabels, row["dst_is_exchange"], dstRoles);
	const genericLabeledBoundary = dstLabels.length > 0 && !dstIsExchange;
	return {
		relation: dstIsExchange ? "terminal_exchange" : genericLabeledBoundary ? "context_boundary" : hop === 1 ? "seed_outflow" : "traversal_edge",
		src,
		dst,
		hop,
		graph_scope: graphScope,
		topology_graph: graphForScope(graphScope),
		seed_address: context.seedAddress,
		seed_role: context.seedRole,
		amount_sum: numberValue$1(row["amount_sum"]),
		amount_usd_sum: numberValue$1(row["amount_usd_sum"]),
		tx_count: numberValue$1(row["tx_count"]),
		first_seen_timestamp: numberValue$1(row["first_seen_timestamp"]),
		last_seen_timestamp: numberValue$1(row["last_seen_timestamp"]),
		first_tx_id: stringValue(row["first_tx_id"]),
		last_tx_id: stringValue(row["last_tx_id"]),
		src_labels: srcLabels,
		dst_labels: dstLabels,
		src_is_exchange: srcIsExchange,
		dst_is_exchange: dstIsExchange
	};
}
function edgeKey(edge) {
	return `${edge.graph_scope}\u0000${edge.seed_role ?? ""}\u0000${edge.seed_address ?? ""}\u0000${edge.src}\u0000${edge.dst}`;
}
function frontierKey(entry) {
	return `${entry.seedRole}\u0000${entry.seedAddress}\u0000${entry.address}`;
}
async function runDirectedTraversal(remoteClient, network, seeds, graphScope, activityPolicy, maxHops, perAddressLimit, minAmountSum, incidentTimestampMs) {
	const edgesByKey = /* @__PURE__ */ new Map();
	const skippedQueryErrors = [];
	let frontier = seeds.map((seed) => ({
		address: seed.address,
		seedAddress: seed.address,
		seedRole: seed.role,
		arrivalTimestamp: incidentTimestampMs,
		waveIndex: 0
	}));
	const visited = new Set(frontier.map(frontierKey));
	for (let hop = 1; hop <= maxHops && frontier.length > 0; hop += 1) {
		const frontierByAddress = /* @__PURE__ */ new Map();
		for (const entry of frontier) {
			const entries = frontierByAddress.get(entry.address) ?? [];
			entries.push(entry);
			frontierByAddress.set(entry.address, entries);
		}
		const frontierAddresses = [...frontierByAddress.keys()];
		const queries = frontierAddresses.map((address, index) => {
			const entry = frontierByAddress.get(address)?.[0];
			return frontierQuery(graphScope, address, hop, frontierAddresses.length === 1 ? void 0 : index + 1, perAddressLimit, minAmountSum, entry ? activityThresholdFor(activityPolicy, incidentTimestampMs, entry) : incidentTimestampMs);
		});
		const nextByKey = /* @__PURE__ */ new Map();
		const maxBatchQueries = graphScope === "history" ? SCAM_TOPOLOGY_ARCHIVE_BATCH_QUERIES : SCAM_TOPOLOGY_MAX_BATCH_QUERIES;
		for (const queryChunk of chunks(queries, maxBatchQueries)) {
			let batch;
			try {
				batch = await callGraphBatch$1(remoteClient, network, queryChunk);
			} catch (err) {
				if (hop === 1) throw err;
				for (const query of queryChunk) skippedQueryErrors.push({
					id: query.id,
					hop,
					graph_scope: graphScope,
					error: err.message
				});
				continue;
			}
			for (const queryResult of batch.facts?.queries ?? []) {
				if (queryResult.ok === false) {
					if (hop === 1) throw new Error(queryResult.error || `Query failed: ${queryResult.id}`);
					skippedQueryErrors.push({
						id: queryResult.id,
						hop,
						graph_scope: graphScope,
						error: queryResult.error || `Query failed: ${queryResult.id}`
					});
					continue;
				}
				for (const row of queryResult.results ?? []) {
					const src = stringValue(row["src"]) ?? stringValue(row["from_address"]);
					if (!src) continue;
					const contexts = frontierByAddress.get(src) ?? [];
					for (const context of contexts) {
						const baseEdge = edgeFromRow(row, graphScope, hop, context);
						if (!baseEdge || edgesByKey.has(edgeKey(baseEdge))) continue;
						const threshold = activityThresholdFor(activityPolicy, incidentTimestampMs, context);
						const targetEntry = {
							address: baseEdge.dst,
							seedAddress: context.seedAddress,
							seedRole: context.seedRole,
							arrivalTimestamp: edgeArrivalTimestamp(baseEdge, threshold),
							waveIndex: hop
						};
						const targetKey = frontierKey(targetEntry);
						const seenBefore = visited.has(targetKey);
						const terminal = baseEdge.relation === "terminal_exchange" || baseEdge.relation === "context_boundary";
						const expandsFrontier = !seenBefore && !terminal;
						const edge = {
							...baseEdge,
							relation: seenBefore && baseEdge.relation === "traversal_edge" ? "convergence_edge" : baseEdge.relation,
							activity_policy: activityPolicy,
							wave_index: hop,
							expands_frontier: expandsFrontier,
							converges_to_seen_node: seenBefore,
							activity_threshold_timestamp: threshold,
							src_arrival_timestamp: context.arrivalTimestamp,
							dst_arrival_timestamp: targetEntry.arrivalTimestamp
						};
						edgesByKey.set(edgeKey(edge), edge);
						if (!seenBefore) visited.add(targetKey);
						if (!expandsFrontier) continue;
						const nextEntry = {
							address: edge.dst,
							seedAddress: context.seedAddress,
							seedRole: context.seedRole,
							arrivalTimestamp: edge.dst_arrival_timestamp,
							waveIndex: hop
						};
						nextByKey.set(targetKey, nextEntry);
					}
				}
			}
		}
		frontier = [...nextByKey.values()].slice(0, SCAM_TOPOLOGY_MAX_FRONTIER_SOURCES_PER_HOP);
	}
	return {
		graphScope,
		topologyGraph: graphForScope(graphScope),
		activityPolicy,
		edges: [...edgesByKey.values()],
		skippedQueryErrors
	};
}
async function expandDepositClusters(remoteClient, network, run, minAmountSum) {
	const edgesByKey = new Map(run.edges.map((edge) => [edgeKey(edge), edge]));
	const terminalDepositsByKey = /* @__PURE__ */ new Map();
	for (const edge of run.edges) {
		if (edge.relation !== "terminal_exchange") continue;
		const key = `${edge.seed_role ?? ""}\u0000${edge.seed_address ?? ""}\u0000${edge.src}`;
		if (!terminalDepositsByKey.has(key)) terminalDepositsByKey.set(key, edge);
	}
	const terminalDeposits = [...terminalDepositsByKey.values()];
	if (terminalDeposits.length === 0) return run;
	const queries = terminalDeposits.map((edge, index) => depositClusterQuery(run.graphScope, edge.src, index + 1, minAmountSum));
	const maxBatchQueries = run.graphScope === "history" ? SCAM_TOPOLOGY_ARCHIVE_BATCH_QUERIES : SCAM_TOPOLOGY_MAX_BATCH_QUERIES;
	for (const queryChunk of chunks(queries, maxBatchQueries)) {
		let batch;
		try {
			batch = await callGraphBatch$1(remoteClient, network, queryChunk);
		} catch (err) {
			for (const query of queryChunk) run.skippedQueryErrors.push({
				id: query.id,
				graph_scope: run.graphScope,
				error: err.message
			});
			continue;
		}
		for (const queryResult of batch.facts?.queries ?? []) {
			if (queryResult.ok === false) {
				run.skippedQueryErrors.push({
					id: queryResult.id,
					graph_scope: run.graphScope,
					error: queryResult.error || `Query failed: ${queryResult.id}`
				});
				continue;
			}
			const terminalEdge = terminalDeposits[queries.findIndex((query) => query.id === queryResult.id)];
			if (!terminalEdge) continue;
			const context = {
				address: terminalEdge.src,
				seedAddress: terminalEdge.seed_address ?? terminalEdge.src,
				seedRole: terminalEdge.seed_role ?? "victim",
				arrivalTimestamp: terminalEdge.src_arrival_timestamp ?? terminalEdge.first_seen_timestamp ?? terminalEdge.last_seen_timestamp,
				waveIndex: Math.max(0, terminalEdge.hop - 1)
			};
			for (const row of queryResult.results ?? []) {
				const edge = edgeFromRow(row, run.graphScope, Math.max(1, terminalEdge.hop - 1), context);
				if (!edge || edge.dst !== terminalEdge.src || edge.src === terminalEdge.dst) continue;
				const clusterEdge = {
					...edge,
					relation: "deposit_cluster_inflow",
					seed_address: terminalEdge.seed_address,
					seed_role: terminalEdge.seed_role,
					activity_policy: run.activityPolicy,
					wave_index: Math.max(1, terminalEdge.hop - 1),
					expands_frontier: false,
					converges_to_seen_node: true,
					activity_threshold_timestamp: terminalEdge.activity_threshold_timestamp,
					src_arrival_timestamp: edge.first_seen_timestamp ?? edge.last_seen_timestamp,
					dst_arrival_timestamp: terminalEdge.dst_arrival_timestamp
				};
				if (!edgesByKey.has(edgeKey(clusterEdge))) edgesByKey.set(edgeKey(clusterEdge), clusterEdge);
			}
		}
	}
	return {
		...run,
		edges: [...edgesByKey.values()]
	};
}
function candidateKey(candidate) {
	return `${candidate.address}\u0000${candidate.address_subtype}`;
}
function mergeCandidate(candidates, candidate) {
	const key = candidateKey(candidate);
	const existing = candidates.get(key);
	if (!existing) {
		candidates.set(key, candidate);
		return;
	}
	existing.confidence_score = Math.max(existing.confidence_score, candidate.confidence_score);
	existing.evidence.push(...candidate.evidence);
	if (candidate.promotion_status === "promote_confirmed") {
		existing.promotion_status = "promote_confirmed";
		existing.trust_level = "blacklisted";
		existing.risk_level = "critical";
	}
}
function labelForSubtype(subtype) {
	switch (subtype) {
		case "scam_seed": return "Known scam seed";
		case "laundering_intermediate": return "Scam laundering intermediate";
		case "exchange_deposit_candidate": return "Scam exchange deposit candidate";
	}
}
function makeCandidate(address, subtype, evidence, confidence, promotionStatus) {
	return {
		address,
		label: labelForSubtype(subtype),
		address_type: "SCAM",
		address_subtype: subtype,
		trust_level: promotionStatus === "promote_confirmed" ? "blacklisted" : "candidate",
		risk_level: promotionStatus === "promote_confirmed" ? "critical" : "high",
		confidence_score: confidence,
		promotion_status: promotionStatus,
		source: "scam_topology",
		evidence: [evidence]
	};
}
function addRole(rolesByAddress, address, role) {
	if (!address) return;
	const roles = rolesByAddress.get(address) ?? /* @__PURE__ */ new Set();
	roles.add(role);
	rolesByAddress.set(address, roles);
}
function pushCaseRole(caseRoles, role) {
	if (caseRoles.some((entry) => entry.address === role.address && entry.role === role.role && entry.seed_address === role.seed_address && entry.seed_role === role.seed_role)) return;
	caseRoles.push(role);
}
function pushSafetyDecision(safetyDecisions, decision) {
	if (safetyDecisions.some((entry) => JSON.stringify(entry) === JSON.stringify(decision))) return;
	safetyDecisions.push(decision);
}
function edgeEvidence(edge, reason) {
	return {
		seed_address: edge.seed_address,
		seed_role: edge.seed_role,
		graph_scope: edge.graph_scope,
		scope_membership: edge.scope_membership,
		hop: edge.hop,
		src: edge.src,
		dst: edge.dst,
		amount_sum: edge.amount_sum,
		amount_usd_sum: edge.amount_usd_sum,
		tx_count: edge.tx_count,
		...edge.relation === "terminal_exchange" ? {
			deposit_address: edge.src,
			exchange_address: edge.dst,
			exchange_names: exchangeNamesFromLabels(edge.dst_labels),
			exchange_labels: edge.dst_labels
		} : {},
		reason
	};
}
function classifyTopology(seeds, edges) {
	const candidates = /* @__PURE__ */ new Map();
	const caseRoles = [];
	const safetyDecisions = [];
	const rolesByAddress = /* @__PURE__ */ new Map();
	const seedAddresses = new Set(seeds.map((seed) => seed.address));
	const victimAddresses = new Set(seeds.filter((seed) => seed.role === "victim").map((seed) => seed.address));
	const exchangeDepositAddresses = new Set(edges.filter((edge) => edge.relation === "terminal_exchange").map((edge) => edge.src).filter((address) => !seedAddresses.has(address) && !victimAddresses.has(address)));
	const terminalPoints = [];
	const exchangeDeposits = [];
	const investigationHints = [];
	for (const seed of seeds) {
		pushCaseRole(caseRoles, {
			address: seed.address,
			role: seed.role
		});
		addRole(rolesByAddress, seed.address, seed.role);
		if (seed.role === "victim") pushSafetyDecision(safetyDecisions, {
			address: seed.address,
			decision: "do_not_label_victim_seed",
			reason: "Victim/source addresses are protected case roles, not risky actors by default."
		});
		else mergeCandidate(candidates, makeCandidate(seed.address, "scam_seed", {
			seed_address: seed.address,
			seed_role: seed.role,
			reason: "Operator supplied this address as a known scammer seed."
		}, 1, "promote_confirmed"));
	}
	for (const edge of edges) {
		if (edge.relation === "deposit_cluster_inflow") {
			if (seedAddresses.has(edge.src) || victimAddresses.has(edge.src) || exchangeDepositAddresses.has(edge.src)) continue;
			if (edge.src_labels.length > 0) {
				pushCaseRole(caseRoles, {
					address: edge.src,
					role: "continue_from_address",
					seed_address: edge.seed_address,
					seed_role: edge.seed_role
				});
				addRole(rolesByAddress, edge.src, "continue_from_address");
				investigationHints.push({
					address: edge.src,
					hint_type: "generic_labeled_cluster_member",
					labels: edge.src_labels,
					reason: "Generic labels are preserved as context, but the address shares an exchange-deposit inflow cluster with the scam topology.",
					seed_address: edge.seed_address
				});
				pushSafetyDecision(safetyDecisions, {
					address: edge.src,
					decision: "context_only_generic_labeled_cluster_member",
					reason: "Generic non-exchange labels stop automatic scam labeling; investigate manually if this context should continue.",
					labels: edge.src_labels,
					seed_address: edge.seed_address
				});
				continue;
			}
			pushCaseRole(caseRoles, {
				address: edge.src,
				role: "laundering_intermediate",
				seed_address: edge.seed_address,
				seed_role: edge.seed_role
			});
			addRole(rolesByAddress, edge.src, "laundering_intermediate");
			mergeCandidate(candidates, makeCandidate(edge.src, "laundering_intermediate", edgeEvidence(edge, "Address sends into an exchange-deposit cluster reached from a known scam topology seed."), edge.seed_role === "scammer" ? .78 : .64, "review_required"));
			continue;
		}
		if (edge.relation === "terminal_exchange") {
			const exchangeNames = exchangeNamesFromLabels(edge.dst_labels);
			const exchangeDeposit = {
				deposit_address: edge.src,
				exchange_address: edge.dst,
				exchange_names: exchangeNames,
				exchange_labels: edge.dst_labels,
				amount_sum: edge.amount_sum,
				amount_usd_sum: edge.amount_usd_sum,
				tx_count: edge.tx_count,
				hop: edge.hop,
				graph_scope: edge.graph_scope,
				topology_graph: edge.topology_graph,
				scope_membership: edge.scope_membership,
				seed_address: edge.seed_address,
				seed_role: edge.seed_role,
				first_seen_timestamp: edge.first_seen_timestamp,
				last_seen_timestamp: edge.last_seen_timestamp,
				first_tx_id: edge.first_tx_id,
				last_tx_id: edge.last_tx_id
			};
			pushCaseRole(caseRoles, {
				address: edge.dst,
				role: "exchange_endpoint",
				seed_address: edge.seed_address,
				seed_role: edge.seed_role
			});
			addRole(rolesByAddress, edge.dst, "exchange_endpoint");
			terminalPoints.push({
				address: edge.dst,
				terminal_type: "exchange_endpoint",
				source_address: edge.src,
				deposit_address: edge.src,
				exchange_address: edge.dst,
				exchange_names: exchangeNames,
				exchange_labels: edge.dst_labels,
				seed_address: edge.seed_address,
				graph_scope: edge.graph_scope,
				topology_graph: edge.topology_graph,
				scope_membership: edge.scope_membership
			});
			if (!exchangeDeposits.some((deposit) => deposit.deposit_address === exchangeDeposit.deposit_address && deposit.exchange_address === exchangeDeposit.exchange_address && deposit.seed_address === exchangeDeposit.seed_address && deposit.seed_role === exchangeDeposit.seed_role)) exchangeDeposits.push(exchangeDeposit);
			pushSafetyDecision(safetyDecisions, {
				address: edge.dst,
				decision: "do_not_label_exchange_endpoint",
				reason: "Exchange endpoints are terminal service context, not scam label candidates.",
				seed_address: edge.seed_address
			});
			if (!seedAddresses.has(edge.src) && !victimAddresses.has(edge.src)) {
				pushCaseRole(caseRoles, {
					address: edge.src,
					role: "exchange_deposit_candidate",
					seed_address: edge.seed_address,
					seed_role: edge.seed_role
				});
				addRole(rolesByAddress, edge.src, "exchange_deposit_candidate");
				mergeCandidate(candidates, makeCandidate(edge.src, "exchange_deposit_candidate", edgeEvidence(edge, "Address is the penultimate hop before an exchange endpoint."), edge.seed_role === "scammer" ? .8 : .68, "review_required"));
			}
			continue;
		}
		if (edge.relation === "context_boundary") {
			pushCaseRole(caseRoles, {
				address: edge.dst,
				role: "context_boundary",
				seed_address: edge.seed_address,
				seed_role: edge.seed_role
			});
			addRole(rolesByAddress, edge.dst, "context_boundary");
			terminalPoints.push({
				address: edge.dst,
				terminal_type: "context_boundary",
				source_address: edge.src,
				labels: edge.dst_labels,
				seed_address: edge.seed_address,
				graph_scope: edge.graph_scope,
				scope_membership: edge.scope_membership
			});
			investigationHints.push({
				address: edge.dst,
				hint_type: "generic_labeled_context",
				labels: edge.dst_labels,
				reason: "Non-exchange labels are context hints only and stop automatic scam traversal.",
				seed_address: edge.seed_address
			});
			pushSafetyDecision(safetyDecisions, {
				address: edge.dst,
				decision: "context_only_generic_labeled_node",
				reason: "Generic non-exchange labels are not hard-coded scam infrastructure classes.",
				labels: edge.dst_labels,
				seed_address: edge.seed_address
			});
			continue;
		}
		if (seedAddresses.has(edge.dst) || victimAddresses.has(edge.dst) || exchangeDepositAddresses.has(edge.dst)) continue;
		pushCaseRole(caseRoles, {
			address: edge.dst,
			role: "laundering_intermediate",
			seed_address: edge.seed_address,
			seed_role: edge.seed_role
		});
		addRole(rolesByAddress, edge.dst, "laundering_intermediate");
		mergeCandidate(candidates, makeCandidate(edge.dst, "laundering_intermediate", edgeEvidence(edge, "Address appears on an outward path from a known scam topology seed."), edge.seed_role === "scammer" ? .85 : .72, "review_required"));
	}
	return {
		labelCandidates: [...candidates.values()].sort((a, b) => b.confidence_score - a.confidence_score || a.address.localeCompare(b.address)),
		caseRoles,
		safetyDecisions,
		rolesByAddress,
		intermediaries: [...new Set(caseRoles.filter((role) => role.role === "laundering_intermediate").map((role) => role.address))],
		terminalPoints,
		exchangeDeposits,
		investigationHints
	};
}
function mergeLabels(existing, next) {
	return [...new Set([...stringArray(existing), ...next])];
}
function primaryFlowEdges(edges) {
	return edges.filter((edge) => edge.relation !== "deposit_cluster_inflow");
}
function depositClusterEdges(edges) {
	return edges.filter((edge) => edge.relation === "deposit_cluster_inflow");
}
function shortestPathFromSeed(seedAddress, targetAddress, edges) {
	if (seedAddress === targetAddress) return [seedAddress];
	const adjacency = /* @__PURE__ */ new Map();
	for (const edge of edges) {
		const destinations = adjacency.get(edge.src) ?? [];
		destinations.push(edge.dst);
		adjacency.set(edge.src, destinations);
	}
	const queue = [seedAddress];
	const parent = new Map([[seedAddress, null]]);
	for (let index = 0; index < queue.length; index += 1) {
		const current = queue[index];
		for (const next of adjacency.get(current) ?? []) {
			if (parent.has(next)) continue;
			parent.set(next, current);
			if (next === targetAddress) {
				const path = [targetAddress];
				let cursor = current;
				while (cursor) {
					path.push(cursor);
					cursor = parent.get(cursor);
				}
				return path.reverse();
			}
			queue.push(next);
		}
	}
	return [seedAddress, targetAddress];
}
function scamLabelsByAddress(facts) {
	const labels = Array.isArray(facts["scam_labels"]) ? facts["scam_labels"] : [];
	const result = /* @__PURE__ */ new Map();
	for (const label of labels) {
		if (!label || typeof label !== "object" || Array.isArray(label)) continue;
		const record = label;
		const address = stringValue(record["address"]);
		const confidence = numberValue$1(record["confidence"]);
		if (!address || confidence === void 0) continue;
		result.set(address, {
			address,
			scam: true,
			confidence,
			source: "scam_topology",
			source_victim_address: stringValue(record["source_victim_address"]) ?? "",
			source_incident_timestamp_ms: numberValue$1(record["source_incident_timestamp_ms"]) ?? 0
		});
	}
	return result;
}
function buildGraph(seeds, edges, rolesByAddress, facts) {
	const nodesById = /* @__PURE__ */ new Map();
	const primaryEdges = primaryFlowEdges(edges);
	const clusterEdges = depositClusterEdges(edges);
	const scamLabels = scamLabelsByAddress(facts);
	for (const seed of seeds) nodesById.set(seed.address, {
		id: seed.address,
		address: seed.address,
		node_type: "address",
		roles: [...rolesByAddress.get(seed.address) ?? new Set([seed.role])],
		flow_in_usd: 0,
		flow_out_usd: 0
	});
	const mergeNode = (address, labels, roles = []) => {
		const existing = nodesById.get(address) ?? {
			id: address,
			address,
			node_type: "address",
			flow_in_usd: 0,
			flow_out_usd: 0
		};
		const addressRoles = [...new Set([
			...stringArray(existing["roles"]),
			...[...rolesByAddress.get(address) ?? []],
			...roles
		])];
		const scamLabel = scamLabels.get(address);
		nodesById.set(address, {
			...existing,
			labels: mergeLabels(existing["labels"], labels),
			roles: addressRoles,
			...scamLabel ? {
				scam: true,
				scam_confidence: scamLabel.confidence,
				scam_source: scamLabel.source
			} : {}
		});
		return nodesById.get(address);
	};
	const addFlowTotals = (address, direction, amount) => {
		const node = nodesById.get(address) ?? mergeNode(address, []);
		const key = direction === "in" ? "flow_in_usd" : "flow_out_usd";
		node[key] = (numberValue$1(node[key]) ?? 0) + amount;
		nodesById.set(address, node);
	};
	for (const edge of edges) {
		const src = mergeNode(edge.src, edge.src_labels, edge.relation === "deposit_cluster_inflow" ? ["lead"] : []);
		const dstRoles = edge.relation === "terminal_exchange" ? ["exchange"] : edge.relation === "context_boundary" ? ["context_boundary"] : [];
		const dst = mergeNode(edge.dst, edge.dst_labels, dstRoles);
		if (edge.src_is_exchange) src["is_exchange"] = true;
		if (edge.dst_is_exchange) dst["is_exchange"] = true;
		const amount = edge.amount_usd_sum ?? edge.amount_sum ?? 0;
		addFlowTotals(edge.src, "out", amount);
		addFlowTotals(edge.dst, "in", amount);
	}
	const deposits = primaryEdges.filter((edge) => edge.relation === "terminal_exchange").map((edge) => ({
		address: edge.src,
		exchangeAddress: edge.dst,
		exchangeLabels: edge.dst_labels,
		exchangeNames: exchangeNamesFromLabels(edge.dst_labels),
		amount_sum: edge.amount_sum,
		amount_usd_sum: edge.amount_usd_sum,
		hops: edge.hop,
		path: shortestPathFromSeed(edge.seed_address ?? seeds[0]?.address ?? edge.src, edge.dst, primaryEdges),
		seed_role: edge.seed_role,
		seed_address: edge.seed_address
	}));
	const reverseLeads = clusterEdges.map((edge) => ({
		address: edge.src,
		labels: edge.src_labels,
		deposit_address: edge.dst,
		amount_usd: edge.amount_usd_sum ?? edge.amount_sum,
		degree_in: void 0,
		degree_out: void 0,
		total_volume_usd: edge.amount_usd_sum,
		reason: "deposit_cluster_inflow",
		seed_role: edge.seed_role,
		seed_address: edge.seed_address,
		first_seen_timestamp: edge.first_seen_timestamp,
		last_seen_timestamp: edge.last_seen_timestamp,
		tx_count: edge.tx_count
	}));
	return require_graph_normalizer.normalizeGraphPayload({
		schema: "chain-insights.graph.v1",
		nodes: [...nodesById.values()],
		edges: [...primaryEdges.map((edge) => ({
			source: edge.src,
			target: edge.dst,
			edge_type: "flows_to",
			relation: edge.relation,
			hop: edge.hop,
			wave_index: edge.wave_index,
			graph_scope: edge.graph_scope,
			topology_graph: edge.topology_graph,
			activity_policy: edge.activity_policy,
			scope_membership: edge.scope_membership,
			seed_address: edge.seed_address,
			seed_role: edge.seed_role,
			usd_amount: edge.amount_usd_sum ?? edge.amount_sum,
			amount_sum: edge.amount_sum,
			amount_usd_sum: edge.amount_usd_sum,
			tx_count: edge.tx_count ?? 0,
			first_seen_timestamp: edge.first_seen_timestamp,
			last_seen_timestamp: edge.last_seen_timestamp,
			first_tx_id: edge.first_tx_id,
			last_tx_id: edge.last_tx_id,
			expands_frontier: edge.expands_frontier,
			converges_to_seen_node: edge.converges_to_seen_node,
			activity_threshold_timestamp: edge.activity_threshold_timestamp,
			src_arrival_timestamp: edge.src_arrival_timestamp,
			dst_arrival_timestamp: edge.dst_arrival_timestamp,
			terminal_exchange: edge.relation === "terminal_exchange",
			context_boundary: edge.relation === "context_boundary"
		})), ...reverseLeads.map((lead) => ({
			source: lead.address,
			target: lead.deposit_address,
			edge_type: "flows_to",
			relation: "deposit_cluster_inflow",
			usd_amount: lead.amount_usd ?? 0,
			amount_sum: lead.amount_usd ?? 0,
			tx_count: lead.tx_count ?? 0,
			direction: "reverse_1hop_lead"
		}))],
		flows: primaryEdges.map((edge) => ({
			hop: edge.hop,
			src: edge.src,
			dst: edge.dst,
			relation: edge.relation,
			graph_scope: edge.graph_scope,
			topology_graph: edge.topology_graph,
			activity_policy: edge.activity_policy,
			wave_index: edge.wave_index,
			scope_membership: edge.scope_membership,
			seed_address: edge.seed_address,
			seed_role: edge.seed_role,
			amount_sum: edge.amount_sum,
			amount_usd_sum: edge.amount_usd_sum,
			tx_count: edge.tx_count,
			first_seen_timestamp: edge.first_seen_timestamp,
			last_seen_timestamp: edge.last_seen_timestamp,
			first_tx_id: edge.first_tx_id,
			last_tx_id: edge.last_tx_id,
			expands_frontier: edge.expands_frontier,
			converges_to_seen_node: edge.converges_to_seen_node,
			terminal_exchange: edge.relation === "terminal_exchange",
			context_boundary: edge.relation === "context_boundary"
		})),
		deposits,
		source_matches: [],
		reverse_leads: reverseLeads,
		edge_anchors: [],
		metadata: {
			source: "scam_topology",
			network: facts["network"],
			victim_address: facts["victim_address"],
			incident_timestamp_ms: facts["incident_timestamp_ms"],
			scam_label_count: Array.isArray(facts["scam_labels"]) ? facts["scam_labels"].length : 0,
			label_candidate_count: Array.isArray(facts["label_candidates"]) ? facts["label_candidates"].length : 0,
			topology_edge_count: edges.length,
			primary_flow_count: primaryEdges.length,
			reverse_lead_count: reverseLeads.length,
			primary_activity_policy: "node_relative",
			generated_at: (/* @__PURE__ */ new Date()).toISOString()
		}
	});
}
function makeScamLabels(candidates, victimAddress, incidentTimestampMs) {
	return candidates.filter((candidate) => candidate.address_subtype !== "scam_seed").map((candidate) => ({
		address: candidate.address,
		scam: true,
		confidence: candidate.confidence_score,
		source: "scam_topology",
		source_victim_address: victimAddress,
		source_incident_timestamp_ms: incidentTimestampMs
	}));
}
function summarize(network, victimAddress, incidentTimestampMs, candidates, scamLabels, safetyDecisions, topologyEdges, terminalPoints) {
	const review = candidates.filter((candidate) => candidate.promotion_status === "review_required").length;
	return [
		`Scam topology complete for ${network}`,
		"",
		"Topology graph: live_topology",
		`Victim/source seed: ${victimAddress}`,
		`Incident timestamp ms: ${incidentTimestampMs}`,
		`Topology edges: ${topologyEdges.length}.`,
		`Terminal points: ${terminalPoints.length}.`,
		`Scam labels: ${scamLabels.length}.`,
		`Review candidates: ${candidates.length} (${review} review_required).`,
		`Safety decisions: ${safetyDecisions.length}.`,
		"",
		"Policy: victims, exchange endpoints, and generic labeled context nodes are not automatic scam labels."
	].join("\n");
}
function csvCell(value) {
	if (value === void 0 || value === null) return "\"\"";
	if (Array.isArray(value) || typeof value === "object" && value !== null) return JSON.stringify(JSON.stringify(value));
	return JSON.stringify(String(value));
}
function labelCandidatesCsv(candidates) {
	const rows = [[
		"address",
		"label",
		"address_type",
		"address_subtype",
		"trust_level",
		"risk_level",
		"confidence_score",
		"promotion_status",
		"source",
		"evidence_count"
	].join(",")];
	for (const candidate of candidates) rows.push([
		candidate.address,
		candidate.label,
		candidate.address_type,
		candidate.address_subtype,
		candidate.trust_level,
		candidate.risk_level,
		candidate.confidence_score,
		candidate.promotion_status,
		candidate.source,
		candidate.evidence.length
	].map(csvCell).join(","));
	return rows.join("\n") + "\n";
}
function buildScamTopologyReport(facts, files) {
	return [
		`# Scam Topology: ${facts.victim_address}`,
		"",
		`Network: \`${facts.network}\``,
		`Incident timestamp ms: \`${facts.incident_timestamp_ms}\``,
		`Activity policy: \`${facts.activity_policy_mode}\``,
		`Graph: \`${files.graph}\``,
		`Label candidates CSV: \`${files.labelCandidates}\``,
		"",
		"## Summary",
		"",
		`- Topology edges: ${facts.topology_edges.length}`,
		`- Terminal points: ${facts.terminal_points.length}`,
		`- Exchange deposits: ${facts.exchange_deposits.length}`,
		`- Scam labels: ${facts.scam_labels.length}`,
		`- Review candidates: ${facts.label_candidates.length}`,
		`- Safety decisions: ${facts.safety_decisions.length}`,
		"",
		"## Exchange Deposits",
		"",
		"| Deposit | Exchange | Names | Hop | amount_sum | tx_count |",
		"|---|---|---|---:|---:|---:|",
		...facts.exchange_deposits.map((entry) => {
			return `| \`${stringValue(entry["deposit_address"]) ?? ""}\` | \`${stringValue(entry["exchange_address"]) ?? ""}\` | ${stringArray(entry["exchange_names"]).join(", ") || ""} | ${entry["hop"] ?? ""} | ${entry["amount_sum"] ?? ""} | ${entry["tx_count"] ?? ""} |`;
		}),
		"",
		"## Label Candidates",
		"",
		"| Address | Subtype | Confidence | Status |",
		"|---|---|---:|---|",
		...facts.label_candidates.map((candidate) => `| \`${candidate.address}\` | ${candidate.address_subtype} | ${candidate.confidence_score} | ${candidate.promotion_status} |`),
		""
	].join("\n") + "\n";
}
function scamTopologyCompactEvidence(facts) {
	return {
		schema: "chain-insights.scam_topology_evidence.v1",
		source: "scam_topology",
		network: facts.network,
		victim_address: facts.victim_address,
		incident_timestamp_ms: facts.incident_timestamp_ms,
		topology_graphs: facts.topology_graphs,
		primary_activity_policy: facts.primary_activity_policy,
		activity_policy_mode: facts.activity_policy_mode,
		topology_edge_count: facts.topology_edges.length,
		terminal_points: facts.terminal_points,
		exchange_deposits: facts.exchange_deposits,
		scam_labels: facts.scam_labels,
		label_candidates: facts.label_candidates,
		safety_decisions: facts.safety_decisions
	};
}
async function writeScamTopologyCaseArtifacts(facts, graphData) {
	const paths = require_output_root.workspaceOutputPaths();
	await ensureScamTopologyDirs(paths);
	const slug = `${(/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}_scam-topology_${sanitizeSegment(facts.victim_address.slice(0, 16))}`;
	const compactEvidencePath = node_path.default.join(paths.reportTablesRoot, `${slug}.compact-evidence.json`);
	const graphPath = node_path.default.join(paths.reportGraphsRoot, `${slug}.graph.json`);
	const graphHtmlPath = node_path.default.join(paths.reportsRoot, `${slug}.graph.html`);
	const labelCandidatesPath = node_path.default.join(paths.reportTablesRoot, `${slug}.label-candidates.csv`);
	const reportPath = node_path.default.join(paths.reportsRoot, `${slug}.scam-topology-report.md`);
	const { generateInlineGraphHtml } = await Promise.resolve().then(() => require("./html-generator-CAv81IWH.cjs")).then((n) => n.html_generator_exports);
	const files = {
		compactEvidence: compactEvidencePath,
		graph: graphPath,
		graphHtml: graphHtmlPath,
		labelCandidates: labelCandidatesPath,
		report: reportPath
	};
	await (0, node_fs_promises.writeFile)(compactEvidencePath, JSON.stringify(scamTopologyCompactEvidence(facts), null, 2) + "\n", { mode: 384 });
	await (0, node_fs_promises.writeFile)(graphPath, JSON.stringify(graphData, null, 2) + "\n", { mode: 384 });
	await (0, node_fs_promises.writeFile)(graphHtmlPath, generateInlineGraphHtml(graphData), { mode: 384 });
	await (0, node_fs_promises.writeFile)(labelCandidatesPath, labelCandidatesCsv(facts.label_candidates), { mode: 384 });
	await (0, node_fs_promises.writeFile)(reportPath, buildScamTopologyReport(facts, files), { mode: 384 });
	return files;
}
function validateNonNegativeNumber(value, name) {
	if (value === void 0) return void 0;
	if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
	return value;
}
function validateActivityPolicyMode(value) {
	if (value === void 0 || value === null || value === "") return "node_relative_only";
	if (value === "node_relative_only" || value === "global_incident_only") return value;
	throw new Error("activity_policy must be one of: node_relative_only, global_incident_only");
}
function activityPolicyForMode(mode) {
	return mode === "global_incident_only" ? "global_incident" : "node_relative";
}
async function scamTopology(remoteClient, config, options) {
	const network = options.network.trim();
	const legacyOptions = options;
	const victimAddresses = parseAddressList$1(options.victimAddress ?? legacyOptions.victimAddresses);
	const scammerAddresses = parseAddressList$1(legacyOptions.scammerAddresses);
	const incidentTimestampMs = validateNonNegativeNumber(options.incidentTimestampMs, "incident_timestamp_ms");
	const maxHops = clampInt(options.maxHops, SCAM_TOPOLOGY_DEFAULT_MAX_HOPS, 1, SCAM_TOPOLOGY_MAX_HOPS);
	const perAddressLimit = SCAM_TOPOLOGY_FRONTIER_LIMIT;
	const minAmountSum = void 0;
	const activityPolicyMode = validateActivityPolicyMode(options.activityPolicyMode);
	const primaryActivityPolicy = activityPolicyForMode(activityPolicyMode);
	const caseId = options.caseId ?? legacyOptions.caseId;
	if (!network) throw new Error("network is required");
	if (legacyOptions.scope !== void 0) throw new Error("scope is no longer accepted; scam_topology always runs the victim incident topology");
	if (legacyOptions.sinceTimestampMs !== void 0) throw new Error("since_timestamp_ms is no longer accepted; use incident_timestamp_ms");
	if (legacyOptions.perAddressLimit !== void 0) throw new Error("per_address_limit is no longer accepted; scam_topology uses its internal bounded frontier");
	if (legacyOptions.minAmountSum !== void 0) throw new Error("min_amount_sum is no longer accepted; scam_topology does not amount-filter scam topology expansion");
	if (scammerAddresses.length > 0) throw new Error("scammer_addresses is no longer accepted; scam_topology starts from a victim incident");
	if (victimAddresses.length === 0) throw new Error("victim_address is required");
	if (victimAddresses.length !== 1) throw new Error("victim_address must contain exactly one address");
	if (incidentTimestampMs === void 0) throw new Error("incident_timestamp_ms is required");
	const victimAddress = victimAddresses[0];
	const seeds = [{
		address: victimAddress,
		role: "victim"
	}];
	const primaryRunWithClusters = await expandDepositClusters(remoteClient, network, await runDirectedTraversal(remoteClient, network, seeds, "incident", primaryActivityPolicy, maxHops, perAddressLimit, minAmountSum, incidentTimestampMs), minAmountSum);
	const runs = [primaryRunWithClusters];
	const topologyEdges = primaryRunWithClusters.edges;
	const classification = classifyTopology(seeds, topologyEdges);
	const labelCandidates = classification.labelCandidates;
	const scamLabels = makeScamLabels(labelCandidates, victimAddress, incidentTimestampMs);
	const facts = {
		network,
		victim_address: victimAddress,
		incident_timestamp_ms: incidentTimestampMs,
		topology_graphs: ["live_topology"],
		primary_activity_policy: primaryActivityPolicy,
		activity_policy_mode: activityPolicyMode,
		topology_edges: topologyEdges,
		intermediaries: classification.intermediaries,
		terminal_points: classification.terminalPoints,
		exchange_deposits: classification.exchangeDeposits,
		investigation_hints: classification.investigationHints,
		scam_labels: scamLabels,
		label_candidates: labelCandidates,
		case_roles: classification.caseRoles,
		safety_decisions: classification.safetyDecisions,
		infrastructure_anchors: [],
		infrastructure_flows: [],
		runs: runs.map((run) => ({
			graph_scope: run.graphScope,
			topology_graph: run.topologyGraph,
			activity_policy: run.activityPolicy,
			edge_count: run.edges.length,
			primary: run.activityPolicy === primaryActivityPolicy,
			max_hops: maxHops,
			frontier_limit: perAddressLimit,
			frontier_source_limit_per_hop: SCAM_TOPOLOGY_MAX_FRONTIER_SOURCES_PER_HOP,
			skipped_query_errors: run.skippedQueryErrors
		}))
	};
	const graphData = buildGraph(seeds, topologyEdges, classification.rolesByAddress, facts);
	const summaryText = summarize(network, victimAddress, incidentTimestampMs, labelCandidates, scamLabels, classification.safetyDecisions, topologyEdges, classification.terminalPoints);
	if (caseId) {
		const files = await writeScamTopologyCaseArtifacts(facts, graphData);
		const { EvidenceStore } = await Promise.resolve().then(() => require("./cases-CDcNU91B.cjs"));
		await EvidenceStore.append(caseId, {
			source: "scam_topology",
			queryParams: [
				`network=${network}`,
				`victim_address=${victimAddress}`,
				`incident_timestamp_ms=${incidentTimestampMs}`,
				`max_hops=${maxHops}`,
				`activity_policy=${activityPolicyMode}`
			].filter(Boolean).join(" "),
			content: JSON.stringify({
				schema: "chain-insights.evidence_pointer.v1",
				source: "scam_topology",
				network,
				victim_address: victimAddress,
				incident_timestamp_ms: incidentTimestampMs,
				topology_graphs: facts.topology_graphs,
				primary_activity_policy: primaryActivityPolicy,
				activity_policy_mode: activityPolicyMode,
				files,
				facts: {
					topology_edges: topologyEdges.length,
					terminal_points: classification.terminalPoints.length,
					exchange_deposits: classification.exchangeDeposits.length,
					scam_labels: scamLabels.length,
					label_candidates: labelCandidates.length,
					safety_decisions: classification.safetyDecisions.length
				}
			}, null, 2)
		});
	}
	return {
		summaryText,
		structuredContent: {
			schema: "chain-insights.result.v1",
			tool: "scam_topology",
			facts,
			hint: "Use scam_labels as ML-ready scam flags. Review label_candidates and safety_decisions before promoting addresses into core_address_labels."
		},
		graphData
	};
}
//#endregion
//#region src/investigation/public-tools.ts
const GRAPH_QUERY_BATCH_TIMEOUT_SECONDS = 120;
const GRAPH_QUERY_BATCH_REQUEST_TIMEOUT_MS = 300 * 1e3;
function escapeCypherString(value) {
	return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}
function textFromToolResult(result) {
	return (result.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join("\n");
}
function parseGraphBatchResult(result) {
	const text = textFromToolResult(result).trim();
	if (!text) throw new Error("graph_query_batch returned no text content");
	const parsed = JSON.parse(text);
	if (!parsed.facts?.queries) throw new Error("graph_query_batch response did not include facts.queries");
	return parsed;
}
function topologyGraphQuery(query) {
	const trimmed = query.trim();
	if (/^USE\s+/i.test(trimmed)) return trimmed;
	return `USE live_topology ${trimmed}`;
}
function collectQueryFailure(failures, id, error) {
	failures.push({
		id,
		error: error || "unknown error"
	});
}
function optionalResultsFor(batch, id, failures) {
	const query = batch.facts?.queries?.find((entry) => entry.id === id);
	if (!query) return [];
	if (query.ok === false) {
		collectQueryFailure(failures, id, query.error);
		return [];
	}
	return query.results ?? [];
}
function optionalResultsWithPrefix(batch, prefix, failures) {
	return (batch.facts?.queries ?? []).filter((entry) => entry.id?.startsWith(prefix)).flatMap((entry) => {
		if (entry.ok === false) {
			collectQueryFailure(failures, entry.id ?? prefix, entry.error);
			return [];
		}
		return entry.results ?? [];
	});
}
async function callGraphBatch(remoteClient, network, queries) {
	const result = await remoteClient.callTool({
		name: "graph_query_batch",
		arguments: {
			network,
			queries: queries.map((query) => ({
				...query,
				query: topologyGraphQuery(query.query)
			})),
			per_query_timeout_seconds: GRAPH_QUERY_BATCH_TIMEOUT_SECONDS
		}
	}, void 0, {
		timeout: GRAPH_QUERY_BATCH_REQUEST_TIMEOUT_MS,
		maxTotalTimeout: GRAPH_QUERY_BATCH_REQUEST_TIMEOUT_MS
	});
	if (result.isError) throw new Error(textFromToolResult(result) || "graph_query_batch failed");
	return parseGraphBatchResult(result);
}
function parseAddressList(value) {
	return (Array.isArray(value) ? value.join(",") : value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
}
function graphArray(graphData, key) {
	const value = graphData[key];
	return Array.isArray(value) ? value.filter((item) => typeof item === "object" && item !== null && !Array.isArray(item)) : [];
}
function addressProfileQuery(address) {
	return {
		id: "address_profile",
		query: [
			`MATCH (a:Address {address: "${escapeCypherString(address)}"})`,
			"RETURN a.address AS address, a.labels AS display_labels, a.labels AS system_labels, a.address_type AS address_type, a.address_subtypes AS address_subtypes, a.is_exchange AS is_exchange, a.confluence_score AS confluence_score, a.ml_risk_score AS ml_risk_score, a.ml_risk_level AS ml_risk_level, a.ml_top_drivers AS ml_top_drivers, a.ml_pattern_summary AS ml_pattern_summary, a.risk_score AS risk_score, a.risk_level AS risk_level, a.pattern_flags AS pattern_flags, a.ml_pagerank AS ml_pagerank, a.ml_betweenness AS ml_betweenness, a.ml_community_id AS ml_community_id",
			"LIMIT 1"
		].join(" ")
	};
}
function addressFeatureQuery(address) {
	return {
		id: "address_feature",
		query: [
			"USE facts",
			`MATCH (a:Address {address: "${escapeCypherString(address)}"})-[:HAS_FEATURE]->(feature:AddressFeature)`,
			"RETURN feature.degree_in AS degree_in, feature.degree_out AS degree_out, feature.degree_total AS degree_total, feature.tx_in_count AS tx_in_count, feature.tx_out_count AS tx_out_count, feature.tx_total_count AS tx_total_count, feature.total_volume_usd AS total_volume_usd, feature.total_in_usd AS total_in_usd, feature.total_out_usd AS total_out_usd, feature.net_flow_usd AS net_flow_usd, feature.first_activity_timestamp AS first_activity_timestamp, feature.last_activity_timestamp AS last_activity_timestamp, feature.activity_span_days AS activity_span_days, feature.active_days AS active_days",
			"LIMIT 1"
		].join(" ")
	};
}
function addressRiskScoreQuery(address) {
	return {
		id: "address_risk_score",
		query: [
			"USE facts",
			`MATCH (a:Address {address: "${escapeCypherString(address)}"})-[:HAS_RISK_SCORE]->(risk:RiskScore)`,
			"RETURN risk.risk_score AS risk_score, risk.window_days AS risk_window_days, risk.processing_date AS risk_processing_date, risk.shap_top_features AS shap_top_features",
			"LIMIT 1"
		].join(" ")
	};
}
function flowEdgeMap(variableName) {
	return `{amount_sum: ${variableName}.amount_sum, amount_usd_sum: ${variableName}.amount_usd_sum, tx_count: ${variableName}.tx_count, first_tx_id: ${variableName}.first_tx_id, last_tx_id: ${variableName}.last_tx_id}`;
}
function pathNodeMap(variableName) {
	return `{address: ${variableName}.address, labels: ${variableName}.labels, system_labels: ${variableName}.labels, address_type: ${variableName}.address_type, address_subtypes: ${variableName}.address_subtypes}`;
}
function exchangeOutflowQueries(address) {
	return Array.from({ length: 3 }, (_, index) => exchangeOutflowQueryAtDepth(address, index + 1));
}
function exchangeOutflowQueryAtDepth(address, depth) {
	const intermediateVariables = Array.from({ length: Math.max(depth - 1, 0) }, (_, index) => `n${index + 1}`);
	const nodeVariables = [
		"a",
		...intermediateVariables,
		"exchange"
	];
	const edgeVariables = Array.from({ length: depth }, (_, index) => `r${index + 1}`);
	const relationshipChain = edgeVariables.map((edgeVariable, index) => {
		return `-[${edgeVariable}:FLOWS_TO]->(${index === edgeVariables.length - 1 ? "exchange" : intermediateVariables[index]}:Address)`;
	}).join("");
	const intermediatePredicates = intermediateVariables.map((nodeVariable) => `${nodeVariable}.is_exchange IS NULL`);
	const depositVariable = nodeVariables[nodeVariables.length - 2];
	const terminalEdgeVariable = edgeVariables[edgeVariables.length - 1];
	return {
		id: `exchange_outflows_${depth}`,
		query: [
			`MATCH (a:Address {address: "${escapeCypherString(address)}"})${relationshipChain}`,
			`WHERE a <> exchange AND exchange.is_exchange IS NOT NULL${intermediatePredicates.length > 0 ? ` AND ${intermediatePredicates.join(" AND ")}` : ""}`,
			`RETURN "outflow" AS direction, exchange.address AS exchange_address, exchange.labels AS exchange_display_labels, exchange.labels AS exchange_system_labels, exchange.address_type AS exchange_address_type, exchange.address_subtypes AS exchange_address_subtypes, ${depositVariable}.address AS deposit_address, ${depth} AS hops, ${terminalEdgeVariable}.amount_sum AS amount_sum, ${terminalEdgeVariable}.amount_usd_sum AS amount_usd_sum, ${terminalEdgeVariable}.tx_count AS tx_count, [${nodeVariables.map((nodeVariable) => `${nodeVariable}.address`).join(", ")}] AS addresses, [${nodeVariables.map(pathNodeMap).join(", ")}] AS path_nodes, [${edgeVariables.map(flowEdgeMap).join(", ")}] AS edge_props`,
			"ORDER BY hops ASC",
			"LIMIT 200"
		].join(" ")
	};
}
function exchangeInflowQueries(address) {
	return Array.from({ length: 3 }, (_, index) => exchangeInflowQueryAtDepth(address, index + 1));
}
function exchangeInflowQueryAtDepth(address, depth) {
	const intermediateVariables = Array.from({ length: Math.max(depth - 1, 0) }, (_, index) => `n${index + 1}`);
	const nodeVariables = [
		"exchange",
		...intermediateVariables,
		"a"
	];
	const edgeVariables = Array.from({ length: depth }, (_, index) => `r${index + 1}`);
	const relationshipChain = edgeVariables.map((edgeVariable, index) => {
		return `-[${edgeVariable}:FLOWS_TO]->(${index === edgeVariables.length - 1 ? "a" : intermediateVariables[index]}:Address)`;
	}).join("");
	const intermediatePredicates = intermediateVariables.map((nodeVariable) => `${nodeVariable}.is_exchange IS NULL`);
	const withdrawalVariable = nodeVariables[1];
	const terminalEdgeVariable = edgeVariables[edgeVariables.length - 1];
	return {
		id: `exchange_inflows_${depth}`,
		query: [
			`MATCH (exchange:Address)${relationshipChain}`,
			`WHERE a.address = "${escapeCypherString(address)}" AND a <> exchange AND exchange.is_exchange IS NOT NULL${intermediatePredicates.length > 0 ? ` AND ${intermediatePredicates.join(" AND ")}` : ""}`,
			`RETURN "inflow" AS direction, exchange.address AS exchange_address, exchange.labels AS exchange_display_labels, exchange.labels AS exchange_system_labels, exchange.address_type AS exchange_address_type, exchange.address_subtypes AS exchange_address_subtypes, ${withdrawalVariable}.address AS withdrawal_address, ${depth} AS hops, ${terminalEdgeVariable}.amount_sum AS amount_sum, ${terminalEdgeVariable}.amount_usd_sum AS amount_usd_sum, ${terminalEdgeVariable}.tx_count AS tx_count, [${nodeVariables.map((nodeVariable) => `${nodeVariable}.address`).join(", ")}] AS addresses, [${nodeVariables.map(pathNodeMap).join(", ")}] AS path_nodes, [${edgeVariables.map(flowEdgeMap).join(", ")}] AS edge_props`,
			"ORDER BY hops ASC",
			"LIMIT 200"
		].join(" ")
	};
}
function connectionProbeQuery(address, compareAddress) {
	return {
		id: "connection_probe",
		query: [
			`MATCH (a:Address {address: "${escapeCypherString(address)}"})-[r:FLOWS_TO]-(b:Address {address: "${escapeCypherString(compareAddress)}"})`,
			"RETURN [a.address, b.address] AS addresses, 1 AS hops",
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
function numberValue(value) {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : void 0;
	}
}
function firstNumber(...values) {
	for (const value of values) {
		const parsed = numberValue(value);
		if (parsed !== void 0) return parsed;
	}
}
function firstString(...values) {
	for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
}
function riskLevelFromScore(score) {
	if (score >= .85) return "critical";
	if (score >= .7) return "high";
	if (score >= .4) return "medium";
	return "low";
}
function riskRecommendation(level) {
	if (level === "critical" || level === "high") return "Escalate for manual review.";
	if (level === "medium") return "Review exchange exposure and counterparties before clearing.";
	return "No stored risk signal found; continue with normal monitoring.";
}
function riskDrivers(profile, exchangeRows) {
	const drivers = [];
	const storedDrivers = stringArrayValue(profile["ml_top_drivers"]);
	if (storedDrivers?.length) drivers.push(...storedDrivers);
	const patternFlags = stringArrayValue(profile["pattern_flags"]);
	if (patternFlags?.length) drivers.push(`Pattern flags: ${patternFlags.join(", ")}`);
	const outflowCount = exchangeRows.filter((row) => row["direction"] === "outflow").length;
	const inflowCount = exchangeRows.filter((row) => row["direction"] === "inflow").length;
	if (outflowCount > 0) drivers.push(`Forward bounded search reached ${outflowCount} exchange path(s).`);
	if (inflowCount > 0) drivers.push(`Backward bounded search found ${inflowCount} source exchange path(s).`);
	return [...new Set(drivers)];
}
function terminalEdgeProperties(row) {
	const edgeProps = Array.isArray(row["edge_props"]) ? row["edge_props"] : [];
	return edgeProps[edgeProps.length - 1];
}
function enrichExchangeRows(rows) {
	return rows.map((row) => {
		const terminal = terminalEdgeProperties(row);
		if (!terminal) return row;
		return {
			...row,
			amount_sum: row["amount_sum"] ?? terminal["amount_sum"],
			amount_usd_sum: row["amount_usd_sum"] ?? terminal["amount_usd_sum"],
			tx_count: row["tx_count"] ?? terminal["tx_count"],
			first_tx_id: row["first_tx_id"] ?? terminal["first_tx_id"],
			last_tx_id: row["last_tx_id"] ?? terminal["last_tx_id"]
		};
	});
}
function riskAssessment(profile, exchangeRows) {
	const storedScore = firstNumber(profile["confluence_score"], profile["ml_risk_score"], profile["risk_score"]);
	const score = storedScore ?? (exchangeRows.length > 0 ? .4 : 0);
	const level = firstString(profile["ml_risk_level"], profile["risk_level"]) ?? riskLevelFromScore(score);
	const drivers = riskDrivers(profile, exchangeRows);
	return {
		level,
		score,
		confidence: storedScore !== void 0 || firstString(profile["ml_risk_level"], profile["risk_level"]) ? "high" : exchangeRows.length > 0 ? "medium" : "low",
		recommendation: riskRecommendation(level),
		drivers
	};
}
function formatRiskScore(score) {
	const parsed = numberValue(score);
	if (parsed === void 0) return String(score ?? "unknown");
	return Number.isInteger(parsed) ? parsed.toString() : parsed.toFixed(2);
}
function stringArrayValue(value) {
	if (Array.isArray(value)) return value.map(String);
	if (typeof value === "string" && value.trim()) return [value];
}
function restoreSystemLabels(graph, rawNodes) {
	if (!Array.isArray(graph["nodes"])) return graph;
	const labelsByAddress = new Map(rawNodes.map((node) => [typeof node["address"] === "string" ? node["address"] : typeof node["id"] === "string" ? node["id"] : "", stringArrayValue(node["system_labels"])]).filter((entry) => Boolean(entry[0]) && Array.isArray(entry[1]) && entry[1].length > 0));
	return {
		...graph,
		nodes: graph["nodes"].map((node) => {
			if (typeof node !== "object" || node === null || Array.isArray(node)) return node;
			const record = node;
			const address = typeof record["address"] === "string" ? record["address"] : typeof record["id"] === "string" ? record["id"] : "";
			const systemLabels = labelsByAddress.get(address);
			return systemLabels ? {
				...record,
				system_labels: systemLabels
			} : record;
		})
	};
}
function buildRiskGraph(address, profile, rows, network) {
	const nodes = /* @__PURE__ */ new Map();
	nodes.set(address, {
		id: address,
		address,
		node_type: "address",
		labels: stringArrayValue(profile["display_labels"]) ?? [],
		...stringArrayValue(profile["system_labels"]) ? { system_labels: stringArrayValue(profile["system_labels"]) } : {},
		...typeof profile["address_type"] === "string" ? { address_type: profile["address_type"] } : {},
		...stringArrayValue(profile["address_subtypes"]) ? { address_subtypes: stringArrayValue(profile["address_subtypes"]) } : {},
		roles: ["subject"]
	});
	const edges = [];
	const mergeNode = (entry, metadata) => {
		const existing = nodes.get(entry) ?? {
			id: entry,
			address: entry,
			node_type: "address",
			labels: []
		};
		const labels = stringArrayValue(metadata?.["labels"]) ?? existing["labels"];
		const systemLabels = stringArrayValue(metadata?.["system_labels"]) ?? existing["system_labels"];
		const addressType = typeof metadata?.["address_type"] === "string" ? metadata["address_type"] : existing["address_type"];
		const addressSubtypes = stringArrayValue(metadata?.["address_subtypes"]) ?? existing["address_subtypes"];
		nodes.set(entry, {
			...existing,
			labels,
			...systemLabels ? { system_labels: systemLabels } : {},
			...addressType ? { address_type: addressType } : {},
			...addressSubtypes ? { address_subtypes: addressSubtypes } : {}
		});
	};
	for (const row of rows) {
		const rawPath = Array.isArray(row["path"]) ? row["path"] : row["addresses"];
		const path = Array.isArray(rawPath) ? rawPath.map(String) : [];
		const pathNodes = Array.isArray(row["path_nodes"]) ? row["path_nodes"] : [];
		for (let index = 0; index < path.length; index += 1) {
			const entry = path[index];
			mergeNode(entry, pathNodes[index]);
		}
		const exchange = typeof row["exchange_address"] === "string" ? row["exchange_address"] : "";
		if (exchange) {
			const displayLabels = stringArrayValue(row["exchange_display_labels"]) ?? [];
			const systemLabels = stringArrayValue(row["exchange_system_labels"]) ?? stringArrayValue(row["exchange_labels"]) ?? [];
			nodes.set(exchange, {
				id: exchange,
				address: exchange,
				node_type: "address",
				labels: displayLabels,
				...systemLabels.length > 0 ? { system_labels: systemLabels } : {},
				...typeof row["exchange_address_type"] === "string" ? { address_type: row["exchange_address_type"] } : {},
				...stringArrayValue(row["exchange_address_subtypes"]) ? { address_subtypes: stringArrayValue(row["exchange_address_subtypes"]) } : {},
				roles: ["exchange"]
			});
		}
		for (let index = 0; index < path.length - 1; index += 1) {
			const edge = (Array.isArray(row["edge_props"]) ? row["edge_props"] : [])[index] ?? row;
			edges.push({
				source: path[index],
				target: path[index + 1],
				edge_type: "flows_to",
				usd_amount: edge["amount_usd_sum"] ?? edge["amount_sum"] ?? 0,
				amount_sum: edge["amount_sum"] ?? 0,
				tx_count: edge["tx_count"] ?? 0,
				first_tx_id: edge["first_tx_id"],
				last_tx_id: edge["last_tx_id"],
				direction: row["direction"]
			});
		}
	}
	const rawNodes = [...nodes.values()];
	return restoreSystemLabels(require_graph_normalizer.normalizeGraphPayload({
		schema: "chain-insights.graph.v1",
		nodes: rawNodes,
		edges,
		flows: [],
		edge_anchors: [],
		metadata: {
			address,
			network,
			generated_at: (/* @__PURE__ */ new Date()).toISOString()
		}
	}), rawNodes);
}
async function addressRisk(remoteClient, options) {
	const address = options.address.trim();
	const network = options.network.trim();
	const compareAddress = options.compareAddress?.trim() ?? "";
	if (!address) throw new Error("address is required");
	if (!network) throw new Error("network is required");
	const batch = await callGraphBatch(remoteClient, network, [
		addressProfileQuery(address),
		addressFeatureQuery(address),
		addressRiskScoreQuery(address),
		...exchangeOutflowQueries(address),
		...exchangeInflowQueries(address),
		...compareAddress ? [connectionProbeQuery(address, compareAddress)] : [{
			id: "connection_probe",
			query: "MATCH (n:Address {address: \"__chain_insights_noop__\"}) RETURN n.address AS noop LIMIT 0"
		}]
	]);
	const partialQueryFailures = [];
	const profile = {
		address,
		...optionalResultsFor(batch, "address_profile", partialQueryFailures)[0] ?? {},
		...optionalResultsFor(batch, "address_feature", partialQueryFailures)[0] ?? {},
		...optionalResultsFor(batch, "address_risk_score", partialQueryFailures)[0] ?? {}
	};
	const outflows = enrichExchangeRows(optionalResultsWithPrefix(batch, "exchange_outflows_", partialQueryFailures));
	const inflows = enrichExchangeRows(optionalResultsWithPrefix(batch, "exchange_inflows_", partialQueryFailures));
	const connections = compareAddress ? optionalResultsFor(batch, "connection_probe", partialQueryFailures) : [];
	const exchangeRows = [...outflows, ...inflows];
	const graphData = buildRiskGraph(address, profile, exchangeRows, network);
	const risk = riskAssessment(profile, exchangeRows);
	const lines = [
		`Address risk for ${network}:${address}`,
		"",
		`Risk: ${risk["level"]} (${formatRiskScore(risk["score"])})`,
		`Confidence: ${risk["confidence"]}`,
		`Recommendation: ${risk["recommendation"]}`,
		`Graph degree: in ${profile["degree_in"] ?? "unknown"}, out ${profile["degree_out"] ?? "unknown"}.`,
		"",
		"Exchange behavior",
		exchangeRows.length > 0 ? formatExchangeRows(exchangeRows).join("\n") : "- No exchange inflow/outflow paths found in bounded search."
	];
	if (Array.isArray(risk["drivers"]) && risk["drivers"].length > 0) lines.push("", "Risk drivers", risk["drivers"].map((driver) => `- ${driver}`).join("\n"));
	if (compareAddress) lines.push("", `Connection compare target: ${compareAddress}`, connections.length > 0 ? `Connection paths found: ${connections.length}` : "Connection paths found: 0");
	if (partialQueryFailures.length > 0) lines.push("", "Partial query failures", partialQueryFailures.map((failure) => `- ${failure.id}: ${failure.error}`).join("\n"));
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
				risk,
				exchange_behavior: {
					outflows,
					inflows
				},
				connection: compareAddress ? {
					compare_address: compareAddress,
					paths: connections
				} : void 0,
				partial_query_errors: partialQueryFailures.length > 0 ? partialQueryFailures : void 0
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
		deposits: runs.flatMap((run) => graphArray(run.result.graphData, "deposits").map((item) => ({
			...item,
			run_role: run.role,
			run_address: run.address
		}))),
		source_matches: runs.flatMap((run) => graphArray(run.result.graphData, "source_matches").map((item) => ({
			...item,
			run_role: run.role,
			run_address: run.address
		}))),
		reverse_leads: runs.flatMap((run) => graphArray(run.result.graphData, "reverse_leads").map((item) => ({
			...item,
			run_role: run.role,
			run_address: run.address
		}))),
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
exports.scamTopology = scamTopology;
exports.trackFunds = trackFunds;
