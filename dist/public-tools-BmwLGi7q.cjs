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
const GRAPH_QUERY_BATCH_TIMEOUT_SECONDS$1 = 30;
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
function topologyGraphQuery$2(query) {
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
				query: topologyGraphQuery$2(query.query)
			})),
			per_query_timeout_seconds: GRAPH_QUERY_BATCH_TIMEOUT_SECONDS$1
		}
	});
	if (result.isError) throw new Error(textFromToolResult$2(result) || "graph_query_batch failed");
	return parseGraphBatchResult$2(result);
}
function resultsFor$1(batch, id) {
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
			"dst.lifetime_degree_in AS dst_degree_in",
			"dst.lifetime_degree_out AS dst_degree_out"
		]
	};
}
async function loadOrCaptureTopologySchema(remoteClient, paths, network) {
	const filePath = node_path.default.join(paths.schemaDir, `${sanitizeSegment(network)}.graph-schema.json`);
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
	for (const row of resultsFor$1(batch, "direct_edge_props")) {
		const src = typeof row["src"] === "string" ? row["src"] : "";
		const dst = typeof row["dst"] === "string" ? row["dst"] : "";
		if (!src || !dst) continue;
		edgeProps.set(edgeKey(src, dst), row);
	}
	for (const flow of flows) {
		const props = edgeProps.get(edgeKey(flow.src, flow.dst));
		if (!props) continue;
		flow.amount_sum = numberValue$2(props["amount_sum"]) ?? flow.amount_sum;
		flow.amount_usd_sum = numberValue$2(props["amount_usd_sum"]);
		flow.tx_count = numberValue$2(props["tx_count"]);
		flow.first_tx_id = typeof props["first_tx_id"] === "string" ? props["first_tx_id"] : void 0;
		flow.last_tx_id = typeof props["last_tx_id"] === "string" ? props["last_tx_id"] : void 0;
	}
	for (const deposit of deposits) {
		const props = edgeProps.get(edgeKey(deposit.address, deposit.exchangeAddress));
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
		for (const row of resultsFor$1(reverseBatch, "reverse_1hop")) {
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
	const slug = `${(/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}_${sanitizeSegment(seedAddress.slice(0, 16))}`;
	const compact = probeEvidence(seedAddress, network, schemaResult.filePath, aliases, flows, deposits, sourceMatches, reverseLeads);
	const graph = buildGraph$1(seedAddress, network, flows, deposits, sourceMatches, reverseLeads);
	const compactPath = node_path.default.join(paths.reportTablesRoot, `${slug}.compact-evidence.json`);
	const graphPath = node_path.default.join(paths.reportGraphsRoot, `${slug}.graph.json`);
	const graphHtmlPath = node_path.default.join(paths.reportsRoot, `${slug}.graph.html`);
	const tablePath = node_path.default.join(paths.reportTablesRoot, `${slug}.flows.csv`);
	const tableHtmlPath = node_path.default.join(paths.reportsRoot, `${slug}.table.html`);
	const reportPath = node_path.default.join(paths.reportsRoot, `${slug}.trace-report.md`);
	const { generateInlineGraphHtml } = await Promise.resolve().then(() => require("./html-generator-9xvA43R8.cjs")).then((n) => n.html_generator_exports);
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
const SCAM_TOPOLOGY_GRAPH_QUERY_TIMEOUT_SECONDS = 600;
const INFRASTRUCTURE_ANCHOR_LIMIT = 40;
function parseAddressList$1(value) {
	const raw = Array.isArray(value) ? value.join(",") : value ?? "";
	return [...new Set(raw.split(",").map((entry) => entry.trim()).filter(Boolean))];
}
function graphArray$1(graphData, key) {
	const value = graphData[key];
	return Array.isArray(value) ? value.filter((item) => typeof item === "object" && item !== null && !Array.isArray(item)) : [];
}
function stringArray(value) {
	return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}
function stringValue(value) {
	return typeof value === "string" && value.trim() ? value : void 0;
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
function topologyGraphQuery$1(query) {
	const trimmed = query.trim();
	if (/^USE\s+/i.test(trimmed)) return trimmed;
	return `USE live_topology ${trimmed}`;
}
async function callGraphBatch$1(remoteClient, network, queries) {
	const result = await remoteClient.callTool({
		name: "graph_query_batch",
		arguments: {
			network,
			queries: queries.map((query) => ({
				...query,
				query: topologyGraphQuery$1(query.query)
			})),
			per_query_timeout_seconds: SCAM_TOPOLOGY_GRAPH_QUERY_TIMEOUT_SECONDS
		}
	});
	if (result.isError) throw new Error(textFromToolResult$1(result) || "graph_query_batch failed");
	return parseGraphBatchResult$1(result);
}
function addressPredicate(variableName, addresses) {
	return addresses.map((address) => `${variableName}.address = "${escapeCypherString$1(address)}"`).join(" OR ");
}
function flowProjection(relation, sourceVariable = "src", targetVariable = "dst") {
	return [
		`"${relation}" AS relation`,
		`${sourceVariable}.address AS src`,
		`${targetVariable}.address AS dst`,
		`${sourceVariable}.labels AS src_labels`,
		`${targetVariable}.labels AS dst_labels`,
		`r.amount_sum AS amount_sum`,
		`r.amount_usd_sum AS amount_usd_sum`,
		`r.tx_count AS tx_count`,
		`r.first_tx_id AS first_tx_id`,
		`r.last_tx_id AS last_tx_id`
	].join(", ");
}
function seedIncidentQueries(run, index, limit) {
	const address = escapeCypherString$1(run.address);
	return [{
		id: `seed_in_${index}`,
		query: [
			`MATCH (src:Address)-[r:FLOWS_TO]->(dst:Address {address: "${address}"})`,
			"WHERE src.address <> dst.address",
			`RETURN ${flowProjection("seed_funding_input")}, dst.address AS anchor_address`,
			"ORDER BY r.amount_sum DESC",
			`LIMIT ${limit}`
		].join(" ")
	}, {
		id: `seed_out_${index}`,
		query: [
			`MATCH (src:Address {address: "${address}"})-[r:FLOWS_TO]->(dst:Address)`,
			"WHERE src.address <> dst.address",
			`RETURN ${flowProjection("seed_sweep")}, src.address AS anchor_address`,
			"ORDER BY r.amount_sum DESC",
			`LIMIT ${limit}`
		].join(" ")
	}];
}
function anchorFanQueries(anchors, limit) {
	if (anchors.length === 0) return [];
	const dstPredicate = addressPredicate("dst", anchors);
	const srcPredicate = addressPredicate("src", anchors);
	return [{
		id: "anchor_fan_in_1",
		query: [
			"MATCH (src:Address)-[r:FLOWS_TO]->(dst:Address)",
			`WHERE (${dstPredicate}) AND src.address <> dst.address`,
			`RETURN ${flowProjection("anchor_fan_in")}, dst.address AS anchor_address`,
			"ORDER BY r.amount_sum DESC",
			`LIMIT ${limit}`
		].join(" ")
	}, {
		id: "anchor_fan_out_1",
		query: [
			"MATCH (src:Address)-[r:FLOWS_TO]->(dst:Address)",
			`WHERE (${srcPredicate}) AND src.address <> dst.address`,
			`RETURN ${flowProjection("anchor_fan_out")}, src.address AS anchor_address`,
			"ORDER BY r.amount_sum DESC",
			`LIMIT ${limit}`
		].join(" ")
	}];
}
function isExchangeLikeNode(node) {
	const labels = stringArray(node["labels"]).map((label) => label.toLowerCase());
	const roles = stringArray(node["roles"]).map((role) => role.toLowerCase());
	return labels.includes("exchange") || roles.includes("exchange") || node["is_exchange"] === true;
}
function collectInfrastructureAnchors(runs) {
	const anchors = /* @__PURE__ */ new Set();
	const exchanges = /* @__PURE__ */ new Set();
	for (const run of runs) {
		for (const deposit of graphArray$1(run.result.graphData, "deposits")) {
			const exchangeAddress = stringValue(deposit["exchangeAddress"]) ?? stringValue(deposit["exchange_address"]);
			if (exchangeAddress) exchanges.add(exchangeAddress);
		}
		for (const node of graphArray$1(run.result.graphData, "nodes")) {
			const address = stringValue(node["address"]) ?? stringValue(node["id"]);
			if (address && isExchangeLikeNode(node)) exchanges.add(address);
		}
	}
	for (const run of runs) {
		for (const flow of graphArray$1(run.result.graphData, "flows")) for (const key of ["src", "dst"]) {
			const address = stringValue(flow[key]);
			if (address && address !== run.address && !exchanges.has(address)) anchors.add(address);
		}
		for (const deposit of graphArray$1(run.result.graphData, "deposits")) {
			const address = stringValue(deposit["address"]);
			if (address && address !== run.address && !exchanges.has(address)) anchors.add(address);
		}
		for (const lead of graphArray$1(run.result.graphData, "reverse_leads")) {
			const address = stringValue(lead["address"]);
			if (address && address !== run.address && !exchanges.has(address)) anchors.add(address);
		}
	}
	return [...anchors].slice(0, INFRASTRUCTURE_ANCHOR_LIMIT);
}
function infrastructureFlowFromRow(row, context) {
	const relation = stringValue(row["relation"]);
	const src = stringValue(row["src"]);
	const dst = stringValue(row["dst"]);
	if (!relation || !src || !dst) return null;
	return {
		relation,
		src,
		dst,
		amount_sum: numberValue$1(row["amount_sum"]),
		amount_usd_sum: numberValue$1(row["amount_usd_sum"]),
		tx_count: numberValue$1(row["tx_count"]),
		first_tx_id: stringValue(row["first_tx_id"]),
		last_tx_id: stringValue(row["last_tx_id"]),
		src_labels: stringArray(row["src_labels"]),
		dst_labels: stringArray(row["dst_labels"]),
		seed_address: context?.seed_address,
		seed_role: context?.seed_role,
		anchor_address: stringValue(row["anchor_address"])
	};
}
function infrastructureFlowKey(flow) {
	return `${flow.relation}\u0000${flow.src}\u0000${flow.dst}`;
}
async function collectLiveScamInfrastructure(remoteClient, network, runs, perAddressLimitOption) {
	const perAddressLimit = clampInt(perAddressLimitOption, 5, 1, 10);
	const seedLimit = Math.max(25, perAddressLimit * 25);
	const fanLimit = Math.min(1e3, Math.max(200, perAddressLimit * 100));
	const anchors = collectInfrastructureAnchors(runs);
	const queryContexts = /* @__PURE__ */ new Map();
	const queries = [];
	runs.forEach((run, index) => {
		const queryIndex = index + 1;
		for (const query of seedIncidentQueries(run, queryIndex, seedLimit)) {
			queries.push(query);
			queryContexts.set(query.id, {
				seed_address: run.address,
				seed_role: run.seedRole
			});
		}
	});
	queries.push(...anchorFanQueries(anchors, fanLimit));
	if (queries.length === 0) return {
		anchors,
		flows: []
	};
	const batch = await callGraphBatch$1(remoteClient, network, queries);
	const flowsByKey = /* @__PURE__ */ new Map();
	for (const query of batch.facts?.queries ?? []) {
		if (query.ok === false) throw new Error(query.error || `Query failed: ${query.id}`);
		const context = query.id ? queryContexts.get(query.id) : void 0;
		for (const row of query.results ?? []) {
			const flow = infrastructureFlowFromRow(row, context);
			if (flow) flowsByKey.set(infrastructureFlowKey(flow), flow);
		}
	}
	return {
		anchors,
		flows: [...flowsByKey.values()]
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
function addRole(rolesByAddress, address, role) {
	if (!address) return;
	const roles = rolesByAddress.get(address) ?? /* @__PURE__ */ new Set();
	roles.add(role);
	rolesByAddress.set(address, roles);
}
function buildEvidence(run, fields) {
	return {
		seed_address: run.address,
		seed_role: run.seedRole,
		network_source: "track_funds",
		...fields
	};
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
function classifyRun(run, candidates, caseRoles, safetyDecisions, rolesByAddress) {
	caseRoles.push({
		address: run.address,
		role: run.seedRole
	});
	addRole(rolesByAddress, run.address, run.seedRole);
	if (run.seedRole === "victim") safetyDecisions.push({
		address: run.address,
		decision: "do_not_label_victim_seed",
		reason: "Victim/source addresses are not risky actors by default."
	});
	else mergeCandidate(candidates, makeCandidate(run.address, "scam_seed", buildEvidence(run, {
		role: "scammer",
		reason: "Operator supplied this address as a known scammer seed."
	}), 1, "promote_confirmed"));
	for (const deposit of graphArray$1(run.result.graphData, "deposits")) {
		const depositAddress = stringValue(deposit["address"]);
		const exchangeAddress = stringValue(deposit["exchangeAddress"]) ?? stringValue(deposit["exchange_address"]);
		const path = stringArray(deposit["path"]);
		const hopCount = numberValue$1(deposit["hops"]) ?? Math.max(path.length - 1, 0);
		const amountSum = numberValue$1(deposit["amount_sum"]);
		const amountUsdSum = numberValue$1(deposit["amount_usd_sum"]);
		if (exchangeAddress) {
			addRole(rolesByAddress, exchangeAddress, "exchange");
			caseRoles.push({
				address: exchangeAddress,
				role: "exchange_endpoint",
				seed_address: run.address,
				seed_role: run.seedRole
			});
			safetyDecisions.push({
				address: exchangeAddress,
				decision: "do_not_label_exchange_endpoint",
				reason: "Exchange/service endpoints are terminal service context, not automatically scam actors.",
				seed_address: run.address
			});
		}
		for (const intermediate of path.slice(1, -2)) {
			if (!intermediate || intermediate === run.address || intermediate === exchangeAddress) continue;
			addRole(rolesByAddress, intermediate, "laundering_intermediate");
			caseRoles.push({
				address: intermediate,
				role: "laundering_intermediate",
				seed_address: run.address,
				seed_role: run.seedRole
			});
			mergeCandidate(candidates, makeCandidate(intermediate, "laundering_intermediate", buildEvidence(run, {
				path_addresses: path,
				endpoint_address: exchangeAddress,
				endpoint_type: exchangeAddress ? "exchange" : void 0,
				hop_count: hopCount,
				amount_sum: amountSum,
				amount_usd_sum: amountUsdSum,
				reason: "Address appears as an intermediate laundering hop in a known scam topology."
			}), run.seedRole === "scammer" ? .85 : .72, "review_required"));
		}
		if (depositAddress && depositAddress !== run.address && depositAddress !== exchangeAddress) {
			addRole(rolesByAddress, depositAddress, "deposit_candidate");
			caseRoles.push({
				address: depositAddress,
				role: "exchange_deposit_candidate",
				seed_address: run.address,
				seed_role: run.seedRole
			});
			mergeCandidate(candidates, makeCandidate(depositAddress, "exchange_deposit_candidate", buildEvidence(run, {
				path_addresses: path,
				endpoint_address: exchangeAddress,
				endpoint_type: exchangeAddress ? "exchange" : void 0,
				hop_count: hopCount,
				amount_sum: amountSum,
				amount_usd_sum: amountUsdSum,
				reason: "Address is the penultimate hop before an exchange/service endpoint."
			}), run.seedRole === "scammer" ? .8 : .68, "review_required"));
		}
	}
	for (const lead of graphArray$1(run.result.graphData, "reverse_leads")) {
		const address = stringValue(lead["address"]);
		if (!address) continue;
		addRole(rolesByAddress, address, "reverse_lead");
		caseRoles.push({
			address,
			role: "reverse_lead",
			seed_address: run.address,
			seed_role: run.seedRole
		});
		safetyDecisions.push({
			address,
			decision: "context_only_reverse_lead",
			reason: "Reverse leads are useful context but are not automatically risky labels.",
			seed_address: run.address,
			deposit_address: lead["deposit_address"]
		});
	}
}
function addFlowRoles(rolesByAddress, flow) {
	switch (flow.relation) {
		case "seed_funding_input":
			addRole(rolesByAddress, flow.src, "funding_source");
			addRole(rolesByAddress, flow.dst, "seed");
			return;
		case "seed_sweep":
			addRole(rolesByAddress, flow.src, "seed");
			addRole(rolesByAddress, flow.dst, "sweep_recipient");
			return;
		case "anchor_fan_in":
			addRole(rolesByAddress, flow.src, "fan_in_context");
			addRole(rolesByAddress, flow.dst, "infrastructure_anchor");
			return;
		case "anchor_fan_out":
			addRole(rolesByAddress, flow.src, "infrastructure_anchor");
			addRole(rolesByAddress, flow.dst, "fan_out_context");
			return;
	}
}
function mergeInfrastructureNode(nodesById, address, labels, rolesByAddress) {
	const existing = nodesById.get(address) ?? {
		id: address,
		address,
		node_type: "address"
	};
	nodesById.set(address, {
		...existing,
		labels: [...new Set([...stringArray(existing["labels"]), ...labels ?? []])],
		roles: [...new Set([...stringArray(existing["roles"]), ...[...rolesByAddress.get(address) ?? []]])]
	});
}
function buildGraph(runs, infrastructureFlows, rolesByAddress, facts) {
	const nodesById = /* @__PURE__ */ new Map();
	for (const run of runs) for (const node of graphArray$1(run.result.graphData, "nodes")) {
		const id = stringValue(node["id"]) ?? stringValue(node["address"]);
		if (!id) continue;
		const existing = nodesById.get(id) ?? { ...node };
		const roles = new Set([...stringArray(existing["roles"]), ...stringArray(node["roles"])]);
		for (const role of rolesByAddress.get(id) ?? []) roles.add(role);
		nodesById.set(id, {
			...existing,
			...node,
			roles: [...roles]
		});
	}
	for (const [address, roles] of rolesByAddress.entries()) {
		const existing = nodesById.get(address) ?? {
			id: address,
			address,
			node_type: "address"
		};
		nodesById.set(address, {
			...existing,
			roles: [...new Set([...stringArray(existing["roles"]), ...roles])]
		});
	}
	for (const flow of infrastructureFlows) {
		mergeInfrastructureNode(nodesById, flow.src, flow.src_labels, rolesByAddress);
		mergeInfrastructureNode(nodesById, flow.dst, flow.dst_labels, rolesByAddress);
	}
	return require_graph_normalizer.normalizeGraphPayload({
		schema: "chain-insights.graph.v1",
		nodes: [...nodesById.values()],
		edges: [...runs.flatMap((run) => graphArray$1(run.result.graphData, "edges")), ...infrastructureFlows.map((flow) => ({
			source: flow.src,
			target: flow.dst,
			edge_type: "flows_to",
			relation: flow.relation,
			direction: "scam_infrastructure_context",
			amount_sum: flow.amount_sum,
			amount_usd_sum: flow.amount_usd_sum,
			tx_count: flow.tx_count,
			first_tx_id: flow.first_tx_id,
			last_tx_id: flow.last_tx_id,
			seed_address: flow.seed_address,
			seed_role: flow.seed_role,
			anchor_address: flow.anchor_address
		}))],
		flows: runs.flatMap((run) => Array.isArray(run.result.graphData.flows) ? run.result.graphData.flows : []),
		infrastructure_flows: infrastructureFlows,
		deposits: runs.flatMap((run) => graphArray$1(run.result.graphData, "deposits").map((deposit) => ({
			...deposit,
			seed_role: run.seedRole,
			seed_address: run.address
		}))),
		reverse_leads: runs.flatMap((run) => graphArray$1(run.result.graphData, "reverse_leads").map((lead) => ({
			...lead,
			seed_role: run.seedRole,
			seed_address: run.address
		}))),
		edge_anchors: [],
		scam_topology: facts,
		metadata: {
			source: "scam_topology",
			generated_at: (/* @__PURE__ */ new Date()).toISOString()
		}
	});
}
function summarize(network, victimAddresses, scammerAddresses, candidates, safetyDecisions, infrastructureFlows) {
	const confirmed = candidates.filter((candidate) => candidate.promotion_status === "promote_confirmed").length;
	const review = candidates.filter((candidate) => candidate.promotion_status === "review_required").length;
	const infrastructureCounts = /* @__PURE__ */ new Map();
	for (const flow of infrastructureFlows) infrastructureCounts.set(flow.relation, (infrastructureCounts.get(flow.relation) ?? 0) + 1);
	return [
		`Scam topology complete for ${network}`,
		"",
		`Victim/source seed(s): ${victimAddresses.join(", ") || "none"}`,
		`Known scammer seed(s): ${scammerAddresses.join(", ") || "none"}`,
		`Label candidates: ${candidates.length} (${confirmed} promote_confirmed, ${review} review_required).`,
		`Infrastructure context: ${infrastructureFlows.length} live topology edge(s) (${infrastructureCounts.get("seed_funding_input") ?? 0} funding input, ${infrastructureCounts.get("seed_sweep") ?? 0} seed sweep, ${infrastructureCounts.get("anchor_fan_in") ?? 0} fan-in, ${infrastructureCounts.get("anchor_fan_out") ?? 0} fan-out).`,
		`Safety decisions: ${safetyDecisions.length}.`,
		"",
		"Policy: victims, exchange endpoints, and reverse leads are not automatically risky labels."
	].join("\n");
}
async function scamTopology(remoteClient, config, options) {
	const network = options.network.trim();
	const victimAddresses = parseAddressList$1(options.victimAddresses);
	const scammerAddresses = parseAddressList$1(options.scammerAddresses);
	if (!network) throw new Error("network is required");
	if (victimAddresses.length + scammerAddresses.length === 0) throw new Error("victim_addresses or scammer_addresses is required");
	if (victimAddresses.length > 5) throw new Error("victim_addresses cannot exceed 5 addresses");
	if (scammerAddresses.length > 5) throw new Error("scammer_addresses cannot exceed 5 addresses");
	const overlap = victimAddresses.filter((address) => scammerAddresses.includes(address));
	if (overlap.length > 0) throw new Error(`Address(es) appear in both victim and scammer lists: ${overlap.join(", ")}`);
	const runs = [];
	for (const address of victimAddresses) runs.push({
		seedRole: "victim",
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
	for (const address of scammerAddresses) runs.push({
		seedRole: "scammer",
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
	const candidates = /* @__PURE__ */ new Map();
	const caseRoles = [];
	const safetyDecisions = [];
	const rolesByAddress = /* @__PURE__ */ new Map();
	for (const run of runs) classifyRun(run, candidates, caseRoles, safetyDecisions, rolesByAddress);
	const infrastructure = await collectLiveScamInfrastructure(remoteClient, network, runs, options.perAddressLimit);
	for (const flow of infrastructure.flows) addFlowRoles(rolesByAddress, flow);
	const labelCandidates = [...candidates.values()].sort((a, b) => b.confidence_score - a.confidence_score || a.address.localeCompare(b.address));
	const facts = {
		network,
		victim_addresses: victimAddresses,
		scammer_addresses: scammerAddresses,
		label_candidates: labelCandidates,
		case_roles: caseRoles,
		safety_decisions: safetyDecisions,
		infrastructure_anchors: infrastructure.anchors,
		infrastructure_flows: infrastructure.flows,
		runs: runs.map((run) => ({
			seed_role: run.seedRole,
			address: run.address,
			files: run.result.files,
			continuation: run.result.continuation,
			address_map: run.result.addressMap
		}))
	};
	const graphData = buildGraph(runs, infrastructure.flows, rolesByAddress, facts);
	const summaryText = summarize(network, victimAddresses, scammerAddresses, labelCandidates, safetyDecisions, infrastructure.flows);
	if (options.caseId) {
		const { EvidenceStore } = await Promise.resolve().then(() => require("./cases-CDcNU91B.cjs"));
		await EvidenceStore.append(options.caseId, {
			source: "scam_topology",
			queryParams: `network=${network} victim_addresses=${victimAddresses.join(",")} scammer_addresses=${scammerAddresses.join(",")}`,
			content: JSON.stringify({
				schema: "chain-insights.scam_topology_evidence.v1",
				source: "scam_topology",
				network,
				victim_addresses: victimAddresses,
				scammer_addresses: scammerAddresses,
				label_candidates: labelCandidates,
				infrastructure_anchors: infrastructure.anchors,
				infrastructure_flow_count: infrastructure.flows.length,
				safety_decisions: safetyDecisions
			}, null, 2)
		});
	}
	return {
		summaryText,
		structuredContent: {
			schema: "chain-insights.result.v1",
			tool: "scam_topology",
			facts,
			hint: "Review label_candidates before promoting derived addresses into core_address_labels."
		},
		graphData
	};
}
//#endregion
//#region src/investigation/public-tools.ts
const GRAPH_QUERY_BATCH_TIMEOUT_SECONDS = 30;
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
function resultsFor(batch, id) {
	const query = batch.facts?.queries?.find((entry) => entry.id === id);
	if (!query) return [];
	if (query.ok === false) throw new Error(query.error || `Query failed: ${id}`);
	return query.results ?? [];
}
function resultsWithPrefix(batch, prefix) {
	return (batch.facts?.queries ?? []).filter((entry) => entry.id?.startsWith(prefix)).flatMap((entry) => {
		if (entry.ok === false) throw new Error(entry.error || `Query failed: ${entry.id}`);
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
	const profile = {
		address,
		...resultsFor(batch, "address_profile")[0] ?? {},
		...resultsFor(batch, "address_feature")[0] ?? {},
		...resultsFor(batch, "address_risk_score")[0] ?? {}
	};
	const outflows = enrichExchangeRows(resultsWithPrefix(batch, "exchange_outflows_"));
	const inflows = enrichExchangeRows(resultsWithPrefix(batch, "exchange_inflows_"));
	const connections = compareAddress ? resultsFor(batch, "connection_probe") : [];
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
