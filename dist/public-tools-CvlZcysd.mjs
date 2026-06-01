import { n as workspaceOutputPaths } from "./output-root-BRhzhhXZ.mjs";
import { t as normalizeGraphPayload } from "./graph-normalizer-CXP06jKh.mjs";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
const GRAPH_QUERY_BATCH_TIMEOUT_SECONDS$1 = 10;
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
function clampInt$2(value, fallback, min, max) {
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
	await mkdir(paths.schemaDir, {
		recursive: true,
		mode: 448
	});
	await mkdir(paths.reportsRoot, {
		recursive: true,
		mode: 448
	});
	await mkdir(paths.reportGraphsRoot, {
		recursive: true,
		mode: 448
	});
	await mkdir(paths.reportTablesRoot, {
		recursive: true,
		mode: 448
	});
	await mkdir(paths.logsRoot, {
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
	const filePath = path.join(paths.schemaDir, `${sanitizeSegment(network)}.graph-schema.json`);
	try {
		return {
			schema: JSON.parse(await readFile(filePath, "utf8")),
			filePath
		};
	} catch (err) {
		if (err.code !== "ENOENT") throw err;
	}
	const schema = schemaFromGraphBatch(network, await callGraphBatch$2(remoteClient, network, SCHEMA_QUERY_SET));
	await writeFile(filePath, JSON.stringify(schema, null, 2) + "\n", { mode: 384 });
	return {
		schema,
		filePath
	};
}
function flowEdgeMap$1(variableName) {
	return `{amount_sum: ${variableName}.amount_sum, amount_usd_sum: ${variableName}.amount_usd_sum, tx_count: ${variableName}.tx_count, first_tx_id: ${variableName}.first_tx_id, last_tx_id: ${variableName}.last_tx_id}`;
}
function pathNodeMap$1(variableName) {
	return `{address: ${variableName}.address, labels: ${variableName}.labels, system_labels: ${variableName}.labels, address_type: ${variableName}.address_type, address_subtypes: ${variableName}.address_subtypes, is_exchange: ${variableName}.is_exchange}`;
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
		...["s", ...intermediateVariables].map((nodeVariable) => `${nodeVariable}.is_exchange IS NULL`),
		"t.is_exchange IS NOT NULL",
		...amountPredicates
	];
	const depositVariable = nodeVariables[nodeVariables.length - 2];
	return {
		id: `forward_exchange_paths_${depth}`,
		query: [
			`MATCH (s:Address {address: "${escapeCypherString$2(address)}"})${relationshipChain}`,
			`WHERE ${predicates.join(" AND ")}`,
			`RETURN [${nodeVariables.map((nodeVariable) => `${nodeVariable}.address`).join(", ")}] AS addresses, [${nodeVariables.map((nodeVariable) => `${nodeVariable}.labels`).join(", ")}] AS node_labels, [${nodeVariables.map(pathNodeMap$1).join(", ")}] AS path_nodes, [${edgeVariables.map(flowEdgeMap$1).join(", ")}] AS edge_props, t.address AS exchange_address, t.labels AS exchange_display_labels, t.labels AS exchange_labels, t.address_type AS exchange_address_type, t.address_subtypes AS exchange_address_subtypes, t.is_exchange AS exchange_is_exchange, ${depositVariable}.address AS deposit_address, ${depositVariable}.is_exchange AS deposit_is_exchange, ${depth} AS hops`,
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
function isExchangeFlag$1(value) {
	if (value === true) return true;
	if (value === false || value === null || value === void 0) return false;
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		return normalized === "true" || normalized === "1";
	}
	if (typeof value === "number") return value === 1;
	return false;
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
function uniqueStrings$1(values) {
	return [...new Set(values ?? [])];
}
function hasExactExchangeLabel$1(labels) {
	return (labels ?? []).some((label) => label.trim().toLowerCase() === "exchange");
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
		address_subtypes: stringArrayValue$1(record["address_subtypes"]),
		is_exchange: isExchangeFlag$1(record["is_exchange"])
	};
}
function isExchangeFlow(flow) {
	return flow.terminal_exchange || isExchangeFlag$1(flow.dst_node?.is_exchange) || hasExactExchangeLabel$1(flow.dst_labels) || hasExactExchangeLabel$1(flow.dst_node?.system_labels) || hasExactExchangeLabel$1(flow.dst_node?.labels);
}
function isExchangeNode(metadata, labels) {
	return isExchangeFlag$1(metadata?.is_exchange) || hasExactExchangeLabel$1(labels) || hasExactExchangeLabel$1(metadata?.system_labels) || hasExactExchangeLabel$1(metadata?.labels);
}
function rowTouchesExchangeBeforeTerminal(pathNodes, nodeLabels, pathLength) {
	for (let index = 0; index < Math.max(pathLength - 1, 0); index += 1) if (isExchangeNode(pathNodes[index], nodeLabels[index])) return true;
	return false;
}
function depositFromRow(row) {
	const pathAddresses = stringArrayValue$1(row["addresses"]) ?? [];
	if (pathAddresses.length < 2) return null;
	const nodeLabels = Array.isArray(row["node_labels"]) ? row["node_labels"].map((labels) => stringArrayValue$1(labels) ?? []) : [];
	const exchangeAddress = typeof row["exchange_address"] === "string" ? row["exchange_address"] : pathAddresses[pathAddresses.length - 1];
	const edgeProps = Array.isArray(row["edge_props"]) ? row["edge_props"] : [];
	const terminalEdge = edgeProps[edgeProps.length - 1] ?? {};
	const pathNodes = Array.isArray(row["path_nodes"]) ? row["path_nodes"].map((node, index) => nodeMetadataFromValue(node, pathAddresses[index])).filter((node) => Boolean(node)) : void 0;
	const depositIndex = pathAddresses.length - 2;
	const depositNode = pathNodes?.find((node) => node.address === pathAddresses[depositIndex]) ?? pathNodes?.[depositIndex];
	if (isExchangeFlag$1(row["deposit_is_exchange"]) || isExchangeNode(depositNode, nodeLabels[depositIndex])) return null;
	const exchangeNode = {
		address: exchangeAddress,
		labels: stringArrayValue$1(row["exchange_display_labels"]),
		system_labels: stringArrayValue$1(row["exchange_system_labels"]) ?? stringArrayValue$1(row["exchange_labels"]),
		address_type: typeof row["exchange_address_type"] === "string" ? row["exchange_address_type"] : void 0,
		address_subtypes: stringArrayValue$1(row["exchange_address_subtypes"]),
		is_exchange: true
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
		if (rowTouchesExchangeBeforeTerminal(pathNodes, nodeLabels, pathAddresses.length)) continue;
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
	if (options.includeDepositTraceback !== false && uniqueDepositAddresses.length > 0) {
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
	if (options.includeDepositTraceback !== false && uniqueDepositAddresses.length > 0) {
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
function buildGraph(seedAddress, network, flows, deposits, sourceMatches, reverseLeads) {
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
		node.labels = uniqueStrings$1([...node.labels, ...metadata?.labels ?? []]);
		node.systemLabels = uniqueStrings$1([
			...node.systemLabels,
			...metadata?.system_labels ?? [],
			...systemLabelsFallback ?? []
		]);
		if (metadata?.address_type) node.addressType = metadata.address_type;
		node.addressSubtypes = uniqueStrings$1([...node.addressSubtypes, ...metadata?.address_subtypes ?? []]);
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
	return normalizeGraphPayload({
		schema: "chain-insights.graph.v1",
		nodes: [...totals.entries()].map(([address, data]) => ({
			id: address,
			address,
			node_type: "address",
			labels: uniqueStrings$1(data.labels),
			...data.systemLabels.length > 0 ? { system_labels: uniqueStrings$1(data.systemLabels) } : {},
			...data.addressType ? { address_type: data.addressType } : {},
			...data.addressSubtypes.length > 0 ? { address_subtypes: uniqueStrings$1(data.addressSubtypes) } : {},
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
function probeEvidence(seedAddress, network, schemaPath, aliases, flows, deposits, sourceMatches, reverseLeads, evidenceSource = "track_funds") {
	return {
		schema: "chain-insights.probe_evidence.v1",
		source: evidenceSource,
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
function htmlEscape$1(value) {
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
		return `<tr>${headers.map((header) => `<td>${htmlEscape$1(values[header])}</td>`).join("")}</tr>`;
	}).join("\n");
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trace Funds Table - ${htmlEscape$1(seedAddress)}</title>
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
    <div>Network: <strong>${htmlEscape$1(network)}</strong></div>
    <div>Seed: <strong>${htmlEscape$1(seedAddress)}</strong></div>
    <div>Generated: <strong>${htmlEscape$1((/* @__PURE__ */ new Date()).toISOString())}</strong></div>
  </div>
  <div class="summary">
    <span class="pill">${flows.length} FLOWS_TO edges</span>
    <span class="pill">${deposits.length} deposit candidates</span>
    <span class="pill">${sourceMatches.length} traceback source paths</span>
    <span class="pill">${reverseLeads.length} reverse 1-hop leads</span>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr>${headers.map((header) => `<th>${htmlEscape$1(headerLabels[header])}</th>`).join("")}</tr></thead>
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
	const hasFiles = Object.values(files).some((value) => value.length > 0);
	return [
		`Trace complete for ${network}:${seedAddress}`,
		"",
		`Facts: ${flows.length} FLOWS_TO edge(s), sum of traced edge amount_sum values ${Number(totalAmount.toFixed(8))}.`,
		`By hop: ${[...byHop.entries()].map(([hop, count]) => `hop ${hop}: ${count}`).join(", ") || "none"}.`,
		`Exchange endpoints reached: ${exchangeCount}. Deposit candidate address(es): ${depositCount}.`,
		`Traceback source path(s): ${sourceMatches.length}. Reverse 1-hop lead(s): ${reverseLeads.length}.`,
		"",
		hasFiles ? [
			"Files written:",
			`- schema: ${files.schema}`,
			`- compact evidence JSON: ${files.compactEvidence}`,
			`- graph JSON: ${files.graph}`,
			`- graph HTML: ${files.graphHtml}`,
			`- table CSV: ${files.table}`,
			`- table HTML: ${files.tableHtml}`,
			`- report: ${files.report}`
		].join("\n") : "Files written: disabled by stateless proxy mode.",
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
	const maxHops = clampInt$2(options.maxHops, 3, 1, 5);
	const perAddressLimit = clampInt$2(options.perAddressLimit, 5, 1, 10);
	const minAmountSum = Math.max(0, options.minAmountSum ?? 0);
	const evidenceSource = options.evidenceSource ?? "track_funds";
	const writeArtifacts = options.writeArtifacts !== false;
	if (!writeArtifacts && options.caseId) throw new Error("case_id requires workspace artifacts; omit case_id when CHAIN_INSIGHTS_MCP_PROXY_MODE=stateless");
	const paths = writeArtifacts ? workspaceOutputPaths() : void 0;
	if (paths) await ensureDirs(paths);
	const schemaResult = paths ? await loadOrCaptureTopologySchema(remoteClient, paths, network) : {
		schema: {
			schema: "chain-insights.runtime_graph_schema.v1",
			network,
			source: "stateless_proxy_mode"
		},
		filePath: "stateless://runtime-schema-not-written"
	};
	const { flows, deposits, sourceMatches, reverseLeads } = await collectProbeTrace(remoteClient, {
		seedAddress,
		network,
		maxHops,
		perAddressLimit,
		minAmountSum,
		includeDepositTraceback: options.includeDepositTraceback
	});
	const aliases = buildAliases(seedAddress, deposits, sourceMatches, reverseLeads);
	const slug = `${(/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}_${sanitizeSegment(seedAddress.slice(0, 16))}`;
	const compact = probeEvidence(seedAddress, network, schemaResult.filePath, aliases, flows, deposits, sourceMatches, reverseLeads, evidenceSource);
	const graph = buildGraph(seedAddress, network, flows, deposits, sourceMatches, reverseLeads);
	const compactPath = paths ? path.join(paths.reportTablesRoot, `${slug}.compact-evidence.json`) : "";
	const graphPath = paths ? path.join(paths.reportGraphsRoot, `${slug}.graph.json`) : "";
	const graphHtmlPath = paths ? path.join(paths.reportsRoot, `${slug}.graph.html`) : "";
	const tablePath = paths ? path.join(paths.reportTablesRoot, `${slug}.flows.csv`) : "";
	const tableHtmlPath = paths ? path.join(paths.reportsRoot, `${slug}.table.html`) : "";
	const reportPath = paths ? path.join(paths.reportsRoot, `${slug}.trace-report.md`) : "";
	if (paths) {
		const { generateInlineGraphHtml } = await import("./html-generator-AowOmzyi.mjs").then((n) => n.n);
		await writeFile(compactPath, JSON.stringify(compact, null, 2) + "\n", { mode: 384 });
		await writeFile(graphPath, JSON.stringify(graph, null, 2) + "\n", { mode: 384 });
		await writeFile(graphHtmlPath, generateInlineGraphHtml(graph), { mode: 384 });
		await writeFile(tablePath, tableCsv(flows), { mode: 384 });
		await writeFile(tableHtmlPath, buildTableHtml(seedAddress, network, flows, deposits, sourceMatches, reverseLeads), { mode: 384 });
		await writeFile(reportPath, buildMarkdownReport(seedAddress, network, flows, deposits, sourceMatches, reverseLeads, aliases, graphPath, schemaResult.filePath), { mode: 384 });
	}
	if (options.caseId) {
		const { EvidenceStore } = await import("./cases-TVcAifxu.mjs").then((n) => n.t);
		await EvidenceStore.append(options.caseId, {
			source: evidenceSource,
			queryParams: `network=${network} seed_address=${seedAddress} max_hops=${maxHops} per_address_limit=${perAddressLimit} min_amount_sum=${minAmountSum}`,
			content: JSON.stringify({
				schema: "chain-insights.evidence_pointer.v1",
				source: evidenceSource,
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
		summaryText: summarize(seedAddress, network, flows, sourceMatches, reverseLeads, aliases, files, continuation),
		compactEvidence: compact,
		graphData: graph,
		files,
		continuation,
		addressMap: aliases.compactAddressMap()
	};
}
//#endregion
//#region src/investigation/stake-insights.ts
const STAKE_INSIGHTS_QUERY_TIMEOUT_SECONDS = 10;
const STAKE_INSIGHTS_REQUEST_TIMEOUT_MS = 300 * 1e3;
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
function nonZeroNumber(value) {
	const parsed = numberValue$1(value);
	return parsed !== void 0 && parsed !== 0 ? parsed : void 0;
}
function clampInt$1(value, fallback, min, max) {
	if (!Number.isFinite(value)) return fallback;
	return Math.max(min, Math.min(max, Math.trunc(value)));
}
function resolveSubject(options) {
	const candidates = [
		["address", options.address],
		["coldkey", options.coldkey],
		["hotkey", options.hotkey]
	].filter((entry) => !!entry[1]?.trim());
	if (candidates.length !== 1) throw new Error("Provide exactly one of address, coldkey, or hotkey");
	return {
		role: candidates[0][0],
		address: candidates[0][1].trim()
	};
}
function validateOptions(options) {
	const network = options.network.trim();
	if (!network) throw new Error("network is required");
	if (options.startBlock !== void 0 || options.endBlock !== void 0) throw new Error("Block windows are not available on the current stake graph surface; use start_timestamp_ms/end_timestamp_ms");
	return {
		network,
		subject: resolveSubject(options),
		depth: clampInt$1(options.depth ?? options.maxHops, 1, 1, 3)
	};
}
function subjectPredicate(subject) {
	const address = escapeCypherString$1(subject.address);
	if (subject.role === "coldkey") return `coldkey.address = "${address}"`;
	if (subject.role === "hotkey") return `hotkey.address = "${address}"`;
	return `(coldkey.address = "${address}" OR hotkey.address = "${address}")`;
}
function stakeRelationshipQuery(topologyGraph, subject, options, depth) {
	const predicates = [subjectPredicate(subject)];
	if (options.netuid !== void 0) predicates.push(`stake.netuid = ${Math.trunc(options.netuid)}`);
	if (options.startTimestampMs !== void 0) predicates.push(`stake.last_activity_timestamp >= ${Math.trunc(options.startTimestampMs)}`);
	if (options.endTimestampMs !== void 0) predicates.push(`stake.first_activity_timestamp <= ${Math.trunc(options.endTimestampMs)}`);
	const limit = Math.min(500, Math.max(50, depth * 100));
	return {
		id: topologyGraph === "live_topology" ? "live_stake_relationships" : "archive_stake_relationships",
		query: [
			`USE ${topologyGraph}`,
			"MATCH (coldkey:Address)-[stake:STAKES_IN]->(hotkey:Address)",
			`WHERE ${predicates.join(" AND ")}`,
			[
				"RETURN coldkey.address AS coldkey",
				"hotkey.address AS hotkey",
				"stake.netuid AS netuid",
				"stake.amount AS amount",
				"stake.source_role AS source_role",
				"stake.destination_role AS destination_role",
				"stake.stake_added_amount AS stake_added_amount",
				"stake.stake_removed_amount AS stake_removed_amount",
				"stake.stake_moved_in_amount AS stake_moved_in_amount",
				"stake.stake_moved_out_amount AS stake_moved_out_amount",
				"stake.net_stake_change AS net_stake_change",
				"stake.stake_event_count AS stake_event_count",
				"stake.first_seen_timestamp AS first_seen_timestamp",
				"stake.last_seen_timestamp AS last_seen_timestamp",
				"stake.first_activity_timestamp AS first_activity_timestamp",
				"stake.last_activity_timestamp AS last_activity_timestamp",
				"stake.first_tx_id AS first_tx_id",
				"stake.last_tx_id AS last_tx_id",
				"stake.active_days AS active_days",
				"stake.granularity AS granularity",
				"stake.source_stake_rows AS source_stake_rows",
				"stake.source_backend AS source_backend",
				`"${topologyGraph}" AS topology_graph`
			].join(", "),
			"ORDER BY stake.amount DESC",
			`LIMIT ${limit}`
		].join(" ")
	};
}
async function callGraphBatch$1(remoteClient, network, queries) {
	const result = await remoteClient.callTool({
		name: "graph_query_batch",
		arguments: {
			network,
			queries,
			per_query_timeout_seconds: STAKE_INSIGHTS_QUERY_TIMEOUT_SECONDS
		}
	}, void 0, {
		timeout: STAKE_INSIGHTS_REQUEST_TIMEOUT_MS,
		maxTotalTimeout: STAKE_INSIGHTS_REQUEST_TIMEOUT_MS
	});
	if (result.isError) throw new Error(textFromToolResult$1(result) || "graph_query_batch failed");
	return parseGraphBatchResult$1(result);
}
function topologyGraphForQueryId(id) {
	return id.startsWith("archive_") ? "archive_topology" : "live_topology";
}
function collectRelationships(batch) {
	const failures = [];
	const evidence = [];
	const live = [];
	const archive = [];
	for (const query of batch.facts?.queries ?? []) {
		const id = query.id ?? "unknown";
		const topologyGraph = topologyGraphForQueryId(id);
		if (query.ok === false) {
			failures.push({
				id,
				error: query.error || "unknown error"
			});
			evidence.push({
				id,
				topology_graph: topologyGraph,
				ok: false,
				row_count: 0,
				error: query.error || "unknown error"
			});
			continue;
		}
		const rows = (query.results ?? []).map((row) => normalizeRelationship(row, topologyGraph));
		if (topologyGraph === "live_topology") live.push(...rows);
		else archive.push(...rows);
		evidence.push({
			id,
			topology_graph: topologyGraph,
			ok: true,
			row_count: rows.length,
			source_backends: [...new Set(rows.map((row) => row.source_backend).filter(Boolean))]
		});
	}
	return {
		live,
		archive,
		failures,
		evidence
	};
}
function normalizeRelationship(row, topologyGraph) {
	return {
		coldkey: String(row["coldkey"] ?? ""),
		hotkey: String(row["hotkey"] ?? ""),
		netuid: numberValue$1(row["netuid"]),
		amount: numberValue$1(row["amount"]),
		source_role: stringValue(row["source_role"]),
		destination_role: stringValue(row["destination_role"]),
		stake_added_amount: numberValue$1(row["stake_added_amount"]),
		stake_removed_amount: numberValue$1(row["stake_removed_amount"]),
		stake_moved_in_amount: numberValue$1(row["stake_moved_in_amount"]),
		stake_moved_out_amount: numberValue$1(row["stake_moved_out_amount"]),
		net_stake_change: numberValue$1(row["net_stake_change"]),
		stake_event_count: numberValue$1(row["stake_event_count"]),
		first_seen_timestamp: numberValue$1(row["first_seen_timestamp"]),
		last_seen_timestamp: numberValue$1(row["last_seen_timestamp"]),
		first_activity_timestamp: numberValue$1(row["first_activity_timestamp"]),
		last_activity_timestamp: numberValue$1(row["last_activity_timestamp"]),
		first_tx_id: stringValue(row["first_tx_id"]),
		last_tx_id: stringValue(row["last_tx_id"]),
		active_days: numberValue$1(row["active_days"]),
		granularity: stringValue(row["granularity"]),
		source_stake_rows: numberValue$1(row["source_stake_rows"]),
		source_backend: stringValue(row["source_backend"]) ?? (topologyGraph === "live_topology" ? "memgraph_live" : "starrocks_archive"),
		topology_graph: topologyGraph
	};
}
function firstTimestamp(rows) {
	const timestamps = rows.map((row) => row.first_activity_timestamp).filter((value) => value !== void 0);
	return timestamps.length > 0 ? Math.min(...timestamps) : void 0;
}
function lastTimestamp(rows) {
	const timestamps = rows.map((row) => row.last_activity_timestamp).filter((value) => value !== void 0);
	return timestamps.length > 0 ? Math.max(...timestamps) : void 0;
}
function sum(rows, selector) {
	return rows.reduce((total, row) => total + (selector(row) ?? 0), 0);
}
function stakeTotals(rows) {
	return {
		amount_unit: "tao",
		total_staked: sum(rows, (row) => row.stake_added_amount),
		total_unstaked: sum(rows, (row) => row.stake_removed_amount),
		total_moved_in: sum(rows, (row) => row.stake_moved_in_amount),
		total_moved_out: sum(rows, (row) => row.stake_moved_out_amount),
		net_staked: rows.some((row) => row.net_stake_change !== void 0) ? sum(rows, (row) => row.net_stake_change) : sum(rows, (row) => row.amount),
		relationship_count: rows.length,
		first_activity_timestamp: firstTimestamp(rows),
		last_activity_timestamp: lastTimestamp(rows)
	};
}
function movementRows(rows) {
	const movements = [];
	for (const row of rows) {
		const base = {
			coldkey: row.coldkey,
			hotkey: row.hotkey,
			netuid: row.netuid,
			source_backend: row.source_backend,
			first_activity_timestamp: row.first_activity_timestamp,
			last_activity_timestamp: row.last_activity_timestamp
		};
		const added = nonZeroNumber(row.stake_added_amount);
		if (added !== void 0) movements.push({
			...base,
			movement_type: "stake_added",
			direction: "coldkey_to_hotkey",
			amount: added
		});
		const removed = nonZeroNumber(row.stake_removed_amount);
		if (removed !== void 0) movements.push({
			...base,
			movement_type: "stake_removed",
			direction: "hotkey_to_coldkey",
			amount: removed
		});
		const movedIn = nonZeroNumber(row.stake_moved_in_amount);
		if (movedIn !== void 0) movements.push({
			...base,
			movement_type: "stake_moved_in",
			direction: "counterparty_to_relationship",
			amount: movedIn
		});
		const movedOut = nonZeroNumber(row.stake_moved_out_amount);
		if (movedOut !== void 0) movements.push({
			...base,
			movement_type: "stake_moved_out",
			direction: "relationship_to_counterparty",
			amount: movedOut
		});
	}
	return movements;
}
function topCounterparties(subject, rows) {
	const byAddress = /* @__PURE__ */ new Map();
	for (const row of rows) {
		const counterparties = [];
		if (subject.role === "coldkey") counterparties.push({
			address: row.hotkey,
			role: "hotkey"
		});
		else if (subject.role === "hotkey") counterparties.push({
			address: row.coldkey,
			role: "coldkey"
		});
		else {
			if (row.coldkey === subject.address) counterparties.push({
				address: row.hotkey,
				role: "hotkey"
			});
			if (row.hotkey === subject.address) counterparties.push({
				address: row.coldkey,
				role: "coldkey"
			});
		}
		for (const counterparty of counterparties.filter((entry) => entry.address)) {
			const current = byAddress.get(counterparty.address) ?? {
				address: counterparty.address,
				role: counterparty.role,
				amount: 0,
				relationship_count: 0,
				stake_event_count: 0
			};
			current.amount += row.amount ?? row.net_stake_change ?? 0;
			current.relationship_count += 1;
			current.stake_event_count += row.stake_event_count ?? 0;
			byAddress.set(counterparty.address, current);
		}
	}
	return [...byAddress.values()].sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount)).slice(0, 10);
}
function graphData(rows, subject, network) {
	const nodes = /* @__PURE__ */ new Map();
	const ensureNode = (address, role) => {
		const existing = nodes.get(address) ?? {
			id: address,
			address,
			node_type: "address",
			labels: [],
			roles: []
		};
		const roles = Array.isArray(existing["roles"]) ? existing["roles"].map(String) : [];
		nodes.set(address, {
			...existing,
			roles: [...new Set([...roles, role])]
		});
	};
	ensureNode(subject.address, "subject");
	const edges = rows.map((row) => {
		ensureNode(row.coldkey, "coldkey");
		ensureNode(row.hotkey, "hotkey");
		return {
			source: row.coldkey,
			target: row.hotkey,
			edge_type: "stakes_in",
			amount: row.amount ?? row.net_stake_change ?? 0,
			netuid: row.netuid,
			source_backend: row.source_backend,
			topology_graph: row.topology_graph,
			first_activity_timestamp: row.first_activity_timestamp,
			last_activity_timestamp: row.last_activity_timestamp
		};
	});
	return normalizeGraphPayload({
		schema: "chain-insights.graph.v1",
		nodes: [...nodes.values()],
		edges,
		flows: [],
		edge_anchors: [],
		metadata: {
			network,
			subject_address: subject.address,
			subject_role: subject.role,
			generated_at: (/* @__PURE__ */ new Date()).toISOString()
		}
	});
}
function summaryLines(network, subject, rows, totals, failures) {
	const lines = [
		`Stake insights for ${network}:${subject.address}`,
		"",
		`Subject role: ${subject.role}`,
		`Relationships: ${rows.length}`,
		`Net staked: ${totals["net_staked"] ?? 0} TAO`,
		`Total staked: ${totals["total_staked"] ?? 0} TAO`,
		`Total unstaked: ${totals["total_unstaked"] ?? 0} TAO`,
		`First activity: ${totals["first_activity_timestamp"] ?? "unknown"}`,
		`Last activity: ${totals["last_activity_timestamp"] ?? "unknown"}`
	];
	if (rows.length > 0) {
		lines.push("", "Top staking relationships");
		for (const row of rows.slice(0, 10)) lines.push(`- ${row.coldkey} -> ${row.hotkey} netuid ${row.netuid ?? "unknown"} amount ${row.amount ?? row.net_stake_change ?? "unknown"} (${row.source_backend})`);
	} else lines.push("", "No stake relationships matched the requested filters.");
	if (failures.length > 0) lines.push("", "Partial query failures", failures.map((failure) => `- ${failure.id}: ${failure.error}`).join("\n"));
	return lines.join("\n");
}
async function stakeInsights(remoteClient, options) {
	const { network, subject, depth } = validateOptions(options);
	const { live, archive, failures, evidence } = collectRelationships(await callGraphBatch$1(remoteClient, network, [stakeRelationshipQuery("live_topology", subject, options, depth), stakeRelationshipQuery("archive_topology", subject, options, depth)]));
	const successfulQueryCount = evidence.filter((entry) => entry["ok"] === true).length;
	if (live.length === 0 && archive.length === 0 && failures.length > 0 && successfulQueryCount === 0) throw new Error(`Stake insights unavailable: ${failures.map((failure) => `${failure.id}: ${failure.error}`).join("; ")}`);
	const rows = live.length > 0 ? live : archive;
	const totals = stakeTotals(rows);
	const facts = {
		subject: {
			network,
			address: subject.address,
			role: subject.role,
			netuid: options.netuid,
			start_timestamp_ms: options.startTimestampMs,
			end_timestamp_ms: options.endTimestampMs,
			depth
		},
		backend_used: [...new Set(rows.map((row) => row.source_backend).filter(Boolean))],
		primary_topology_graph: live.length > 0 ? "live_topology" : "archive_topology",
		stake_totals: totals,
		active_relationships: rows,
		stake_movements: movementRows(rows),
		top_counterparties: topCounterparties(subject, rows),
		query_evidence: evidence,
		partial_query_errors: failures.length > 0 ? failures : void 0
	};
	return {
		summaryText: summaryLines(network, subject, rows, totals, failures),
		structuredContent: {
			schema: "chain-insights.result.v1",
			tool: "stake_insights",
			facts,
			hint: rows.length > 0 ? "Review active_relationships and stake_movements before treating stake behavior as generic money flow." : "No matching stake relationships were found; confirm the address role, netuid, and time window."
		},
		graphData: graphData(rows, subject, network)
	};
}
//#endregion
//#region src/investigation/public-tools.ts
const GRAPH_QUERY_BATCH_TIMEOUT_SECONDS = 10;
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
	return `{address: ${variableName}.address, labels: ${variableName}.labels, system_labels: ${variableName}.labels, address_type: ${variableName}.address_type, address_subtypes: ${variableName}.address_subtypes, is_exchange: ${variableName}.is_exchange}`;
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
function hasExactExchangeLabel(labels) {
	return (labels ?? []).some((label) => label.trim().toLowerCase() === "exchange");
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
	return restoreSystemLabels(normalizeGraphPayload({
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
function uniqueStrings(values) {
	return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}
function clampInt(value, fallback, min, max) {
	if (!Number.isFinite(value)) return fallback;
	return Math.max(min, Math.min(max, Math.trunc(value)));
}
function graphRecords(graphData, key) {
	const value = graphData[key];
	return Array.isArray(value) ? value.filter((item) => typeof item === "object" && item !== null && !Array.isArray(item)) : [];
}
function normalizeTraceGraphData(runs, network) {
	return normalizeGraphPayload({
		schema: "chain-insights.graph.v1",
		nodes: runs.flatMap((run) => graphRecords(run.result.graphData, "nodes")),
		edges: runs.flatMap((run) => graphRecords(run.result.graphData, "edges")),
		flows: runs.flatMap((run) => graphRecords(run.result.graphData, "flows")),
		deposits: runs.flatMap((run) => graphRecords(run.result.graphData, "deposits").map((item) => ({
			...item,
			run_role: run.role,
			run_address: run.address
		}))),
		source_matches: runs.flatMap((run) => graphRecords(run.result.graphData, "source_matches").map((item) => ({
			...item,
			run_role: run.role,
			run_address: run.address
		}))),
		reverse_leads: runs.flatMap((run) => graphRecords(run.result.graphData, "reverse_leads").map((item) => ({
			...item,
			run_role: run.role,
			run_address: run.address
		}))),
		edge_anchors: [],
		metadata: {
			network,
			generated_at: (/* @__PURE__ */ new Date()).toISOString(),
			trace_tools: true
		}
	});
}
function traceArtifactPointersFromRun(run) {
	if (!run) return {};
	if (!Object.values(run.files).some((value) => value.length > 0)) return {
		artifacts_written: false,
		artifact_mode: "stateless"
	};
	return {
		graph_json: run.files.graph,
		graph_html: run.files.graphHtml,
		table_json: run.files.compactEvidence,
		flows_csv: run.files.table,
		table_html: run.files.tableHtml,
		report_md: run.files.report
	};
}
function statelessArtifacts() {
	return {
		artifacts_written: false,
		artifact_mode: "stateless"
	};
}
function artifactEvidence(artifacts) {
	return Object.entries(artifacts).filter((entry) => typeof entry[1] === "string" && entry[1].length > 0).map(([kind, filePath]) => ({
		evidence_type: "artifact_pointer",
		path: filePath,
		summary: `${kind} artifact`
	}));
}
function traceAddressRoleForSeed(seedRole) {
	if (seedRole === "victim") return "seed_victim";
	if (seedRole === "suspect") return "seed_suspect";
	return "seed_deposit";
}
function addTraceAddress(addresses, address, role, rationale, labels = []) {
	if (!address) return;
	const existing = addresses.get(address);
	if (existing) {
		existing.roles.add(role);
		existing.labels = uniqueStrings([...existing.labels, ...labels]);
		if (role === "exchange") existing.is_exchange = true;
		if (!existing.rationale.includes(rationale)) existing.rationale.push(rationale);
		return;
	}
	addresses.set(address, {
		address,
		roles: new Set([role]),
		labels,
		is_exchange: role === "exchange" ? true : void 0,
		confidence: role.startsWith("seed_") || role === "exchange" ? "high" : "medium",
		rationale: [rationale]
	});
}
function edgeKey(from, to) {
	return `${from}\u0000${to}`;
}
function traceResultFromFundRuns(tool, seedRole, network, runs, options = {}) {
	const graphData = normalizeTraceGraphData(runs, network);
	const flows = graphRecords(graphData, "flows");
	const deposits = graphRecords(graphData, "deposits");
	const addresses = /* @__PURE__ */ new Map();
	for (const run of runs) addTraceAddress(addresses, run.address, traceAddressRoleForSeed(seedRole), `${seedRole} seed provided by caller`);
	const edgeIdsByPair = /* @__PURE__ */ new Map();
	const edges = flows.map((flow, index) => {
		const src = typeof flow["src"] === "string" ? flow["src"] : "";
		const dst = typeof flow["dst"] === "string" ? flow["dst"] : "";
		const edgeId = `e${index + 1}`;
		edgeIdsByPair.set(edgeKey(src, dst), edgeId);
		const terminalExchange = flow["terminal_exchange"] === true;
		addTraceAddress(addresses, src, runs.some((run) => run.address === src) ? traceAddressRoleForSeed(seedRole) : "candidate_intermediate", "Address appears in traced FLOWS_TO path");
		addTraceAddress(addresses, dst, terminalExchange ? "exchange" : "candidate_intermediate", terminalExchange ? "Terminal exchange endpoint reached" : "Address appears in traced FLOWS_TO path");
		return {
			edge_id: edgeId,
			from_address: src,
			to_address: dst,
			edge_type: "FLOWS_TO",
			amount_sum: numberValue(flow["amount_sum"]),
			amount_usd_sum: numberValue(flow["amount_usd_sum"]),
			tx_count: numberValue(flow["tx_count"]),
			first_tx_id: typeof flow["first_tx_id"] === "string" ? flow["first_tx_id"] : void 0,
			last_tx_id: typeof flow["last_tx_id"] === "string" ? flow["last_tx_id"] : void 0
		};
	}).filter((edge) => edge.from_address && edge.to_address);
	const paths = deposits.map((deposit, index) => {
		const depositAddress = typeof deposit["address"] === "string" ? deposit["address"] : typeof deposit["deposit_address"] === "string" ? deposit["deposit_address"] : "";
		const exchangeAddress = typeof deposit["exchangeAddress"] === "string" ? deposit["exchangeAddress"] : typeof deposit["exchange_address"] === "string" ? deposit["exchange_address"] : "";
		const pathAddresses = stringArrayValue(deposit["path"]) ?? [
			typeof deposit["run_address"] === "string" ? deposit["run_address"] : runs[0]?.address ?? "",
			depositAddress,
			exchangeAddress
		].filter(Boolean);
		addTraceAddress(addresses, depositAddress, "candidate_deposit", "Penultimate address before an exchange endpoint");
		if (exchangeAddress) addTraceAddress(addresses, exchangeAddress, "exchange", "Exchange endpoint reached");
		const edgeIds = [];
		for (let offset = 0; offset < pathAddresses.length - 1; offset += 1) {
			const id = edgeIdsByPair.get(edgeKey(pathAddresses[offset], pathAddresses[offset + 1]));
			if (id) edgeIds.push(id);
		}
		return {
			path_id: `p${index + 1}`,
			direction: "forward",
			source: pathAddresses[0] ?? "",
			target: exchangeAddress || depositAddress,
			addresses: pathAddresses,
			edge_ids: edgeIds,
			hops: numberValue(deposit["hops"]) ?? Math.max(pathAddresses.length - 1, 0),
			terminal_role: exchangeAddress ? "exchange" : "deposit",
			amount_sum: numberValue(deposit["amount_sum"]),
			amount_usd_sum: numberValue(deposit["amount_usd_sum"])
		};
	});
	const depositAddresses = uniqueStrings(deposits.map((deposit) => typeof deposit["address"] === "string" ? deposit["address"] : typeof deposit["deposit_address"] === "string" ? deposit["deposit_address"] : void 0));
	const exchangeAddresses = uniqueStrings(deposits.map((deposit) => typeof deposit["exchangeAddress"] === "string" ? deposit["exchangeAddress"] : typeof deposit["exchange_address"] === "string" ? deposit["exchange_address"] : void 0));
	const convergence = [...new Map(depositAddresses.map((address) => {
		const pathIds = paths.filter((path) => path.addresses.includes(address)).map((path) => path.path_id);
		return [address, {
			address,
			role: "candidate_deposit",
			path_ids: pathIds,
			reason: pathIds.length > 1 ? "Multiple traced paths converge into this deposit candidate." : "Single traced path reached this deposit candidate."
		}];
	})).values()].filter((entry) => entry.path_ids.length > 1);
	const candidateLabels = depositAddresses.map((address) => ({
		address,
		candidate_label: "candidate_deposit",
		confidence: "medium",
		evidence_path_ids: paths.filter((path) => path.addresses.includes(address)).map((path) => path.path_id),
		reason: "Penultimate address before an exchange endpoint in bounded FLOWS_TO trace.",
		promote_to_core_label: false
	}));
	const runArtifacts = runs.map((run, index) => ({
		run_id: `run_${index + 1}`,
		role: run.role,
		address: run.address,
		...traceArtifactPointersFromRun(run.result)
	}));
	const artifacts = {
		...traceArtifactPointersFromRun(runs[0]?.result),
		runs: runArtifacts
	};
	const artifactEvidenceEntries = runs.flatMap((run) => artifactEvidence(traceArtifactPointersFromRun(run.result)).map((entry) => ({
		...entry,
		run_role: run.role,
		address: run.address
	})));
	const recommendedNextTools = depositAddresses.length > 0 ? ["trace_deposit_sources", "address_risk"] : ["address_risk", "graph_query_batch"];
	const structuredContent = {
		schema: "chain-insights.trace.v1",
		tool,
		network,
		input: {
			addresses: runs.map((run) => run.address),
			seed_role: seedRole,
			...options.incidentTimestampMs !== void 0 ? { incident_timestamp_ms: options.incidentTimestampMs } : {},
			...options.timeRange ? { time_range: options.timeRange } : {},
			max_hops: options.maxHops ?? 3
		},
		summary: {
			seed_count: runs.length,
			path_count: paths.length,
			edge_count: edges.length,
			candidate_suspect_count: seedRole === "suspect" ? runs.length : 0,
			candidate_intermediate_count: [...addresses.values()].filter((entry) => entry.roles.has("candidate_intermediate")).length,
			candidate_deposit_count: depositAddresses.length,
			exchange_count: exchangeAddresses.length
		},
		addresses: [...addresses.values()].map((entry) => ({
			address: entry.address,
			roles: [...entry.roles],
			...entry.labels.length > 0 ? { labels: entry.labels } : {},
			...entry.is_exchange !== void 0 ? { is_exchange: entry.is_exchange } : {},
			confidence: entry.confidence,
			rationale: entry.rationale
		})),
		edges,
		paths,
		convergence,
		exchange_exposure: deposits.map((deposit) => ({
			deposit_address: typeof deposit["address"] === "string" ? deposit["address"] : deposit["deposit_address"],
			exchange_address: typeof deposit["exchangeAddress"] === "string" ? deposit["exchangeAddress"] : deposit["exchange_address"],
			path_ids: paths.filter((path) => path.addresses.includes(String(deposit["address"] ?? deposit["deposit_address"] ?? ""))).map((path) => path.path_id)
		})),
		candidate_labels: candidateLabels,
		artifacts,
		evidence: [...artifactEvidenceEntries, ...options.caseId ? [{
			evidence_type: "case_pointer",
			summary: `case_id=${options.caseId}`
		}] : []],
		continuation: {
			candidate_deposit_addresses: depositAddresses,
			candidate_suspect_addresses: seedRole === "suspect" ? runs.map((run) => run.address) : [],
			candidate_victim_addresses: [],
			recommended_next_tools: recommendedNextTools
		},
		warnings: depositAddresses.length === 0 ? ["No exchange deposit candidates were connected in the queried topology."] : []
	};
	return {
		summaryText: [
			`${seedRole === "victim" ? "Trace victim funds" : "Trace suspect funds"} complete for ${network}`,
			"",
			...runs.map((run) => `## ${run.role}: ${run.address}\n${run.result.summaryText}`)
		].join("\n"),
		structuredContent,
		graphData
	};
}
async function traceVictimFunds(remoteClient, config, options) {
	const network = options.network.trim();
	const victims = parseAddressList(options.victimAddresses);
	const knownSuspects = parseAddressList(options.knownSuspectAddresses);
	if (!network) throw new Error("network is required");
	if (victims.length < 1) throw new Error("victim_addresses must contain at least 1 address");
	if (victims.length > 5) throw new Error("victim_addresses cannot exceed 5 addresses");
	if (knownSuspects.length > 5) throw new Error("known_suspect_addresses cannot exceed 5 addresses");
	const runs = [];
	for (const address of victims) runs.push({
		role: "victim",
		address,
		result: await runFundFlowProbe(remoteClient, config, {
			seedAddress: address,
			network,
			caseId: options.caseId,
			maxHops: options.maxHops,
			perAddressLimit: options.perAddressLimit,
			minAmountSum: options.minAmountSum,
			includeDepositTraceback: false,
			evidenceSource: "trace_victim_funds",
			writeArtifacts: options.writeArtifacts
		})
	});
	return traceResultFromFundRuns("trace_victim_funds", "victim", network, runs, {
		incidentTimestampMs: options.incidentTimestampMs,
		timeRange: options.timeRange,
		maxHops: options.maxHops,
		caseId: options.caseId
	});
}
async function traceSuspectFunds(remoteClient, config, options) {
	const network = options.network.trim();
	const suspects = parseAddressList(options.suspectAddresses);
	if (!network) throw new Error("network is required");
	if (suspects.length < 1) throw new Error("suspect_addresses must contain at least 1 address");
	if (suspects.length > 5) throw new Error("suspect_addresses cannot exceed 5 addresses");
	const runs = [];
	for (const address of suspects) runs.push({
		role: "suspect",
		address,
		result: await runFundFlowProbe(remoteClient, config, {
			seedAddress: address,
			network,
			caseId: options.caseId,
			maxHops: options.maxHops,
			perAddressLimit: options.perAddressLimit,
			minAmountSum: options.minAmountSum,
			includeDepositTraceback: false,
			evidenceSource: "trace_suspect_funds",
			writeArtifacts: options.writeArtifacts
		})
	});
	return traceResultFromFundRuns("trace_suspect_funds", "suspect", network, runs, {
		incidentTimestampMs: options.incidentTimestampMs,
		timeRange: options.timeRange,
		maxHops: options.maxHops,
		caseId: options.caseId
	});
}
function reverseDepositSourceQueryAtDepth(depositAddresses, depth) {
	const intermediateVariables = Array.from({ length: Math.max(depth - 1, 0) }, (_, index) => `n${index + 1}`);
	const nodeVariables = [
		"source",
		...intermediateVariables,
		"deposit"
	];
	const edgeVariables = Array.from({ length: depth }, (_, index) => `r${index + 1}`);
	const relationshipChain = edgeVariables.map((edgeVariable, index) => {
		return `-[${edgeVariable}:FLOWS_TO]->(${index === edgeVariables.length - 1 ? "deposit" : intermediateVariables[index]}:Address)`;
	}).join("");
	const depositPredicates = depositAddresses.map((address) => `deposit.address = "${escapeCypherString(address)}"`);
	const nonExchangePredicates = [
		"source",
		...intermediateVariables,
		"deposit"
	].map((nodeVariable) => `${nodeVariable}.is_exchange IS NULL`);
	return {
		id: `reverse_deposit_sources_${depth}`,
		query: [
			`MATCH (source:Address)${relationshipChain}`,
			`WHERE (${depositPredicates.join(" OR ")}) AND source.address <> deposit.address AND ${nonExchangePredicates.join(" AND ")}`,
			`RETURN DISTINCT source.address AS source_address, source.is_exchange AS source_is_exchange, deposit.address AS deposit_address, deposit.is_exchange AS deposit_is_exchange, ${depth} AS hop, [${nodeVariables.map((nodeVariable) => `${nodeVariable}.address`).join(", ")}] AS addresses, [${nodeVariables.map(pathNodeMap).join(", ")}] AS path_nodes, [${edgeVariables.map(flowEdgeMap).join(", ")}] AS edge_props`,
			"LIMIT 500"
		].join(" ")
	};
}
function rowNodeIsExchange(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const record = value;
	return isExchangeFlag(record["is_exchange"]) || hasExactExchangeLabel(stringArrayValue(record["labels"])) || hasExactExchangeLabel(stringArrayValue(record["system_labels"]));
}
function reverseDepositSourceRowUsesExchange(row) {
	if (isExchangeFlag(row["source_is_exchange"]) || isExchangeFlag(row["deposit_is_exchange"])) return true;
	if (!Array.isArray(row["path_nodes"])) return false;
	return row["path_nodes"].some(rowNodeIsExchange);
}
function htmlEscape(value) {
	return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#39;");
}
function buildTraceSourceTableHtml(tool, network, rows) {
	const headers = [
		"path_id",
		"source_address",
		"deposit_address",
		"hop",
		"amount_sum",
		"first_tx_id"
	];
	const body = rows.map((row) => `<tr>${headers.map((header) => `<td>${htmlEscape(row[header])}</td>`).join("")}</tr>`).join("\n");
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEscape(tool)} Table</title>
<style>
  :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0b0d12; color: #f4f2ea; }
  body { margin: 0; background: #0b0d12; color: #f4f2ea; }
  main { padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 8px; font-weight: 650; }
  .meta { display: grid; gap: 6px; margin: 0 0 20px; color: rgba(244,242,234,.72); font-size: 13px; }
  .table-wrap { overflow: auto; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; background: #10131b; }
  table { border-collapse: collapse; width: 100%; min-width: 980px; font-size: 12px; }
  th, td { border-bottom: 1px solid rgba(255,255,255,.08); padding: 8px 10px; text-align: left; vertical-align: top; }
  th { position: sticky; top: 0; background: #161a24; color: #f2dda6; font-weight: 600; z-index: 1; }
  td { color: rgba(244,242,234,.86); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  tr:hover td { background: rgba(242,221,166,.045); }
</style>
</head>
<body>
<main>
  <h1>${htmlEscape(tool)} Table</h1>
  <div class="meta">
    <div>Network: <strong>${htmlEscape(network)}</strong></div>
    <div>Generated: <strong>${htmlEscape((/* @__PURE__ */ new Date()).toISOString())}</strong></div>
    <div>Rows: <strong>${rows.length}</strong></div>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr>${headers.map((header) => `<th>${htmlEscape(header)}</th>`).join("")}</tr></thead>
      <tbody>
${body}
      </tbody>
    </table>
  </div>
</main>
</body>
</html>
`;
}
async function writeTraceSourceArtifacts(tool, network, graphData, rows, summaryText) {
	const paths = workspaceOutputPaths();
	await Promise.all([
		mkdir(paths.reportsRoot, { recursive: true }),
		mkdir(paths.reportGraphsRoot, { recursive: true }),
		mkdir(paths.reportTablesRoot, { recursive: true })
	]);
	const slug = `${(/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}_${tool}`;
	const graphPath = path.join(paths.reportGraphsRoot, `${slug}.graph.json`);
	const tableJsonPath = path.join(paths.reportTablesRoot, `${slug}.compact-evidence.json`);
	const csvPath = path.join(paths.reportTablesRoot, `${slug}.flows.csv`);
	const tableHtmlPath = path.join(paths.reportsRoot, `${slug}.table.html`);
	const reportPath = path.join(paths.reportsRoot, `${slug}.trace-report.md`);
	const graphHtmlPath = path.join(paths.reportsRoot, `${slug}.graph.html`);
	const { generateInlineGraphHtml } = await import("./html-generator-AowOmzyi.mjs").then((n) => n.n);
	const csv = ["path_id,source_address,deposit_address,hop,amount_sum,first_tx_id", ...rows.map((row) => [
		row["path_id"] ?? "",
		row["source_address"] ?? "",
		row["deposit_address"] ?? "",
		row["hop"] ?? "",
		row["amount_sum"] ?? "",
		row["first_tx_id"] ?? ""
	].map((value) => JSON.stringify(String(value))).join(","))].join("\n") + "\n";
	await writeFile(graphPath, JSON.stringify(graphData, null, 2) + "\n", { mode: 384 });
	await writeFile(tableJsonPath, JSON.stringify(rows, null, 2) + "\n", { mode: 384 });
	await writeFile(csvPath, csv, { mode: 384 });
	await writeFile(tableHtmlPath, buildTraceSourceTableHtml(tool, network, rows), { mode: 384 });
	await writeFile(reportPath, summaryText + "\n", { mode: 384 });
	await writeFile(graphHtmlPath, generateInlineGraphHtml(graphData), { mode: 384 });
	return {
		graph_json: graphPath,
		graph_html: graphHtmlPath,
		table_json: tableJsonPath,
		flows_csv: csvPath,
		table_html: tableHtmlPath,
		report_md: reportPath
	};
}
async function traceDepositSources(remoteClient, _config, options) {
	const network = options.network.trim();
	const deposits = parseAddressList(options.depositAddresses);
	if (!network) throw new Error("network is required");
	if (deposits.length < 1) throw new Error("deposit_addresses must contain at least 1 address");
	if (deposits.length > 5) throw new Error("deposit_addresses cannot exceed 5 addresses");
	if (options.writeArtifacts === false && options.caseId) throw new Error("case_id requires workspace artifacts; omit case_id when CHAIN_INSIGHTS_MCP_PROXY_MODE=stateless");
	const maxHops = clampInt(options.maxHops, 2, 1, 5);
	const batch = await callGraphBatch(remoteClient, network, Array.from({ length: maxHops }, (_, index) => reverseDepositSourceQueryAtDepth(deposits, index + 1)));
	const failures = [];
	const rows = optionalResultsWithPrefix(batch, "reverse_deposit_sources_", failures).filter((row) => !reverseDepositSourceRowUsesExchange(row)).map((row, index) => ({
		...row,
		path_id: `p${index + 1}`
	}));
	const addresses = /* @__PURE__ */ new Map();
	for (const deposit of deposits) addTraceAddress(addresses, deposit, "seed_deposit", "Deposit/cashout seed provided by caller");
	const edges = [];
	const paths = [];
	for (const row of rows) {
		const sourceAddress = typeof row["source_address"] === "string" ? row["source_address"] : "";
		const depositAddress = typeof row["deposit_address"] === "string" ? row["deposit_address"] : "";
		const pathAddresses = stringArrayValue(row["addresses"]) ?? [sourceAddress, depositAddress].filter(Boolean);
		addTraceAddress(addresses, sourceAddress, "candidate_suspect", "Upstream address funds a suspected deposit/cashout seed");
		addTraceAddress(addresses, depositAddress, "seed_deposit", "Deposit/cashout seed provided by caller");
		const edgeProps = Array.isArray(row["edge_props"]) ? row["edge_props"] : [];
		const edgeIds = [];
		for (let index = 0; index < pathAddresses.length - 1; index += 1) {
			const props = edgeProps[index] ?? {};
			const edgeId = `e${edges.length + 1}`;
			edgeIds.push(edgeId);
			edges.push({
				edge_id: edgeId,
				from_address: pathAddresses[index],
				to_address: pathAddresses[index + 1],
				edge_type: "FLOWS_TO",
				amount_sum: numberValue(props["amount_sum"]) ?? numberValue(row["amount_sum"]),
				amount_usd_sum: numberValue(props["amount_usd_sum"]) ?? numberValue(row["amount_usd_sum"]),
				tx_count: numberValue(props["tx_count"]) ?? numberValue(row["tx_count"]),
				first_seen_timestamp: numberValue(props["first_seen_timestamp"]) ?? numberValue(row["first_seen_timestamp"]),
				last_seen_timestamp: numberValue(props["last_seen_timestamp"]) ?? numberValue(row["last_seen_timestamp"]),
				first_tx_id: typeof props["first_tx_id"] === "string" ? props["first_tx_id"] : typeof row["first_tx_id"] === "string" ? row["first_tx_id"] : void 0,
				last_tx_id: typeof props["last_tx_id"] === "string" ? props["last_tx_id"] : typeof row["last_tx_id"] === "string" ? row["last_tx_id"] : void 0
			});
		}
		paths.push({
			path_id: row["path_id"],
			direction: "reverse",
			source: depositAddress,
			target: sourceAddress,
			addresses: [...pathAddresses].reverse(),
			edge_ids: [...edgeIds].reverse(),
			hops: numberValue(row["hop"]) ?? Math.max(pathAddresses.length - 1, 0),
			terminal_role: "source",
			amount_sum: numberValue(row["amount_sum"]),
			amount_usd_sum: numberValue(row["amount_usd_sum"]),
			first_seen_ms: numberValue(row["first_seen_timestamp"]),
			last_seen_ms: numberValue(row["last_seen_timestamp"])
		});
	}
	const sourceToPathIds = /* @__PURE__ */ new Map();
	const sourceToDeposits = /* @__PURE__ */ new Map();
	for (const row of rows) {
		const source = typeof row["source_address"] === "string" ? row["source_address"] : "";
		const deposit = typeof row["deposit_address"] === "string" ? row["deposit_address"] : "";
		if (!source) continue;
		sourceToPathIds.set(source, [...sourceToPathIds.get(source) ?? [], String(row["path_id"])]);
		if (!sourceToDeposits.has(source)) sourceToDeposits.set(source, /* @__PURE__ */ new Set());
		if (deposit) sourceToDeposits.get(source).add(deposit);
	}
	const convergence = [...sourceToPathIds.entries()].filter(([address]) => (sourceToDeposits.get(address)?.size ?? 0) > 1).map(([address, pathIds]) => ({
		address,
		role: "candidate_suspect",
		path_ids: pathIds,
		reason: "Same upstream source funds multiple provided deposit/cashout seeds."
	}));
	const candidateSuspects = convergence.map((entry) => entry.address);
	const candidateLabels = [...sourceToPathIds.keys()].map((address) => ({
		address,
		candidate_label: "candidate_suspect",
		confidence: candidateSuspects.includes(address) ? "high" : "medium",
		evidence_path_ids: sourceToPathIds.get(address) ?? [],
		reason: candidateSuspects.includes(address) ? "Upstream source converges into multiple provided deposit/cashout seeds." : "Upstream source funds a provided deposit/cashout seed.",
		promote_to_core_label: false
	}));
	const graphData = normalizeGraphPayload({
		schema: "chain-insights.graph.v1",
		nodes: [...addresses.values()].map((entry) => ({
			id: entry.address,
			address: entry.address,
			node_type: "address",
			roles: [...entry.roles],
			labels: entry.labels
		})),
		edges: edges.map((edge) => ({
			source: edge["from_address"],
			target: edge["to_address"],
			edge_type: "flows_to",
			amount_sum: edge["amount_sum"],
			tx_count: edge["tx_count"],
			first_tx_id: edge["first_tx_id"],
			last_tx_id: edge["last_tx_id"],
			direction: "traceback"
		})),
		flows: edges.map((edge, index) => ({
			hop: index + 1,
			src: edge["from_address"],
			dst: edge["to_address"],
			amount_sum: edge["amount_sum"] ?? 0,
			terminal_exchange: false
		})),
		edge_anchors: [],
		metadata: {
			network,
			deposit_addresses: deposits,
			generated_at: (/* @__PURE__ */ new Date()).toISOString()
		}
	});
	const summaryText = [
		`Trace deposit sources complete for ${network}`,
		"",
		`Deposit seeds: ${deposits.join(", ")}`,
		`Reverse path(s): ${paths.length}`,
		`Shared upstream convergence: ${convergence.length}`
	].join("\n");
	const artifacts = options.writeArtifacts === false ? statelessArtifacts() : await writeTraceSourceArtifacts("trace_deposit_sources", network, graphData, rows, summaryText);
	const evidence = artifactEvidence(artifacts);
	if (options.caseId) {
		const { EvidenceStore } = await import("./cases-TVcAifxu.mjs").then((n) => n.t);
		await EvidenceStore.append(options.caseId, {
			source: "trace_deposit_sources",
			queryParams: `network=${network} deposit_addresses=${deposits.join(",")} max_hops=${maxHops}`,
			content: JSON.stringify({
				schema: "chain-insights.evidence_pointer.v1",
				source: "trace_deposit_sources",
				network,
				deposit_addresses: deposits,
				files: artifacts,
				compact_sha256: createHash("sha256").update(JSON.stringify({
					rows,
					convergence
				})).digest("hex")
			}, null, 2)
		});
		evidence.push({
			evidence_type: "case_pointer",
			summary: `case_id=${options.caseId}`
		});
	}
	return {
		summaryText,
		structuredContent: {
			schema: "chain-insights.trace.v1",
			tool: "trace_deposit_sources",
			network,
			input: {
				addresses: deposits,
				seed_role: "deposit",
				...options.timeRange ? { time_range: options.timeRange } : {},
				max_hops: maxHops
			},
			summary: {
				seed_count: deposits.length,
				path_count: paths.length,
				edge_count: edges.length,
				candidate_suspect_count: sourceToPathIds.size,
				candidate_intermediate_count: 0,
				candidate_deposit_count: deposits.length,
				exchange_count: 0
			},
			addresses: [...addresses.values()].map((entry) => ({
				address: entry.address,
				roles: [...entry.roles],
				confidence: entry.confidence,
				rationale: entry.rationale
			})),
			edges,
			paths,
			convergence,
			exchange_exposure: [],
			candidate_labels: candidateLabels,
			artifacts,
			evidence: [...evidence, ...failures.length > 0 ? [{
				evidence_type: "query_summary",
				summary: `partial query failures: ${failures.length}`
			}] : []],
			continuation: {
				candidate_deposit_addresses: deposits,
				candidate_suspect_addresses: candidateSuspects,
				candidate_victim_addresses: [],
				recommended_next_tools: candidateSuspects.length > 0 ? ["trace_suspect_funds", "address_risk"] : ["address_risk", "graph_query_batch"]
			},
			warnings: paths.length === 0 ? ["No upstream sources were connected in the queried topology."] : []
		},
		graphData
	};
}
//#endregion
export { addressRisk, stakeInsights, traceDepositSources, traceSuspectFunds, traceVictimFunds };

//# sourceMappingURL=public-tools-CvlZcysd.mjs.map