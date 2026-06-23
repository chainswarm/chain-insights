import { n as workspaceOutputPaths } from "./output-root-DWSzNmRP.mjs";
import { t as normalizeGraphPayload } from "./graph-normalizer-DnWr6UbE.mjs";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
		query: "MATCH (n:Identity) RETURN \"Identity\" AS node_label, count(n) AS sample_count LIMIT 1"
	},
	{
		id: "relationship_types",
		query: "MATCH (:Identity)-[r:FLOWS_TO]->(:Identity) RETURN \"FLOWS_TO\" AS rel_name, count(r) AS sample_count LIMIT 1"
	},
	{
		id: "identity_property_keys",
		query: "MATCH (n:Identity) RETURN \"identity_id\" AS property_key, count(n) AS sample_count LIMIT 1"
	},
	{
		id: "flows_to_property_keys",
		query: "MATCH (:Identity)-[r:FLOWS_TO]->(:Identity) RETURN \"amount_usd_sum\" AS property_key, count(r) AS sample_count LIMIT 1"
	}
];
function clampInt$1(value, fallback, min, max) {
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
			per_query_timeout_seconds: GRAPH_QUERY_BATCH_TIMEOUT_SECONDS$1
		}
	}, void 0, {
		timeout: GRAPH_QUERY_BATCH_REQUEST_TIMEOUT_MS$1,
		maxTotalTimeout: GRAPH_QUERY_BATCH_REQUEST_TIMEOUT_MS$1
	});
	if (result.isError) throw new Error(textFromToolResult$1(result) || "graph_query_batch failed");
	return parseGraphBatchResult$1(result);
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
		identity_property_keys: resultsFor(batch, "identity_property_keys").map((row) => row["property_key"]),
		flows_to_property_keys: resultsFor(batch, "flows_to_property_keys").map((row) => row["property_key"]),
		recommended_flow_projection: [
			"src.identity_id AS src",
			"dst.identity_id AS dst",
			"r.amount_usd_sum AS amount_usd_sum",
			"r.tx_count AS tx_count",
			"r.first_seen_timestamp AS first_seen_timestamp",
			"r.last_seen_timestamp AS last_seen_timestamp",
			"r.first_tx_id AS first_tx_id",
			"r.last_tx_id AS last_tx_id",
			"dst.labels AS dst_labels"
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
	const schema = schemaFromGraphBatch(network, await callGraphBatch$1(remoteClient, network, SCHEMA_QUERY_SET));
	await writeFile(filePath, JSON.stringify(schema, null, 2) + "\n", { mode: 384 });
	return {
		schema,
		filePath
	};
}
function flowEdgeMap$1(variableName) {
	return `{amount_usd_sum: ${variableName}.amount_usd_sum, tx_count: ${variableName}.tx_count, first_seen_timestamp: ${variableName}.first_seen_timestamp, last_seen_timestamp: ${variableName}.last_seen_timestamp, first_tx_id: ${variableName}.first_tx_id, last_tx_id: ${variableName}.last_tx_id}`;
}
function pathNodeMap$1(variableName) {
	return `{address: ${variableName}.identity_id, labels: ${variableName}.labels, system_labels: ${variableName}.labels, risk_score: ${variableName}.risk_score, risk_level: ${variableName}.risk_level, is_exchange: ${variableName}.is_exchange}`;
}
function activityWindowPredicates(edgeVariables, window) {
	if (!window) return [];
	return edgeVariables.map((edgeVariable) => {
		return `${`(${edgeVariable}.first_seen_timestamp >= ${window.fromMs} OR ${edgeVariable}.last_seen_timestamp >= ${window.fromMs})`}${window.toMs !== void 0 ? ` AND ${edgeVariable}.first_seen_timestamp <= ${window.toMs}` : ""}`;
	});
}
function forwardExchangeQueries(address, limit, minAmountSum, maxHops, activityWindow) {
	return Array.from({ length: maxHops }, (_, index) => forwardExchangeQueryAtDepth(address, limit, minAmountSum, index + 1, activityWindow));
}
function forwardExchangeQueryAtDepth(address, limit, minAmountSum, depth, activityWindow) {
	const intermediateVariables = Array.from({ length: Math.max(depth - 1, 0) }, (_, index) => `n${index + 1}`);
	const nodeVariables = [
		"s",
		...intermediateVariables,
		"t"
	];
	const edgeVariables = Array.from({ length: depth }, (_, index) => `r${index + 1}`);
	const relationshipChain = edgeVariables.map((edgeVariable, index) => {
		return `-[${edgeVariable}:FLOWS_TO]->(${index === edgeVariables.length - 1 ? "t" : intermediateVariables[index]}:Identity)`;
	}).join("");
	const amountPredicates = edgeVariables.map((edgeVariable) => `${edgeVariable}.amount_usd_sum IS NOT NULL${minAmountSum > 0 ? ` AND ${edgeVariable}.amount_usd_sum >= ${minAmountSum}` : ""}`);
	const predicates = [
		"s <> t",
		...["s", ...intermediateVariables].map((nodeVariable) => `${nodeVariable}.is_exchange IS NULL`),
		"t.is_exchange IS NOT NULL",
		...amountPredicates,
		...activityWindowPredicates(edgeVariables, activityWindow)
	];
	const depositVariable = nodeVariables[nodeVariables.length - 2];
	return {
		id: `forward_exchange_paths_${depth}`,
		query: [
			`MATCH (s:Identity {identity_id: "${escapeCypherString$1(address)}"})${relationshipChain}`,
			`WHERE ${predicates.join(" AND ")}`,
			`RETURN [${nodeVariables.map((nodeVariable) => `${nodeVariable}.identity_id`).join(", ")}] AS addresses, [${nodeVariables.map((nodeVariable) => `${nodeVariable}.labels`).join(", ")}] AS node_labels, [${nodeVariables.map(pathNodeMap$1).join(", ")}] AS path_nodes, [${edgeVariables.map(flowEdgeMap$1).join(", ")}] AS edge_props, t.identity_id AS exchange_address, t.labels AS exchange_display_labels, t.labels AS exchange_labels, t.is_exchange AS exchange_is_exchange, ${depositVariable}.identity_id AS deposit_address, ${depositVariable}.is_exchange AS deposit_is_exchange, ${depth} AS hops`,
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
		return `<-[${edgeVariable}:FLOWS_TO]-(${index === edgeVariables.length - 1 ? "source" : intermediateVariables[index]}:Identity)`;
	}).join("");
	const intermediatePredicates = intermediateVariables.map((nodeVariable) => `${nodeVariable}.is_exchange IS NULL`);
	return {
		id,
		query: [
			`MATCH (dep:Identity {identity_id: "${escapeCypherString$1(depositAddress)}"})`,
			`MATCH (dep)${relationshipChain}`,
			`WHERE source <> dep AND source.is_exchange IS NOT NULL${intermediatePredicates.length > 0 ? ` AND ${intermediatePredicates.join(" AND ")}` : ""}`,
			`RETURN dep.identity_id AS deposit_address, source.identity_id AS source_exchange, source.labels AS source_display_labels, source.labels AS source_labels, ${depth} AS hops, [${nodeVariables.map((nodeVariable) => `${nodeVariable}.identity_id`).join(", ")}] AS addresses, [${nodeVariables.map((nodeVariable) => `${nodeVariable}.labels`).join(", ")}] AS node_labels, [${nodeVariables.map(pathNodeMap$1).join(", ")}] AS path_nodes`,
			"LIMIT 20"
		].join(" ")
	};
}
function reverseLeadsQuery(depositAddresses) {
	return {
		id: "reverse_1hop",
		query: [
			"MATCH (sender:Identity)-[r:FLOWS_TO]->(deposit:Identity)",
			`WHERE (${depositAddresses.map((address) => `deposit.identity_id = "${escapeCypherString$1(address)}"`).join(" OR ")}) AND sender.is_exchange IS NULL AND sender.identity_id <> deposit.identity_id`,
			"RETURN DISTINCT sender.identity_id AS address, sender.labels AS display_labels, sender.labels AS system_labels, sender.risk_score AS risk_score, sender.risk_level AS risk_level, deposit.identity_id AS deposit_address, r.amount_usd_sum AS amount_usd",
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
			"MATCH (a:Identity)-[r:FLOWS_TO]->(b:Identity)",
			`WHERE (${pairs.map((pair) => `(a.identity_id = "${escapeCypherString$1(pair.src)}" AND b.identity_id = "${escapeCypherString$1(pair.dst)}")`).join(" OR ")})`,
			"RETURN a.identity_id AS src, b.identity_id AS dst, r.amount_usd_sum AS amount_usd_sum, r.tx_count AS tx_count, r.first_tx_id AS first_tx_id, r.last_tx_id AS last_tx_id, r.first_seen_timestamp AS first_seen_timestamp, r.last_seen_timestamp AS last_seen_timestamp",
			`LIMIT ${pairs.length}`
		].join(" ")
	};
}
function numberValue$1(value) {
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
	return numberValue$1(terminalEdge["amount_usd_sum"]);
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
		addresses: stringArrayValue$1(record["member_addresses"]),
		risk_score: numberValue$1(record["risk_score"]),
		risk_level: typeof record["risk_level"] === "string" && record["risk_level"].trim() ? record["risk_level"] : void 0,
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
		is_exchange: true
	};
	return {
		address: pathAddresses[pathAddresses.length - 2],
		exchangeAddress,
		exchangeLabels: stringArrayValue$1(row["exchange_labels"]),
		exchangeNode,
		amount_usd_sum: numberValue$1(terminalEdge["amount_usd_sum"]),
		hops: numberValue$1(row["hops"]) ?? pathAddresses.length - 1,
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
			const terminal = index === pathAddresses.length - 2;
			const key = `${src}->${dst}`;
			if (seenEdges.has(key)) continue;
			seenEdges.add(key);
			flows.push({
				hop: index + 1,
				src,
				dst,
				amount_usd_sum: numberValue$1(edge["amount_usd_sum"]) ?? 0,
				tx_count: numberValue$1(edge["tx_count"]),
				first_tx_id: typeof edge["first_tx_id"] === "string" ? edge["first_tx_id"] : void 0,
				last_tx_id: typeof edge["last_tx_id"] === "string" ? edge["last_tx_id"] : void 0,
				first_seen_timestamp: numberValue$1(edge["first_seen_timestamp"]),
				last_seen_timestamp: numberValue$1(edge["last_seen_timestamp"]),
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
	const batch = await callGraphBatch$1(remoteClient, network, [query]);
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
		flow.amount_usd_sum = numberValue$1(props["amount_usd_sum"]) ?? flow.amount_usd_sum;
		flow.tx_count = numberValue$1(props["tx_count"]);
		flow.first_tx_id = typeof props["first_tx_id"] === "string" ? props["first_tx_id"] : void 0;
		flow.last_tx_id = typeof props["last_tx_id"] === "string" ? props["last_tx_id"] : void 0;
		flow.first_seen_timestamp = numberValue$1(props["first_seen_timestamp"]) ?? flow.first_seen_timestamp;
		flow.last_seen_timestamp = numberValue$1(props["last_seen_timestamp"]) ?? flow.last_seen_timestamp;
	}
	for (const deposit of deposits) {
		const props = edgeProps.get(edgeKey$1(deposit.address, deposit.exchangeAddress));
		if (!props) continue;
		deposit.amount_usd_sum = numberValue$1(props["amount_usd_sum"]);
	}
}
async function collectProbeTrace(remoteClient, options) {
	const { flows, deposits } = flowsFromForwardRows(rowsMatchingMinimumAmount(((await callGraphBatch$1(remoteClient, options.network, [...forwardExchangeQueries(options.seedAddress, Math.max(options.perAddressLimit * 20, 200), options.minAmountSum, options.maxHops, options.activityWindow)])).facts?.queries ?? []).filter((query) => query.id?.startsWith("forward_exchange_paths_")).flatMap((query) => {
		if (query.ok === false) throw new Error(query.error || `Query failed: ${query.id}`);
		return query.results ?? [];
	}), options.minAmountSum));
	await hydrateDirectEdgeProps(remoteClient, options.network, flows, deposits);
	const uniqueDepositAddresses = [...new Set(deposits.map((deposit) => deposit.address))];
	const sourceMatches = [];
	const tracebackWarnings = [];
	if (options.includeDepositTraceback !== false && uniqueDepositAddresses.length > 0) {
		let backwardQueries = [];
		try {
			backwardQueries = (await callGraphBatch$1(remoteClient, options.network, uniqueDepositAddresses.slice(0, Math.max(1, Math.floor(20 / options.maxHops))).flatMap((address, index) => backwardSourceQueries(`backward_from_deposit_${index + 1}`, address, options.maxHops)))).facts?.queries ?? [];
		} catch (err) {
			tracebackWarnings.push(`deposit traceback batch failed: ${err.message}`);
		}
		for (const query of backwardQueries) {
			if (query.ok === false) {
				tracebackWarnings.push(`deposit traceback query ${query.id} failed: ${query.error || "unknown error"}`);
				continue;
			}
			for (const row of query.results ?? []) {
				const pathAddresses = stringArrayValue$1(row["addresses"]) ?? [];
				const pathNodes = Array.isArray(row["path_nodes"]) ? row["path_nodes"].map((node, index) => nodeMetadataFromValue(node, pathAddresses[index])).filter((node) => Boolean(node)) : void 0;
				const depositAddress = typeof row["deposit_address"] === "string" ? row["deposit_address"] : pathAddresses[0];
				const sourceExchange = typeof row["source_exchange"] === "string" ? row["source_exchange"] : pathAddresses[pathAddresses.length - 1];
				if (!depositAddress || !sourceExchange) continue;
				const sourceNode = {
					address: sourceExchange,
					labels: stringArrayValue$1(row["source_display_labels"]),
					system_labels: stringArrayValue$1(row["source_system_labels"]) ?? stringArrayValue$1(row["source_labels"])
				};
				sourceMatches.push({
					deposit_address: depositAddress,
					source_exchange: sourceExchange,
					source_labels: stringArrayValue$1(row["source_labels"]),
					sourceNode,
					hops: numberValue$1(row["hops"]) ?? Math.max(pathAddresses.length - 1, 0),
					path: pathAddresses,
					pathNodes
				});
			}
		}
	}
	const reverseLeads = [];
	if (options.includeDepositTraceback !== false && uniqueDepositAddresses.length > 0) {
		let reverseRows = [];
		try {
			const reverseBatch = await callGraphBatch$1(remoteClient, options.network, [reverseLeadsQuery(uniqueDepositAddresses)]);
			try {
				reverseRows = resultsFor(reverseBatch, "reverse_1hop");
			} catch (err) {
				tracebackWarnings.push(`deposit traceback query reverse_1hop failed: ${err.message}`);
			}
		} catch (err) {
			tracebackWarnings.push(`deposit traceback batch failed: ${err.message}`);
		}
		for (const row of reverseRows) {
			const address = typeof row["address"] === "string" ? row["address"] : "";
			const depositAddress = typeof row["deposit_address"] === "string" ? row["deposit_address"] : "";
			if (!address || !depositAddress) continue;
			const labels = stringArrayValue$1(row["display_labels"]) ?? stringArrayValue$1(row["labels"]) ?? [];
			const amountUsd = numberValue$1(row["amount_usd"]) ?? 0;
			const reason = labels.length > 0 ? "labeled_entity" : amountUsd > 1e5 ? "high_volume_sender" : "";
			if (!reason) continue;
			reverseLeads.push({
				address,
				labels,
				node: {
					address,
					labels,
					system_labels: stringArrayValue$1(row["system_labels"]),
					addresses: stringArrayValue$1(row["member_addresses"]),
					risk_score: numberValue$1(row["risk_score"]),
					risk_level: typeof row["risk_level"] === "string" && row["risk_level"].trim() ? row["risk_level"] : void 0
				},
				deposit_address: depositAddress,
				amount_usd: numberValue$1(row["amount_usd"]),
				reason
			});
		}
	}
	return {
		flows,
		deposits,
		sourceMatches,
		reverseLeads,
		tracebackWarnings
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
		if (metadata?.addresses?.length) node.memberAddresses = uniqueStrings$1([...node.memberAddresses ?? [], ...metadata.addresses]);
		if (metadata?.risk_score !== void 0) node.riskScore = metadata.risk_score;
		if (metadata?.risk_level) node.riskLevel = metadata.risk_level;
		if (role) node.roles.add(role);
		return node;
	};
	for (const flow of flows) {
		const src = mergeNode(flow.src, flow.src_node, void 0, flow.src_labels);
		src.out += flow.amount_usd_sum;
		const dst = mergeNode(flow.dst, flow.dst_node, void 0, flow.dst_labels);
		dst.in += flow.amount_usd_sum;
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
			amount_usd_sum: 0,
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
			...data.memberAddresses?.length ? { member_addresses: data.memberAddresses } : {},
			...data.riskScore !== void 0 ? { risk_score: data.riskScore } : {},
			...data.riskLevel ? { risk_level: data.riskLevel } : {},
			...data.roles.size > 0 ? { roles: [...data.roles] } : {},
			flow_in_usd: data.in,
			flow_out_usd: data.out
		})),
		edges: [
			...flows.map((flow) => ({
				source: flow.src,
				target: flow.dst,
				edge_type: "flows_to",
				usd_amount: flow.amount_usd_sum,
				amount_usd_sum: flow.amount_usd_sum,
				tx_count: flow.tx_count ?? 0,
				first_seen_timestamp: flow.first_seen_timestamp,
				last_seen_timestamp: flow.last_seen_timestamp,
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
				amount_usd_sum: lead.amount_usd ?? 0,
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
		"| Hop | Source | Destination | amount_usd_sum | tx_count | first_seen_timestamp | last_seen_timestamp | first_tx_id | terminal_exchange |",
		"|---:|---|---|---:|---:|---:|---:|---|---|",
		...flows.map((flow) => [
			`| ${flow.hop}`,
			`\`${flow.src}\``,
			`\`${flow.dst}\``,
			flow.amount_usd_sum,
			flow.tx_count ?? "",
			flow.first_seen_timestamp ?? "",
			flow.last_seen_timestamp ?? "",
			flow.first_tx_id ? `\`${flow.first_tx_id}\`` : "",
			flow.terminal_exchange ? "yes" : "no"
		].join(" | ") + " |"),
		"",
		"## Mermaid",
		"",
		"```mermaid",
		"flowchart LR",
		...flows.map((flow, index) => `  n${index}["${flow.src}"] -->|"amount_usd_sum ${flow.amount_usd_sum}${flow.terminal_exchange ? "; exchange endpoint" : ""}"| m${index}["${flow.dst}"]`),
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
			amount_usd_sum: flow.amount_usd_sum,
			tx_count: flow.tx_count,
			first_seen_timestamp: flow.first_seen_timestamp,
			last_seen_timestamp: flow.last_seen_timestamp,
			first_tx_id: flow.first_tx_id,
			last_tx_id: flow.last_tx_id,
			terminal_exchange: flow.terminal_exchange
		}))
	};
}
function tableCsv(flows) {
	const rows = ["hop,src,dst,amount_usd_sum,tx_count,first_seen_timestamp,last_seen_timestamp,first_tx_id,last_tx_id,terminal_exchange"];
	for (const flow of flows) rows.push([
		flow.hop,
		flow.src,
		flow.dst,
		flow.amount_usd_sum,
		flow.tx_count ?? "",
		flow.first_seen_timestamp ?? "",
		flow.last_seen_timestamp ?? "",
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
		"amount_usd_sum",
		"tx_count",
		"first_seen_timestamp",
		"last_seen_timestamp",
		"first_tx_id",
		"last_tx_id",
		"terminal_exchange_display"
	];
	const headerLabels = {
		hop: "Hop",
		src: "Source",
		dst: "Destination",
		amount_usd_sum: "amount_usd_sum",
		tx_count: "tx_count",
		first_seen_timestamp: "first_seen_timestamp",
		last_seen_timestamp: "last_seen_timestamp",
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
	const totalAmount = flows.reduce((sum, flow) => sum + flow.amount_usd_sum, 0);
	const byHop = /* @__PURE__ */ new Map();
	for (const flow of flows) byHop.set(flow.hop, (byHop.get(flow.hop) ?? 0) + 1);
	const depositCount = continuation.depositAddresses.length;
	const exchangeCount = continuation.exchangeAddresses.length;
	const hasFiles = Object.values(files).some((value) => value.length > 0);
	return [
		`Trace complete for ${network}:${seedAddress}`,
		"",
		`Facts: ${flows.length} FLOWS_TO edge(s), sum of traced edge amount_usd_sum values ${Number(totalAmount.toFixed(8))}.`,
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
	if (options.activityWindow && (!Number.isFinite(options.activityWindow.fromMs) || options.activityWindow.toMs !== void 0 && !Number.isFinite(options.activityWindow.toMs))) throw new Error("activity window timestamps must be finite numbers");
	const maxHops = clampInt$1(options.maxHops, 3, 1, 5);
	const perAddressLimit = clampInt$1(options.perAddressLimit, 5, 1, 10);
	const minAmountSum = Math.max(0, options.minAmountSum ?? 0);
	const evidenceSource = options.evidenceSource ?? "track_funds";
	const paths = options.writeArtifacts !== false ? workspaceOutputPaths() : void 0;
	if (paths) await ensureDirs(paths);
	const schemaResult = paths ? await loadOrCaptureTopologySchema(remoteClient, paths, network) : {
		schema: {
			schema: "chain-insights.runtime_graph_schema.v1",
			network,
			source: "stateless_proxy_mode"
		},
		filePath: "stateless://runtime-schema-not-written"
	};
	const { flows, deposits, sourceMatches, reverseLeads, tracebackWarnings } = await collectProbeTrace(remoteClient, {
		seedAddress,
		network,
		maxHops,
		perAddressLimit,
		minAmountSum,
		activityWindow: options.activityWindow,
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
		const { generateInlineGraphHtml } = await import("./html-generator-D8FWMzBw.mjs").then((n) => n.n);
		await writeFile(compactPath, JSON.stringify(compact, null, 2) + "\n", { mode: 384 });
		await writeFile(graphPath, JSON.stringify(graph, null, 2) + "\n", { mode: 384 });
		await writeFile(graphHtmlPath, generateInlineGraphHtml(graph), { mode: 384 });
		await writeFile(tablePath, tableCsv(flows), { mode: 384 });
		await writeFile(tableHtmlPath, buildTableHtml(seedAddress, network, flows, deposits, sourceMatches, reverseLeads), { mode: 384 });
		await writeFile(reportPath, buildMarkdownReport(seedAddress, network, flows, deposits, sourceMatches, reverseLeads, aliases, graphPath, schemaResult.filePath), { mode: 384 });
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
		addressMap: aliases.compactAddressMap(),
		tracebackWarnings
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
const CANONICAL_HEX_FORM_PATTERN = /^0x[0-9a-fA-F]+$/;
function memberFormOf(input, network) {
	const prefix = `${network}:`;
	return input.startsWith(prefix) ? input.slice(prefix.length) : input;
}
function canonicalIdentityKeyFor(network, memberForm) {
	if (!CANONICAL_HEX_FORM_PATTERN.test(memberForm)) return void 0;
	return `${network}:${memberForm.toLowerCase()}`;
}
function memberAddressResolutionQuery(id, memberForm) {
	return {
		id,
		query: [
			`MATCH (m:Address {address: "${escapeCypherString(memberForm)}"})<-[:HAS_ADDRESS]-(i:Identity)`,
			"RETURN i.identity_id AS identity_id",
			"LIMIT 1"
		].join(" ")
	};
}
function identityMemberAddressesQuery(identityKeys) {
	return {
		id: "identity_member_addresses",
		query: [
			"MATCH (i:Identity)-[:HAS_ADDRESS]->(m:Address)",
			`WHERE ${identityKeys.map((identityKey) => `i.identity_id = "${escapeCypherString(identityKey)}"`).join(" OR ")}`,
			"RETURN i.identity_id AS identity_id, collect(m.address) AS member_addresses",
			`LIMIT ${identityKeys.length}`
		].join(" ")
	};
}
/**
* Resolve public tool address inputs to canonical identity keys.
*
* Inputs already in canonical 0x form (with or without the network prefix)
* are derived locally as `<network>:<lowercase 0x form>`. Any other member
* form (for example an SS58 substrate address) is resolved through the
* indexed `(:Address {address})<-[:HAS_ADDRESS]-(:Identity)` lookup.
* Inputs the graph cannot resolve are passed through unchanged.
*/
async function resolveIdentityKeys(remoteClient, network, inputs) {
	const resolved = /* @__PURE__ */ new Map();
	const pending = [];
	for (const input of [...new Set(inputs.map((value) => value.trim()).filter(Boolean))]) {
		const canonical = canonicalIdentityKeyFor(network, memberFormOf(input, network));
		if (canonical) resolved.set(input, canonical);
		else pending.push(input);
	}
	if (pending.length === 0) return resolved;
	const batch = await callGraphBatch(remoteClient, network, pending.map((input, index) => memberAddressResolutionQuery(`resolve_member_address_${index + 1}`, memberFormOf(input, network))));
	const failures = [];
	pending.forEach((input, index) => {
		const identityId = firstString(optionalResultsFor(batch, `resolve_member_address_${index + 1}`, failures)[0]?.["identity_id"]);
		resolved.set(input, identityId ?? input);
	});
	return resolved;
}
function collectIdentityKeys(value, network, keys = /* @__PURE__ */ new Set()) {
	const prefix = `${network}:`;
	if (typeof value === "string") {
		if (value.startsWith(prefix)) keys.add(value);
		return keys;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectIdentityKeys(item, network, keys);
		return keys;
	}
	if (typeof value === "object" && value !== null) for (const item of Object.values(value)) collectIdentityKeys(item, network, keys);
	return keys;
}
async function identityDisplayMap(remoteClient, network, identityKeys, preferredByIdentity = /* @__PURE__ */ new Map()) {
	const uniqueKeys = [...new Set(identityKeys.filter((key) => key.startsWith(`${network}:`)))];
	const memberRows = /* @__PURE__ */ new Map();
	if (uniqueKeys.length > 0) try {
		const batch = await callGraphBatch(remoteClient, network, [identityMemberAddressesQuery(uniqueKeys)]);
		for (const row of optionalResultsFor(batch, "identity_member_addresses", [])) {
			const identityKey = firstString(row["identity_id"]);
			if (!identityKey) continue;
			memberRows.set(identityKey, stringArrayValue(row["member_addresses"]) ?? []);
		}
	} catch {}
	return new Map(uniqueKeys.map((identityKey) => {
		const preferred = preferredByIdentity.get(identityKey);
		const members = memberRows.get(identityKey) ?? [];
		return [identityKey, {
			canonical_identity_key: identityKey,
			address: preferred ? memberFormOf(preferred, network) : members[0] ?? memberFormOf(identityKey, network),
			member_addresses: members
		}];
	}));
}
function replaceIdentityKeysDeep(value, displayByIdentity) {
	if (typeof value === "string") return replaceIdentityKeysInText(value, displayByIdentity);
	if (Array.isArray(value)) return value.map((item) => replaceIdentityKeysDeep(item, displayByIdentity));
	if (typeof value !== "object" || value === null) return value;
	return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replaceIdentityKeysDeep(entry, displayByIdentity)]));
}
function replaceIdentityKeysInText(value, displayByIdentity) {
	return [...displayByIdentity.entries()].sort((a, b) => b[0].length - a[0].length).reduce((text, [identityKey, info]) => text.replaceAll(identityKey, info.address), value);
}
function identityResolution(displayByIdentity) {
	return [...displayByIdentity.values()].sort((a, b) => a.address.localeCompare(b.address));
}
async function publicizeIdentityResult(remoteClient, network, result, preferredByIdentity = /* @__PURE__ */ new Map()) {
	const displayByIdentity = await identityDisplayMap(remoteClient, network, [
		...collectIdentityKeys(result.summaryText, network),
		...collectIdentityKeys(result.structuredContent, network),
		...collectIdentityKeys(result.graphData, network)
	], preferredByIdentity);
	if (displayByIdentity.size === 0) return result;
	return {
		...result,
		summaryText: replaceIdentityKeysInText(result.summaryText, displayByIdentity),
		structuredContent: {
			...replaceIdentityKeysDeep(result.structuredContent, displayByIdentity),
			identity_resolution: identityResolution(displayByIdentity)
		},
		graphData: replaceIdentityKeysDeep(result.graphData, displayByIdentity)
	};
}
function addressProfileQuery(address) {
	return {
		id: "address_profile",
		query: [
			`MATCH (a:Identity {identity_id: "${escapeCypherString(address)}"})`,
			"RETURN a.identity_id AS address, a.labels AS display_labels, a.labels AS system_labels, a.risk_score AS live_risk_score, a.risk_level AS live_risk_level, a.is_exchange AS is_exchange",
			"LIMIT 1"
		].join(" ")
	};
}
function memberAddressesQuery(address) {
	return {
		id: "member_addresses",
		query: [`MATCH (a:Identity {identity_id: "${escapeCypherString(address)}"})-[:HAS_ADDRESS]->(m:Address)`, "RETURN collect(m.address) AS member_addresses"].join(" ")
	};
}
function addressFeatureQuery(address) {
	return {
		id: "address_feature",
		query: [
			"USE facts",
			`MATCH (a:Identity {identity_id: "${escapeCypherString(address)}"})-[:HAS_FEATURE]->(feature:AddressFeature)`,
			"RETURN feature.degree_in AS degree_in, feature.degree_out AS degree_out, feature.degree_total AS degree_total, feature.tx_in_count AS tx_in_count, feature.tx_out_count AS tx_out_count, feature.tx_total_count AS tx_total_count, feature.total_volume_usd AS total_volume_usd, feature.total_in_usd AS total_in_usd, feature.total_out_usd AS total_out_usd, feature.net_flow_usd AS net_flow_usd, feature.first_activity_timestamp AS first_activity_timestamp, feature.last_activity_timestamp AS last_activity_timestamp, feature.activity_span_days AS activity_span_days",
			"LIMIT 1"
		].join(" ")
	};
}
function addressRiskScoreQuery(address) {
	return {
		id: "address_risk_score",
		query: [
			"USE facts",
			`MATCH (a:Identity {identity_id: "${escapeCypherString(address)}"})-[:HAS_RISK_SCORE]->(risk:RiskScore)`,
			"RETURN risk.risk_score AS ml_risk_score, risk.window_days AS risk_window_days, risk.processing_date AS risk_processing_date, risk.xgboost_model_version AS xgboost_model_version, risk.gnn_model_version AS gnn_model_version, risk.shap_top_features AS shap_top_features",
			"LIMIT 1"
		].join(" ")
	};
}
function addressLabelRiskQuery(address) {
	return {
		id: "address_label_risk",
		query: [
			"USE facts",
			`MATCH (a:Identity {identity_id: "${escapeCypherString(address)}"})-[:HAS_LABEL]->(label:AddressLabel)`,
			"RETURN label.label AS label, label.risk_level AS risk_level, label.trust_level AS trust_level, label.confidence_score AS confidence_score, label.source AS source, label.entity_type AS entity_type, label.updated_timestamp AS updated_timestamp",
			"LIMIT 10"
		].join(" ")
	};
}
function flowEdgeMap(variableName) {
	return `{amount_usd_sum: ${variableName}.amount_usd_sum, tx_count: ${variableName}.tx_count, first_seen_timestamp: ${variableName}.first_seen_timestamp, last_seen_timestamp: ${variableName}.last_seen_timestamp, first_tx_id: ${variableName}.first_tx_id, last_tx_id: ${variableName}.last_tx_id}`;
}
function pathNodeMap(variableName) {
	return `{address: ${variableName}.identity_id, labels: ${variableName}.labels, system_labels: ${variableName}.labels, risk_score: ${variableName}.risk_score, risk_level: ${variableName}.risk_level, is_exchange: ${variableName}.is_exchange}`;
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
		return `-[${edgeVariable}:FLOWS_TO]->(${index === edgeVariables.length - 1 ? "exchange" : intermediateVariables[index]}:Identity)`;
	}).join("");
	const intermediatePredicates = intermediateVariables.map((nodeVariable) => `${nodeVariable}.is_exchange IS NULL`);
	const depositVariable = nodeVariables[nodeVariables.length - 2];
	const terminalEdgeVariable = edgeVariables[edgeVariables.length - 1];
	return {
		id: `exchange_outflows_${depth}`,
		query: [
			`MATCH (a:Identity {identity_id: "${escapeCypherString(address)}"})${relationshipChain}`,
			`WHERE a <> exchange AND exchange.is_exchange IS NOT NULL${intermediatePredicates.length > 0 ? ` AND ${intermediatePredicates.join(" AND ")}` : ""}`,
			`RETURN "outflow" AS direction, exchange.identity_id AS exchange_address, exchange.labels AS exchange_display_labels, exchange.labels AS exchange_system_labels, ${depositVariable}.identity_id AS deposit_address, ${depth} AS hops, ${terminalEdgeVariable}.amount_usd_sum AS amount_usd_sum, ${terminalEdgeVariable}.tx_count AS tx_count, ${terminalEdgeVariable}.first_seen_timestamp AS first_seen_timestamp, ${terminalEdgeVariable}.last_seen_timestamp AS last_seen_timestamp, [${nodeVariables.map((nodeVariable) => `${nodeVariable}.identity_id`).join(", ")}] AS addresses, [${nodeVariables.map(pathNodeMap).join(", ")}] AS path_nodes, [${edgeVariables.map(flowEdgeMap).join(", ")}] AS edge_props`,
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
		return `-[${edgeVariable}:FLOWS_TO]->(${index === edgeVariables.length - 1 ? "a" : intermediateVariables[index]}:Identity)`;
	}).join("");
	const intermediatePredicates = intermediateVariables.map((nodeVariable) => `${nodeVariable}.is_exchange IS NULL`);
	const withdrawalVariable = nodeVariables[1];
	const terminalEdgeVariable = edgeVariables[edgeVariables.length - 1];
	return {
		id: `exchange_inflows_${depth}`,
		query: [
			`MATCH (exchange:Identity)${relationshipChain}`,
			`WHERE a.identity_id = "${escapeCypherString(address)}" AND a <> exchange AND exchange.is_exchange IS NOT NULL${intermediatePredicates.length > 0 ? ` AND ${intermediatePredicates.join(" AND ")}` : ""}`,
			`RETURN "inflow" AS direction, exchange.identity_id AS exchange_address, exchange.labels AS exchange_display_labels, exchange.labels AS exchange_system_labels, ${withdrawalVariable}.identity_id AS withdrawal_address, ${depth} AS hops, ${terminalEdgeVariable}.amount_usd_sum AS amount_usd_sum, ${terminalEdgeVariable}.tx_count AS tx_count, ${terminalEdgeVariable}.first_seen_timestamp AS first_seen_timestamp, ${terminalEdgeVariable}.last_seen_timestamp AS last_seen_timestamp, [${nodeVariables.map((nodeVariable) => `${nodeVariable}.identity_id`).join(", ")}] AS addresses, [${nodeVariables.map(pathNodeMap).join(", ")}] AS path_nodes, [${edgeVariables.map(flowEdgeMap).join(", ")}] AS edge_props`,
			"ORDER BY hops ASC",
			"LIMIT 200"
		].join(" ")
	};
}
function connectionProbeQuery(address, compareAddress) {
	return {
		id: "connection_probe",
		query: [
			`MATCH (a:Identity {identity_id: "${escapeCypherString(address)}"})-[r:FLOWS_TO]-(b:Identity {identity_id: "${escapeCypherString(compareAddress)}"})`,
			"RETURN [a.identity_id, b.identity_id] AS addresses, 1 AS hops",
			"LIMIT 5"
		].join(" ")
	};
}
function formatExchangeRows(rows) {
	return rows.map((row) => {
		const direction = String(row["direction"] ?? "flow");
		const exchange = String(row["exchange_address"] ?? "");
		const amount = row["amount_usd_sum"] ?? "";
		return `- ${direction}: ${exchange} (${row["hops"] ?? ""} hop(s), amount_usd_sum ${amount})`;
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
function riskDrivers(profile, labelRows, exchangeRows) {
	const drivers = [];
	const shapDrivers = stringArrayValue(profile["shap_top_features"]);
	if (shapDrivers?.length) drivers.push(`Top model features: ${shapDrivers.join(", ")}`);
	const riskLabels = labelRows.map((row) => firstString(row["label"])).filter((label) => Boolean(label));
	if (riskLabels.length > 0) drivers.push(`Labels: ${[...new Set(riskLabels)].join("; ")}`);
	const outflowCount = exchangeRows.filter((row) => row["direction"] === "outflow").length;
	const inflowCount = exchangeRows.filter((row) => row["direction"] === "inflow").length;
	if (outflowCount > 0) drivers.push(`Forward bounded search reached ${outflowCount} exchange path(s).`);
	if (inflowCount > 0) drivers.push(`Backward bounded search found ${inflowCount} source exchange path(s).`);
	return [...new Set(drivers)];
}
const RISK_LEVEL_ORDER = [
	"critical",
	"high",
	"medium",
	"low"
];
function strongestLabelRiskLevel(labelRows) {
	const levels = labelRows.map((row) => firstString(row["risk_level"])?.toLowerCase()).filter((level) => Boolean(level && RISK_LEVEL_ORDER.includes(level)));
	if (levels.length === 0) return void 0;
	return RISK_LEVEL_ORDER.find((candidate) => levels.includes(candidate));
}
function riskScoreSources(profile, labelRows) {
	const sources = [];
	if (numberValue(profile["ml_risk_score"]) !== void 0) sources.push({
		family: "ml_risk_score",
		layer: "facts",
		view: "facts_risk_scores_view",
		xgboost_model_version: profile["xgboost_model_version"],
		gnn_model_version: profile["gnn_model_version"],
		processing_date: profile["risk_processing_date"],
		window_days: profile["risk_window_days"]
	});
	if (labelRows.length > 0) sources.push({
		family: "label_risk",
		layer: "facts",
		view: "facts_address_labels_view",
		labels: labelRows.map((row) => ({
			label: row["label"],
			risk_level: row["risk_level"],
			trust_level: row["trust_level"],
			confidence_score: row["confidence_score"],
			source: row["source"]
		}))
	});
	return sources;
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
			amount_usd_sum: row["amount_usd_sum"] ?? terminal["amount_usd_sum"],
			tx_count: row["tx_count"] ?? terminal["tx_count"],
			first_seen_timestamp: row["first_seen_timestamp"] ?? terminal["first_seen_timestamp"],
			last_seen_timestamp: row["last_seen_timestamp"] ?? terminal["last_seen_timestamp"],
			first_tx_id: row["first_tx_id"] ?? terminal["first_tx_id"],
			last_tx_id: row["last_tx_id"] ?? terminal["last_tx_id"]
		};
	});
}
const FALLBACK_SHARED_TX_COUNT = 1e3;
const FALLBACK_SHARED_USD_SUM = 5e6;
const FALLBACK_SHARED_DAMPING = .1;
const FALLBACK_VALUE_SATURATION_USD = 1e6;
const FALLBACK_BASE_SCORE = .1;
const FALLBACK_MAX_SCORE = .6;
/**
* Score exchange exposure when no ML risk score exists. Topology-grain:
* log-scaled USD volume across exchange rows, with shared/omnibus edges
* (high tx_count or USD throughput) dampened, bounded in (0, 0.6] so a
* fallback can never impersonate a high ML score band.
*/
function exchangeExposureFallbackScore(exchangeRows) {
	if (exchangeRows.length === 0) return 0;
	let weightedUsd = 0;
	for (const row of exchangeRows) {
		const usd = numberValue(row["amount_usd_sum"]) ?? 0;
		const shared = (numberValue(row["tx_count"]) ?? 0) >= FALLBACK_SHARED_TX_COUNT || usd >= FALLBACK_SHARED_USD_SUM;
		weightedUsd += shared ? usd * FALLBACK_SHARED_DAMPING : usd;
	}
	const factor = Math.log10(1 + Math.min(weightedUsd, FALLBACK_VALUE_SATURATION_USD)) / Math.log10(1 + FALLBACK_VALUE_SATURATION_USD);
	return Math.min(FALLBACK_MAX_SCORE, FALLBACK_BASE_SCORE + (FALLBACK_MAX_SCORE - FALLBACK_BASE_SCORE) * factor);
}
function riskAssessment(profile, labelRows, exchangeRows) {
	const mlRiskScore = firstNumber(profile["ml_risk_score"]);
	const labelRiskLevel = strongestLabelRiskLevel(labelRows);
	const score = mlRiskScore ?? exchangeExposureFallbackScore(exchangeRows);
	const level = labelRiskLevel ?? riskLevelFromScore(score);
	const drivers = riskDrivers(profile, labelRows, exchangeRows);
	return {
		level,
		score,
		...mlRiskScore !== void 0 ? { ml_risk_score: mlRiskScore } : {},
		confidence: mlRiskScore !== void 0 || labelRiskLevel ? "high" : exchangeRows.length > 0 ? "medium" : "low",
		recommendation: riskRecommendation(level),
		drivers,
		sources: riskScoreSources(profile, labelRows)
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
		...stringArrayValue(profile["member_addresses"])?.length ? { member_addresses: stringArrayValue(profile["member_addresses"]) } : {},
		...numberValue(profile["live_risk_score"]) !== void 0 ? { risk_score: numberValue(profile["live_risk_score"]) } : {},
		...firstString(profile["live_risk_level"]) ? { risk_level: firstString(profile["live_risk_level"]) } : {},
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
		const memberAddresses = stringArrayValue(metadata?.["member_addresses"]) ?? existing["member_addresses"];
		const riskScore = numberValue(metadata?.["risk_score"]) ?? existing["risk_score"];
		const riskLevel = firstString(metadata?.["risk_level"]) ?? existing["risk_level"];
		nodes.set(entry, {
			...existing,
			labels,
			...systemLabels ? { system_labels: systemLabels } : {},
			...Array.isArray(memberAddresses) && memberAddresses.length > 0 ? { member_addresses: memberAddresses } : {},
			...riskScore !== void 0 ? { risk_score: riskScore } : {},
			...riskLevel ? { risk_level: riskLevel } : {}
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
				roles: ["exchange"]
			});
		}
		for (let index = 0; index < path.length - 1; index += 1) {
			const edge = (Array.isArray(row["edge_props"]) ? row["edge_props"] : [])[index] ?? row;
			edges.push({
				source: path[index],
				target: path[index + 1],
				edge_type: "flows_to",
				usd_amount: edge["amount_usd_sum"] ?? 0,
				amount_usd_sum: edge["amount_usd_sum"] ?? 0,
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
	const inputAddress = options.address.trim();
	const network = options.network.trim();
	const compareInput = options.compareAddress?.trim() ?? "";
	if (!inputAddress) throw new Error("address is required");
	if (!network) throw new Error("network is required");
	const resolvedKeys = await resolveIdentityKeys(remoteClient, network, [inputAddress, ...compareInput ? [compareInput] : []]);
	const address = resolvedKeys.get(inputAddress) ?? inputAddress;
	const compareAddress = compareInput ? resolvedKeys.get(compareInput) ?? compareInput : "";
	const preferredByIdentity = new Map([[address, inputAddress], ...compareAddress ? [[compareAddress, compareInput]] : []]);
	const batch = await callGraphBatch(remoteClient, network, [
		addressProfileQuery(address),
		memberAddressesQuery(address),
		addressFeatureQuery(address),
		addressRiskScoreQuery(address),
		addressLabelRiskQuery(address),
		...exchangeOutflowQueries(address),
		...exchangeInflowQueries(address),
		...compareAddress ? [connectionProbeQuery(address, compareAddress)] : [{
			id: "connection_probe",
			query: "MATCH (n:Identity {identity_id: \"__chain_insights_noop__\"}) RETURN n.identity_id AS noop LIMIT 0"
		}]
	]);
	const partialQueryFailures = [];
	const profile = {
		address,
		...optionalResultsFor(batch, "address_profile", partialQueryFailures)[0] ?? {},
		...optionalResultsFor(batch, "member_addresses", partialQueryFailures)[0] ?? {},
		...optionalResultsFor(batch, "address_feature", partialQueryFailures)[0] ?? {},
		...optionalResultsFor(batch, "address_risk_score", partialQueryFailures)[0] ?? {}
	};
	const labelRows = optionalResultsFor(batch, "address_label_risk", partialQueryFailures);
	const outflows = enrichExchangeRows(optionalResultsWithPrefix(batch, "exchange_outflows_", partialQueryFailures));
	const inflows = enrichExchangeRows(optionalResultsWithPrefix(batch, "exchange_inflows_", partialQueryFailures));
	const connections = compareAddress ? optionalResultsFor(batch, "connection_probe", partialQueryFailures) : [];
	const exchangeRows = [...outflows, ...inflows];
	const graphData = buildRiskGraph(address, profile, exchangeRows, network);
	const risk = riskAssessment(profile, labelRows, exchangeRows);
	const memberAddresses = stringArrayValue(profile["member_addresses"]) ?? [];
	const liveRiskScore = numberValue(profile["live_risk_score"]);
	const liveRiskLevel = firstString(profile["live_risk_level"]);
	const liveNodeVerdict = liveRiskScore !== void 0 || liveRiskLevel ? {
		...liveRiskScore !== void 0 ? { risk_score: liveRiskScore } : {},
		...liveRiskLevel ? { risk_level: liveRiskLevel } : {},
		source: "live_topology_node"
	} : void 0;
	const lines = [
		`Address risk for ${network}:${address}`,
		"",
		`Risk: ${risk["level"]} (${formatRiskScore(risk["score"])})`,
		`Confidence: ${risk["confidence"]}`,
		`Recommendation: ${risk["recommendation"]}`,
		...liveNodeVerdict ? [`Live node triage: ${liveRiskLevel ?? "unknown"} (${formatRiskScore(liveRiskScore)})`] : [],
		`Member addresses: ${memberAddresses.join(", ") || "unknown"}.`,
		`Graph degree: in ${profile["degree_in"] ?? "unknown"}, out ${profile["degree_out"] ?? "unknown"}.`,
		"",
		"Exchange behavior",
		exchangeRows.length > 0 ? formatExchangeRows(exchangeRows).join("\n") : "- No exchange inflow/outflow paths found in bounded search."
	];
	if (Array.isArray(risk["drivers"]) && risk["drivers"].length > 0) lines.push("", "Risk drivers", risk["drivers"].map((driver) => `- ${driver}`).join("\n"));
	if (compareAddress) lines.push("", `Connection compare target: ${compareAddress}`, connections.length > 0 ? `Connection paths found: ${connections.length}` : "Connection paths found: 0");
	if (partialQueryFailures.length > 0) lines.push("", "Partial query failures", partialQueryFailures.map((failure) => `- ${failure.id}: ${failure.error}`).join("\n"));
	const publicResult = await publicizeIdentityResult(remoteClient, network, {
		summaryText: lines.join("\n"),
		structuredContent: {
			schema: "chain-insights.result.v1",
			tool: "aml_address_risk",
			facts: {
				subject: {
					network,
					addresses: compareAddress ? [address, compareAddress] : [address],
					...memberAddresses.length > 0 ? { member_addresses: memberAddresses } : {}
				},
				risk: {
					...risk,
					...liveNodeVerdict ? { live_node: liveNodeVerdict } : {}
				},
				exchange_behavior: {
					outflows,
					inflows
				},
				connection: compareAddress ? {
					compare_address: compareAddress,
					paths: connections
				} : void 0,
				partial_query_errors: partialQueryFailures.length > 0 ? partialQueryFailures : void 0
			},
			artifacts: statelessArtifacts(),
			evidence: [{
				evidence_type: "tool_summary",
				summary: `aml_address_risk ${address} completed for ${network}`
			}]
		},
		graphData
	}, preferredByIdentity);
	const publicSubjectAddresses = (publicResult.structuredContent.facts?.subject)?.addresses;
	const publicSubjectAddress = Array.isArray(publicSubjectAddresses) && typeof publicSubjectAddresses[0] === "string" ? publicSubjectAddresses[0] : memberFormOf(inputAddress, network);
	const publicCompareAddress = Array.isArray(publicSubjectAddresses) && typeof publicSubjectAddresses[1] === "string" ? publicSubjectAddresses[1] : compareAddress;
	const artifacts = options.writeArtifacts ? await writeAddressRiskArtifacts(network, publicSubjectAddress, publicCompareAddress, publicResult.graphData, exchangeRows, publicResult.summaryText) : statelessArtifacts();
	const evidence = artifactEvidence(artifacts);
	return {
		summaryText: publicResult.summaryText,
		structuredContent: {
			...publicResult.structuredContent,
			artifacts,
			evidence: [...evidence, {
				evidence_type: "tool_summary",
				summary: `aml_address_risk ${inputAddress} completed for ${network}`
			}]
		},
		graphData: publicResult.graphData
	};
}
function uniqueStrings(values) {
	return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}
function clampInt(value, fallback, min, max) {
	if (!Number.isFinite(value)) return fallback;
	return Math.max(min, Math.min(max, Math.trunc(value)));
}
function traceActivityWindow(incidentTimestampMs, timeRange) {
	const fromMs = timeRange?.from_ms ?? incidentTimestampMs;
	if (fromMs === void 0) return void 0;
	return {
		fromMs,
		...timeRange?.to_ms !== void 0 ? { toMs: timeRange.to_ms } : {}
	};
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
function traceArtifactSummary(artifacts) {
	return [
		"Files written:",
		`- compact evidence JSON: ${artifacts["table_json"] ?? ""}`,
		`- graph JSON: ${artifacts["graph_json"] ?? ""}`,
		`- graph HTML: ${artifacts["graph_html"] ?? ""}`,
		`- flows CSV: ${artifacts["flows_csv"] ?? ""}`,
		`- table HTML: ${artifacts["table_html"] ?? ""}`,
		`- report: ${artifacts["report_md"] ?? ""}`
	].join("\n");
}
function stripTraceFileSections(summaryText) {
	const lines = summaryText.split("\n");
	const kept = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (line === "Files written: disabled by stateless proxy mode.") {
			if (lines[index + 1] === "") index += 1;
			continue;
		}
		if (line === "Files written:") {
			index += 1;
			while (index < lines.length && lines[index]?.startsWith("- ")) index += 1;
			if (lines[index] !== "") index -= 1;
			continue;
		}
		kept.push(line);
	}
	return kept.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}
function withTraceArtifactSummary(summaryText, artifacts) {
	return [
		stripTraceFileSections(summaryText),
		"",
		traceArtifactSummary(artifacts)
	].filter((part) => part.length > 0).join("\n");
}
function toCsvValue(value) {
	return value === void 0 || value === null ? "" : String(value);
}
function subjectNodeForExchangeRow(row, fallbackAddress) {
	return String(row["direction"] === "inflow" ? row["withdrawal_address"] ?? row["deposit_address"] ?? fallbackAddress : row["deposit_address"] ?? row["withdrawal_address"] ?? fallbackAddress);
}
function buildAddressRiskTableHtml(tool, network, rows, subject) {
	const headers = [
		"direction",
		"exchange_address",
		"subject_path_node",
		"hops",
		"amount_usd_sum",
		"tx_count"
	];
	const body = rows.map((row) => {
		const exchangeAddress = String(row["exchange_address"] ?? "");
		const subjectNode = subjectNodeForExchangeRow(row, subject);
		return `<tr>${[
			row["direction"] ?? "",
			exchangeAddress,
			subjectNode,
			row["hops"] ?? "",
			row["amount_usd_sum"] ?? "",
			row["tx_count"] ?? ""
		].map((value) => `<td>${htmlEscape(toCsvValue(value))}</td>`).join("")}</tr>`;
	}).join("\n");
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEscape(tool)} Risk Table</title>
<style>
  :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui; background: #0b0d12; color: #f4f2ea; }
  body { margin: 0; background: #0b0d12; color: #f4f2ea; }
  main { padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 8px; font-weight: 650; }
  table { border-collapse: collapse; width: 100%; min-width: 900px; }
  th, td { border-bottom: 1px solid rgba(255,255,255,.08); padding: 8px 10px; text-align: left; }
  th { position: sticky; top: 0; background: #161a24; color: #f2dda6; font-weight: 600; }
</style>
</head>
<body>
<main>
  <h1>${htmlEscape(tool)} Table</h1>
  <div>Network: <strong>${htmlEscape(network)}</strong></div>
  <div>Generated: <strong>${htmlEscape((/* @__PURE__ */ new Date()).toISOString())}</strong></div>
  <table>
    <thead><tr>${headers.map((header) => `<th>${htmlEscape(header)}</th>`).join("")}</tr></thead>
    <tbody>${body}</tbody>
  </table>
</main>
</body>
</html>
`;
}
async function writeAddressRiskArtifacts(network, address, compareAddress, graphData, exchangeRows, summaryText) {
	const paths = workspaceOutputPaths();
	await Promise.all([
		mkdir(paths.reportsRoot, { recursive: true }),
		mkdir(paths.reportGraphsRoot, { recursive: true }),
		mkdir(paths.reportTablesRoot, { recursive: true })
	]);
	const safeNetwork = network.replace(/[^A-Za-z0-9._-]+/g, "_");
	const safeAddress = address.replace(/[^A-Za-z0-9._-]+/g, "_");
	const slug = `${(/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}_aml_address_risk_${safeNetwork}_${safeAddress}`;
	const graphPath = path.join(paths.reportGraphsRoot, `${slug}.graph.json`);
	const tableJsonPath = path.join(paths.reportTablesRoot, `${slug}.compact-evidence.json`);
	const csvPath = path.join(paths.reportTablesRoot, `${slug}.flows.csv`);
	const tableHtmlPath = path.join(paths.reportsRoot, `${slug}.table.html`);
	const reportPath = path.join(paths.reportsRoot, `${slug}.aml-address-report.md`);
	const graphHtmlPath = path.join(paths.reportsRoot, `${slug}.graph.html`);
	const { generateInlineGraphHtml } = await import("./html-generator-D8FWMzBw.mjs").then((n) => n.n);
	const csv = [[
		"direction",
		"exchange_address",
		"subject_path_node",
		"hops",
		"amount_usd_sum",
		"tx_count"
	].join(","), ...exchangeRows.map((row) => {
		const exchangeAddress = String(row["exchange_address"] ?? "");
		const subjectPathNode = subjectNodeForExchangeRow(row, address);
		return [
			row["direction"] ?? "",
			exchangeAddress,
			subjectPathNode,
			row["hops"] ?? "",
			row["amount_usd_sum"] ?? "",
			row["tx_count"] ?? ""
		].map((value) => JSON.stringify(String(value))).join(",");
	})].join("\n") + "\n";
	const evidence = {
		schema: "chain-insights.trace.v1",
		tool: "aml_address_risk",
		network,
		input: {
			address,
			...compareAddress ? { compare_address: compareAddress } : {}
		},
		profile: {
			exchange_rows: exchangeRows.map((row) => ({
				direction: row["direction"],
				exchange_address: row["exchange_address"],
				subject_node: subjectNodeForExchangeRow(row, address),
				hops: row["hops"],
				amount_usd_sum: row["amount_usd_sum"],
				tx_count: row["tx_count"]
			})),
			report_summary: summaryText
		}
	};
	await writeFile(graphPath, JSON.stringify(graphData, null, 2) + "\n", { mode: 384 });
	await writeFile(tableJsonPath, JSON.stringify(evidence, null, 2) + "\n", { mode: 384 });
	await writeFile(csvPath, csv, { mode: 384 });
	await writeFile(tableHtmlPath, buildAddressRiskTableHtml("aml_address_risk", network, exchangeRows, address), { mode: 384 });
	await writeFile(graphHtmlPath, generateInlineGraphHtml(graphData), { mode: 384 });
	await writeFile(reportPath, [
		`# Address Risk Report (${network}:${address})`,
		`- Graph JSON: ${graphPath}`,
		`- Table JSON: ${tableJsonPath}`,
		`- CSV: ${csvPath}`,
		`- Report HTML: ${tableHtmlPath}`,
		`- Graph HTML: ${graphHtmlPath}`,
		"",
		summaryText
	].join("\n"), { mode: 384 });
	return {
		graph_json: graphPath,
		graph_html: graphHtmlPath,
		table_json: tableJsonPath,
		flows_csv: csvPath,
		table_html: tableHtmlPath,
		report_md: reportPath
	};
}
function statelessArtifacts() {
	return {
		artifacts_written: false,
		artifact_mode: "stateless"
	};
}
function artifactEvidence(artifacts) {
	return Object.entries(artifacts).filter((entry) => entry[0] !== "artifact_mode" && typeof entry[1] === "string" && entry[1].length > 0).map(([kind, filePath]) => ({
		evidence_type: "artifact_pointer",
		path: filePath,
		summary: `${kind} artifact`
	}));
}
function traceEdgesForCsv(structuredContent) {
	const edges = structuredContent["edges"];
	return Array.isArray(edges) ? edges.filter((edge) => typeof edge === "object" && edge !== null && !Array.isArray(edge)) : [];
}
function buildTraceTableHtml(tool, network, result) {
	const headers = [
		"edge_id",
		"from_address",
		"to_address",
		"amount_usd_sum",
		"tx_count",
		"first_tx_id",
		"last_tx_id"
	];
	const body = traceEdgesForCsv(result.structuredContent).map((row) => {
		return `<tr>${headers.map((header) => row[header] ?? "").map((value) => `<td>${htmlEscape(toCsvValue(value))}</td>`).join("")}</tr>`;
	}).join("\n");
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEscape(tool)} Trace Table</title>
<style>
  :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui; background: #0b0d12; color: #f4f2ea; }
  body { margin: 0; background: #0b0d12; color: #f4f2ea; }
  main { padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 8px; font-weight: 650; }
  table { border-collapse: collapse; width: 100%; min-width: 900px; }
  th, td { border-bottom: 1px solid rgba(255,255,255,.08); padding: 8px 10px; text-align: left; }
  th { position: sticky; top: 0; background: #161a24; color: #f2dda6; font-weight: 600; }
</style>
</head>
<body>
<main>
  <h1>${htmlEscape(tool)} Trace Table</h1>
  <div>Network: <strong>${htmlEscape(network)}</strong></div>
  <div>Generated: <strong>${htmlEscape((/* @__PURE__ */ new Date()).toISOString())}</strong></div>
  <table>
    <thead><tr>${headers.map((header) => `<th>${htmlEscape(header)}</th>`).join("")}</tr></thead>
    <tbody>${body}</tbody>
  </table>
</main>
</body>
</html>
`;
}
async function writeTraceArtifacts(tool, network, result) {
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
	const artifacts = {
		graph_json: graphPath,
		graph_html: graphHtmlPath,
		table_json: tableJsonPath,
		flows_csv: csvPath,
		table_html: tableHtmlPath,
		report_md: reportPath
	};
	const existingEvidence = Array.isArray(result.structuredContent["evidence"]) ? result.structuredContent["evidence"].filter((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry)) : [];
	const structuredForArtifact = {
		...result.structuredContent,
		artifacts,
		evidence: [...existingEvidence.filter((entry) => entry["evidence_type"] !== "artifact_pointer"), ...artifactEvidence(artifacts)]
	};
	const summaryText = withTraceArtifactSummary(result.summaryText, artifacts);
	const { generateInlineGraphHtml } = await import("./html-generator-D8FWMzBw.mjs").then((n) => n.n);
	const csvHeaders = [
		"edge_id",
		"from_address",
		"to_address",
		"amount_usd_sum",
		"tx_count",
		"first_tx_id",
		"last_tx_id"
	];
	const csv = [csvHeaders.join(","), ...traceEdgesForCsv(result.structuredContent).map((row) => csvHeaders.map((header) => JSON.stringify(String(row[header] ?? ""))).join(","))].join("\n") + "\n";
	await writeFile(graphPath, JSON.stringify(result.graphData, null, 2) + "\n", { mode: 384 });
	await writeFile(tableJsonPath, JSON.stringify(structuredForArtifact, null, 2) + "\n", { mode: 384 });
	await writeFile(csvPath, csv, { mode: 384 });
	await writeFile(tableHtmlPath, buildTraceTableHtml(tool, network, result), { mode: 384 });
	await writeFile(reportPath, summaryText + "\n", { mode: 384 });
	await writeFile(graphHtmlPath, generateInlineGraphHtml(result.graphData), { mode: 384 });
	return {
		artifacts,
		summaryText
	};
}
async function publicizeTraceResult(remoteClient, network, result, preferredByIdentity, writeArtifacts) {
	const publicResult = await publicizeIdentityResult(remoteClient, network, result, preferredByIdentity);
	if (!writeArtifacts) return publicResult;
	const { artifacts, summaryText } = await writeTraceArtifacts(typeof publicResult.structuredContent["tool"] === "string" ? publicResult.structuredContent["tool"] : "aml_trace_victim_funds", network, publicResult);
	const existingEvidence = Array.isArray(publicResult.structuredContent["evidence"]) ? publicResult.structuredContent["evidence"].filter((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry)) : [];
	return {
		...publicResult,
		summaryText,
		structuredContent: {
			...publicResult.structuredContent,
			artifacts,
			evidence: [...existingEvidence.filter((entry) => entry["evidence_type"] !== "artifact_pointer"), ...artifactEvidence(artifacts)]
		}
	};
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
	const sourceMatches = graphRecords(graphData, "source_matches");
	const reverseLeads = graphRecords(graphData, "reverse_leads");
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
	const recommendedNextTools = depositAddresses.length > 0 ? ["aml_trace_deposit_sources", "aml_address_risk"] : ["aml_address_risk", "graph_query_batch"];
	const structuredContent = {
		schema: "chain-insights.trace.v1",
		tool,
		network,
		input: {
			addresses: runs.map((run) => run.address),
			seed_role: seedRole,
			...options.incidentTimestampMs !== void 0 ? { incident_timestamp_ms: options.incidentTimestampMs } : {},
			...options.timeRange ? { time_range: options.timeRange } : {},
			time_filter: options.activityWindow ? {
				from_ms: options.activityWindow.fromMs,
				...options.activityWindow.toMs !== void 0 ? { to_ms: options.activityWindow.toMs } : {}
			} : "none",
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
		deposit_funding: {
			source_exchange_paths: sourceMatches.map((match) => ({
				deposit_address: match["deposit_address"],
				source_exchange: match["source_exchange"],
				source_labels: match["source_labels"],
				hops: match["hops"],
				path: match["path"],
				reason: "Deposit candidate upstream cluster is exchange-funded (topology-grain CEX-to-CEX structure)."
			})),
			reverse_leads: reverseLeads.map((lead) => ({
				address: lead["address"],
				deposit_address: lead["deposit_address"],
				labels: lead["labels"],
				amount_usd: lead["amount_usd"],
				reason: lead["reason"]
			}))
		},
		candidate_labels: candidateLabels,
		artifacts,
		evidence: [...artifactEvidenceEntries],
		continuation: {
			candidate_deposit_addresses: depositAddresses,
			candidate_suspect_addresses: seedRole === "suspect" ? runs.map((run) => run.address) : [],
			candidate_victim_addresses: [],
			recommended_next_tools: recommendedNextTools,
			...sourceMatches.length > 0 ? { deposit_funding_note: "One or more deposit candidates are exchange-funded upstream; consider aml_trace_deposit_sources on those deposits." } : {}
		},
		warnings: [...depositAddresses.length === 0 ? ["No exchange deposit candidates were connected in the queried topology."] : [], ...runs.flatMap((run) => run.result.tracebackWarnings ?? [])]
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
	const victimInputs = parseAddressList(options.victimAddresses);
	const knownSuspects = parseAddressList(options.knownSuspectAddresses);
	if (!network) throw new Error("network is required");
	if (victimInputs.length < 1) throw new Error("victim_addresses must contain at least 1 address");
	if (victimInputs.length > 5) throw new Error("victim_addresses cannot exceed 5 addresses");
	if (knownSuspects.length > 5) throw new Error("known_suspect_addresses cannot exceed 5 addresses");
	const resolvedVictims = await resolveIdentityKeys(remoteClient, network, victimInputs);
	const victims = [...new Set(victimInputs.map((input) => resolvedVictims.get(input) ?? input))];
	const preferredByIdentity = new Map(victimInputs.map((input) => [resolvedVictims.get(input) ?? input, input]));
	const activityWindow = traceActivityWindow(options.incidentTimestampMs, options.timeRange);
	const runs = [];
	for (const address of victims) runs.push({
		role: "victim",
		address,
		result: await runFundFlowProbe(remoteClient, config, {
			seedAddress: address,
			network,
			maxHops: options.maxHops,
			perAddressLimit: options.perAddressLimit,
			minAmountSum: options.minAmountSum,
			activityWindow,
			includeDepositTraceback: true,
			evidenceSource: "aml_trace_victim_funds",
			writeArtifacts: false
		})
	});
	return publicizeTraceResult(remoteClient, network, traceResultFromFundRuns("aml_trace_victim_funds", "victim", network, runs, {
		incidentTimestampMs: options.incidentTimestampMs,
		timeRange: options.timeRange,
		activityWindow,
		maxHops: options.maxHops
	}), preferredByIdentity, options.writeArtifacts !== false);
}
async function traceSuspectFunds(remoteClient, config, options) {
	const network = options.network.trim();
	const suspectInputs = parseAddressList(options.suspectAddresses);
	if (!network) throw new Error("network is required");
	if (suspectInputs.length < 1) throw new Error("suspect_addresses must contain at least 1 address");
	if (suspectInputs.length > 5) throw new Error("suspect_addresses cannot exceed 5 addresses");
	const resolvedSuspects = await resolveIdentityKeys(remoteClient, network, suspectInputs);
	const suspects = [...new Set(suspectInputs.map((input) => resolvedSuspects.get(input) ?? input))];
	const preferredByIdentity = new Map(suspectInputs.map((input) => [resolvedSuspects.get(input) ?? input, input]));
	const activityWindow = traceActivityWindow(options.incidentTimestampMs, options.timeRange);
	const runs = [];
	for (const address of suspects) runs.push({
		role: "suspect",
		address,
		result: await runFundFlowProbe(remoteClient, config, {
			seedAddress: address,
			network,
			maxHops: options.maxHops,
			perAddressLimit: options.perAddressLimit,
			minAmountSum: options.minAmountSum,
			activityWindow,
			includeDepositTraceback: true,
			evidenceSource: "aml_trace_suspect_funds",
			writeArtifacts: false
		})
	});
	return publicizeTraceResult(remoteClient, network, traceResultFromFundRuns("aml_trace_suspect_funds", "suspect", network, runs, {
		incidentTimestampMs: options.incidentTimestampMs,
		timeRange: options.timeRange,
		activityWindow,
		maxHops: options.maxHops
	}), preferredByIdentity, options.writeArtifacts !== false);
}
const REVERSE_DEPOSIT_SOURCES_LIMIT = 500;
function reverseDepositSourceQueryAtDepth(depositAddresses, depth, minAmountSum, window) {
	const intermediateVariables = Array.from({ length: Math.max(depth - 1, 0) }, (_, index) => `n${index + 1}`);
	const nodeVariables = [
		"source",
		...intermediateVariables,
		"deposit"
	];
	const edgeVariables = Array.from({ length: depth }, (_, index) => `r${index + 1}`);
	const relationshipChain = edgeVariables.map((edgeVariable, index) => {
		return `-[${edgeVariable}:FLOWS_TO]->(${index === edgeVariables.length - 1 ? "deposit" : intermediateVariables[index]}:Identity)`;
	}).join("");
	const depositPredicates = depositAddresses.map((address) => `deposit.identity_id = "${escapeCypherString(address)}"`);
	const nonExchangePredicates = [
		"source",
		...intermediateVariables,
		"deposit"
	].map((nodeVariable) => `${nodeVariable}.is_exchange IS NULL`);
	const amountPredicates = minAmountSum > 0 ? edgeVariables.map((edgeVariable) => `${edgeVariable}.amount_usd_sum >= ${minAmountSum}`) : [];
	const windowPredicates = activityWindowPredicates(edgeVariables, window);
	return {
		id: `reverse_deposit_sources_${depth}`,
		query: [
			`MATCH (source:Identity)${relationshipChain}`,
			`WHERE (${depositPredicates.join(" OR ")}) AND source.identity_id <> deposit.identity_id AND ${[
				...nonExchangePredicates,
				...amountPredicates,
				...windowPredicates
			].join(" AND ")}`,
			`RETURN DISTINCT source.identity_id AS source_address, source.is_exchange AS source_is_exchange, deposit.identity_id AS deposit_address, deposit.is_exchange AS deposit_is_exchange, ${depth} AS hop, [${nodeVariables.map((nodeVariable) => `${nodeVariable}.identity_id`).join(", ")}] AS addresses, [${nodeVariables.map(pathNodeMap).join(", ")}] AS path_nodes, [${edgeVariables.map(flowEdgeMap).join(", ")}] AS edge_props`,
			`LIMIT ${REVERSE_DEPOSIT_SOURCES_LIMIT}`
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
async function traceDepositSources(remoteClient, _config, options) {
	const network = options.network.trim();
	const depositInputs = parseAddressList(options.depositAddresses);
	if (!network) throw new Error("network is required");
	if (depositInputs.length < 1) throw new Error("deposit_addresses must contain at least 1 address");
	if (depositInputs.length > 5) throw new Error("deposit_addresses cannot exceed 5 addresses");
	const resolvedDeposits = await resolveIdentityKeys(remoteClient, network, depositInputs);
	const deposits = [...new Set(depositInputs.map((input) => resolvedDeposits.get(input) ?? input))];
	const preferredByIdentity = new Map(depositInputs.map((input) => [resolvedDeposits.get(input) ?? input, input]));
	const maxHops = clampInt(options.maxHops, 2, 1, 5);
	const minAmountSum = Math.max(0, options.minAmountSum ?? 0);
	const window = traceActivityWindow(void 0, options.timeRange);
	const batch = await callGraphBatch(remoteClient, network, Array.from({ length: maxHops }, (_, index) => reverseDepositSourceQueryAtDepth(deposits, index + 1, minAmountSum, window)));
	const failures = [];
	const rows = optionalResultsWithPrefix(batch, "reverse_deposit_sources_", failures).filter((row) => !reverseDepositSourceRowUsesExchange(row)).map((row, index) => ({
		...row,
		path_id: `p${index + 1}`
	}));
	const truncationWarnings = (batch.facts?.queries ?? []).filter((entry) => entry.id?.startsWith("reverse_deposit_sources_") && (entry.results?.length ?? 0) >= REVERSE_DEPOSIT_SOURCES_LIMIT).map((entry) => `${entry.id} hit the ${REVERSE_DEPOSIT_SOURCES_LIMIT}-row limit; results may be truncated.`);
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
			amount_usd_sum: edge["amount_usd_sum"],
			tx_count: edge["tx_count"],
			first_tx_id: edge["first_tx_id"],
			last_tx_id: edge["last_tx_id"],
			direction: "traceback"
		})),
		flows: edges.map((edge, index) => ({
			hop: index + 1,
			src: edge["from_address"],
			dst: edge["to_address"],
			amount_usd_sum: edge["amount_usd_sum"] ?? 0,
			terminal_exchange: false
		})),
		edge_anchors: [],
		metadata: {
			network,
			deposit_addresses: deposits,
			generated_at: (/* @__PURE__ */ new Date()).toISOString()
		}
	});
	return publicizeTraceResult(remoteClient, network, {
		summaryText: [
			`Trace deposit sources complete for ${network}`,
			"",
			`Deposit seeds: ${deposits.join(", ")}`,
			`Reverse path(s): ${paths.length}`,
			`Shared upstream convergence: ${convergence.length}`
		].join("\n"),
		structuredContent: {
			schema: "chain-insights.trace.v1",
			tool: "aml_trace_deposit_sources",
			network,
			input: {
				addresses: deposits,
				seed_role: "deposit",
				...options.timeRange ? { time_range: options.timeRange } : {},
				...minAmountSum > 0 ? { min_amount_sum: minAmountSum } : {},
				time_filter: window ? {
					from_ms: window.fromMs,
					...window.toMs !== void 0 ? { to_ms: window.toMs } : {}
				} : "none",
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
			artifacts: statelessArtifacts(),
			evidence: failures.length > 0 ? [{
				evidence_type: "query_summary",
				summary: `partial query failures: ${failures.length}`
			}] : [],
			continuation: {
				candidate_deposit_addresses: deposits,
				candidate_suspect_addresses: candidateSuspects,
				candidate_victim_addresses: [],
				recommended_next_tools: candidateSuspects.length > 0 ? ["aml_trace_suspect_funds", "aml_address_risk"] : ["aml_address_risk", "graph_query_batch"]
			},
			warnings: [...paths.length === 0 ? ["No upstream sources were connected in the queried topology."] : [], ...truncationWarnings]
		},
		graphData
	}, preferredByIdentity, options.writeArtifacts !== false);
}
//#endregion
export { addressRisk, traceDepositSources, traceSuspectFunds, traceVictimFunds };

//# sourceMappingURL=public-tools-D4Y_LUIx.mjs.map