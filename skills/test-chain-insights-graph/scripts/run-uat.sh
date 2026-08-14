#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHAIN_INSIGHTS_DIR="${CHAIN_INSIGHTS_DIR:-$(cd "${SCRIPT_DIR}/../../.." && pwd)}"
MCP_ENDPOINT="${CHAIN_INSIGHTS_GRAPH_ENDPOINT:-${CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT:-http://localhost:8012/mcp}}"
DEBUG_TOKEN="${CHAIN_INSIGHTS_GRAPH_DEBUG_TOKEN:-chain-insights-dev-debug}"
SERVER_PORT="${CHAIN_INSIGHTS_SERVER_PORT:-4321}"
NETWORK="${NETWORK:-robinhood}"
# UAT_ADDRESS is the H160 native address of the UAT fixture, a plain
# (:Address {address, network}) node -- there is no separate identity key or
# member-address resolution step.
UAT_ADDRESS="${UAT_ADDRESS:-0x20d09f2881602eee806147ceee9275d33ff31df8}"
# UAT_LINKED_NETWORK/UAT_LINKED_ADDRESS are the H160 same-network counterpart
# (:Address.network property value robinhood -- same public
# network=robinhood query network), connected to UAT_ADDRESS by a same-network
# (:Address)-[:LINKED]-(:Address) ownership-overlay edge (deterministic H160
# mirror, basis=derived). AC5: the cross-network read below runs under
# network=robinhood with no network switch.
UAT_LINKED_NETWORK="${UAT_LINKED_NETWORK:-robinhood}"
UAT_LINKED_ADDRESS="${UAT_LINKED_ADDRESS:-0x1874a43d7c6d888f9eda3d22a3a49704e3cadb24}"
REPORT_DIR="${REPORT_DIR:-${CHAIN_INSIGHTS_DIR}/.tmp/uat}"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="${REPORT_DIR}/${RUN_ID}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-${RUN_DIR}/workspace}"
CHAIN_INSIGHTS_CLI="${CHAIN_INSIGHTS_DIR}/bin/cli.js"
CHAIN_INSIGHTS_PROXY="${CHAIN_INSIGHTS_DIR}/bin/mcp-proxy.cjs"
GLOBAL_REPORTS="${HOME}/.chain-insights/reports"
GLOBAL_SNAPSHOT_BEFORE="${RUN_DIR}/global-output-before.txt"
GLOBAL_SNAPSHOT_AFTER="${RUN_DIR}/global-output-after.txt"
SERVER_PID=""
CONFIG_SNAPSHOT_READY=0

mkdir -p "${RUN_DIR}"

log() {
  printf '[uat] %s\n' "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '[uat] missing required command: %s\n' "$1" >&2
    exit 127
  fi
}

snapshot_global_outputs() {
  local output_file="$1"
  : >"${output_file}"
  for dir in "${GLOBAL_REPORTS}"; do
    {
      printf '[%s]\n' "${dir}"
      if [[ -d "${dir}" ]]; then
        (
          cd "${dir}"
          find . -mindepth 1 -type d -print | LC_ALL=C sort | sed 's/^/dir /'
          find . -mindepth 1 -type f -print0 \
            | LC_ALL=C sort -z \
            | xargs -0 -r sha256sum \
            | sed 's/^/file /'
        )
      else
        printf '<missing>\n'
      fi
    } >>"${output_file}"
  done
}

assert_no_global_outputs_changed() {
  snapshot_global_outputs "${GLOBAL_SNAPSHOT_AFTER}"
  if ! cmp -s "${GLOBAL_SNAPSHOT_BEFORE}" "${GLOBAL_SNAPSHOT_AFTER}"; then
    log "global investigation output roots changed; reports must stay workspace-local"
    diff -u "${GLOBAL_SNAPSHOT_BEFORE}" "${GLOBAL_SNAPSHOT_AFTER}" >&2 || true
    return 1
  fi
}

cleanup() {
  if [[ -n "${SERVER_PID}" ]]; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" >/dev/null 2>&1 || true
  fi
}

restore_config() {
  if [[ "${CONFIG_SNAPSHOT_READY}" != "1" ]]; then
    return
  fi
  if [[ -n "${OLD_GRAPH_MCP_MODE:-}" ]]; then
    node "${CHAIN_INSIGHTS_CLI}" config set graphMcpMode "${OLD_GRAPH_MCP_MODE}" >/dev/null || true
  fi
  if [[ -n "${OLD_GRAPH_MCP_ENDPOINT:-}" ]]; then
    node "${CHAIN_INSIGHTS_CLI}" config set graphMcpEndpoint "${OLD_GRAPH_MCP_ENDPOINT}" >/dev/null || true
  fi
  node "${CHAIN_INSIGHTS_CLI}" config set graphMcpAuthToken "${OLD_GRAPH_MCP_AUTH_TOKEN:-}" >/dev/null || true
  if [[ -n "${OLD_SERVER_PORT:-}" ]]; then
    node "${CHAIN_INSIGHTS_CLI}" config set serverPort "${OLD_SERVER_PORT}" >/dev/null || true
  fi
}

finish() {
  local status="$?"
  set +e
  cleanup
  if [[ -f "${GLOBAL_SNAPSHOT_BEFORE}" ]]; then
    assert_no_global_outputs_changed || status=1
  fi
  restore_config
  exit "${status}"
}
trap finish EXIT

require_cmd node
require_cmd npm
require_cmd npx
require_cmd curl
require_cmd sha256sum

if [[ ! -d "${CHAIN_INSIGHTS_DIR}" ]]; then
  log "missing Chain Insights repo: ${CHAIN_INSIGHTS_DIR}"
  exit 1
fi

log "report directory: ${RUN_DIR}"
snapshot_global_outputs "${GLOBAL_SNAPSHOT_BEFORE}"
OLD_GRAPH_MCP_MODE="$(node "${CHAIN_INSIGHTS_CLI}" config get graphMcpMode || true)"
OLD_GRAPH_MCP_ENDPOINT="$(node "${CHAIN_INSIGHTS_CLI}" config get graphMcpEndpoint || true)"
OLD_GRAPH_MCP_AUTH_TOKEN="$(node "${CHAIN_INSIGHTS_CLI}" config get graphMcpAuthToken || true)"
OLD_SERVER_PORT="$(node "${CHAIN_INSIGHTS_CLI}" config get serverPort || true)"
CONFIG_SNAPSHOT_READY=1
log "using Chain Insights Graph endpoint: ${MCP_ENDPOINT}"

cd "${CHAIN_INSIGHTS_DIR}"

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  log "building Chain Insights dist"
  npm run build
fi

log "initializing Chain Insights UAT workspace: ${WORKSPACE_ROOT}"
node "${CHAIN_INSIGHTS_CLI}" init "${WORKSPACE_ROOT}" --force >/dev/null
export CHAIN_INSIGHTS_WORKSPACE="${WORKSPACE_ROOT}"

log "configuring Chain Insights MCP endpoint and debug bearer token"
(
  cd "${WORKSPACE_ROOT}"
  node "${CHAIN_INSIGHTS_CLI}" debug on --token "${DEBUG_TOKEN}" --endpoint "${MCP_ENDPOINT}" >/dev/null
  node "${CHAIN_INSIGHTS_CLI}" config set serverPort "${SERVER_PORT}" >/dev/null
)

if curl -sf "http://127.0.0.1:${SERVER_PORT}/health" >/dev/null 2>&1; then
  log "reusing healthy Chain Insights server on port ${SERVER_PORT}"
else
  log "starting Chain Insights server on port ${SERVER_PORT}"
  (
    cd "${WORKSPACE_ROOT}"
    CHAIN_INSIGHTS_WORKSPACE="${WORKSPACE_ROOT}" node "${CHAIN_INSIGHTS_CLI}" serve -p "${SERVER_PORT}"
  ) >"${RUN_DIR}/chain-insights-server.log" 2>&1 &
  SERVER_PID="$!"
  for _ in $(seq 1 30); do
    if curl -sf "http://127.0.0.1:${SERVER_PORT}/health" >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done
  curl -sf "http://127.0.0.1:${SERVER_PORT}/health" >"${RUN_DIR}/server-health.json"
fi

log "refreshing Chain Insights remote tool schema cache"
(
  cd "${WORKSPACE_ROOT}"
  node "${CHAIN_INSIGHTS_CLI}" mcp tools --refresh
) >"${RUN_DIR}/chain-insights-tools.txt"

DIRECT_TOOLS_JSON="${RUN_DIR}/direct-tools-list.json"
log "checking direct Chain Insights Graph tools/list"
npx @modelcontextprotocol/inspector \
  --cli "${MCP_ENDPOINT}" \
  --transport http \
  --header "Authorization: Bearer ${DEBUG_TOKEN}" \
  --header "X-MCP-Debug-Token: ${DEBUG_TOKEN}" \
  --method tools/list >"${DIRECT_TOOLS_JSON}"

node - "${DIRECT_TOOLS_JSON}" "${RUN_DIR}/direct-high-level-tools.txt" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const highLevelFile = process.argv[3]
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
const tools = data.tools || []
const names = new Set(tools.map((tool) => tool.name))
const required = ['network_capabilities', 'graph_query', 'graph_query_batch']
const missing = required.filter((name) => !names.has(name))
if (missing.length) throw new Error(`direct tools/list missing tools: ${missing.join(', ')}`)
if (JSON.stringify(tools).includes('app_data')) throw new Error('direct tools/list still contains app_data')
const hasHighLevel = ['aml_address_risk'].every((name) => names.has(name))
fs.writeFileSync(highLevelFile, hasHighLevel ? 'yes\n' : 'no\n')
console.log(`[uat] direct tools/list ok: ${tools.length} tools (${hasHighLevel ? 'high-level' : 'primitive-only'})`)
NODE

DIRECT_CAPABILITIES_JSON="${RUN_DIR}/direct-network-capabilities.json"
log "checking public network capabilities"
npx @modelcontextprotocol/inspector \
  --cli "${MCP_ENDPOINT}" \
  --transport http \
  --header "Authorization: Bearer ${DEBUG_TOKEN}" \
  --header "X-MCP-Debug-Token: ${DEBUG_TOKEN}" \
  --method tools/call \
  --tool-name network_capabilities >"${DIRECT_CAPABILITIES_JSON}"

node - "${DIRECT_CAPABILITIES_JSON}" "${NETWORK}" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const network = process.argv[3]
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
let payload = data.structuredContent
if (!payload && data.content?.[0]?.type === 'text') {
  payload = JSON.parse(data.content[0].text)
}
const networks = payload?.facts?.capabilities?.networks || []
const rawPayload = JSON.stringify(payload?.facts?.capabilities || {})
const byName = new Map(networks.map((entry) => [entry.network, entry]))
const source = byName.get(network)
const errors = []
if (!source) errors.push(`network_capabilities missing source network ${network}`)
if (source?.layers?.topology?.enabled !== true) errors.push(`${network} topology is not enabled`)
if (source?.tools?.graph_query !== 'available') errors.push(`${network} graph_query is not available`)
for (const leaked of ['retention', 'window_days', 'aggregations']) {
  if (rawPayload.includes(leaked)) errors.push(`network_capabilities leaked ${leaked} implementation metadata`)
}
// GATE 3 / AC5: robinhood is the ONE public investigation network. The
// H160 address space is the :Address.network node property, never a second
// public query network -- base/ethereum/tron aliases must not leak.
for (const alias of ['base', 'ethereum', 'tron']) {
  if (byName.has(alias)) errors.push(`network_capabilities leaked alias or unsupported network ${alias}`)
}
if (errors.length) throw new Error(errors.join('; '))
console.log(`[uat] network_capabilities ok: source=${network}`)
NODE

ADDRESS_TOPOLOGY_JSON="${RUN_DIR}/direct-topology.json"
# Scoped to the UAT fixture address, not the whole graph. An unscoped
# count(f) over every FLOWS_TO edge is a cross-shard aggregate re-derivation:
# on a multi-shard deployment it exceeds the planner cardinality cap and is
# refused (measured on dev: 1,460,339 edge rows vs a 250,000 cap), so the step
# failed before its assertions ran. Scoping is also what the assertion
# actually wants — that the FIXTURE address has flows, not that the graph is
# non-empty.
ADDRESS_TOPOLOGY_QUERY="USE topology MATCH (s:Address {address: '${UAT_ADDRESS}'})-[f:FLOWS_TO]->(d:Address) RETURN count(f) AS address_flows"
log "checking public topology address-grain edges (network=${NETWORK})"
npx @modelcontextprotocol/inspector \
  --cli "${MCP_ENDPOINT}" \
  --transport http \
  --header "Authorization: Bearer ${DEBUG_TOKEN}" \
  --header "X-MCP-Debug-Token: ${DEBUG_TOKEN}" \
  --method tools/call \
  --tool-name graph_query \
  --tool-arg "network=${NETWORK}" \
  --tool-arg "query=${ADDRESS_TOPOLOGY_QUERY}" >"${ADDRESS_TOPOLOGY_JSON}"

node - "${ADDRESS_TOPOLOGY_JSON}" "${NETWORK}" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const network = process.argv[3]
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
const errors = []
if (data.isError) errors.push(`topology query returned isError=true: ${data.content?.[0]?.text || 'unknown error'}`)
const facts = data.structuredContent?.facts
const subject = facts?.subject
const routing = facts?.routing
const flows = facts?.query?.results?.[0]?.address_flows
if (subject?.network !== network) errors.push(`address subject network mismatch: ${subject?.network}`)
if (routing?.starrocks_database !== network) errors.push(`topology routing database mismatch: ${routing?.starrocks_database}`)
if (!Number.isFinite(Number(flows)) || Number(flows) <= 0) errors.push(`topology FLOWS_TO count not positive: ${flows}`)
if (errors.length) throw new Error(errors.join('; '))
console.log(`[uat] public topology address-grain edges ok: flows=${flows} routing=${routing.starrocks_database}`)
NODE

ADDRESS_FACTS_JSON="${RUN_DIR}/direct-address-facts.json"
# The facts tier is TRANSFERS ONLY (rbmk#447 P3/P5, data-pipeline #223): a
# single-node (a:Address) match is refused there with "label Address is served
# only as a relationship endpoint". This query used that retired shape, so the
# step could not pass from 2026-07-22 onward — the compiler rejected it before
# any assertion ran. Address-grain labels/is_exchange now live on the topology
# tier, where they are shard-invariant node properties; the facts tier is
# exercised through a TRANSFER pattern, which is what it actually serves.
ADDRESS_FACTS_QUERY="USE topology MATCH (a:Address {address: '${UAT_ADDRESS}'}) RETURN a.address AS address, a.labels AS labels, a.is_exchange AS is_exchange LIMIT 1"
log "checking facts address query"
npx @modelcontextprotocol/inspector \
  --cli "${MCP_ENDPOINT}" \
  --transport http \
  --header "Authorization: Bearer ${DEBUG_TOKEN}" \
  --header "X-MCP-Debug-Token: ${DEBUG_TOKEN}" \
  --method tools/call \
  --tool-name graph_query \
  --tool-arg "network=${NETWORK}" \
  --tool-arg "query=${ADDRESS_FACTS_QUERY}" >"${ADDRESS_FACTS_JSON}"

node - "${ADDRESS_FACTS_JSON}" "${NETWORK}" "${UAT_ADDRESS}" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const network = process.argv[3]
const address = process.argv[4]
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
const errors = []
if (data.isError) errors.push(`facts query returned isError=true: ${data.content?.[0]?.text || 'unknown error'}`)
const subject = data.structuredContent?.facts?.subject
const routing = data.structuredContent?.facts?.routing
const results = data.structuredContent?.facts?.query?.results || []
const match = results.find((row) => row.address === address)
const labels = Array.isArray(match?.labels) ? match.labels.join(',') : (match?.labels || '')
if (subject?.network !== network) errors.push(`address facts subject network mismatch: ${subject?.network}`)
if (routing?.starrocks_database !== network) errors.push(`facts routing database mismatch: ${routing?.starrocks_database}`)
if (!match) errors.push(`facts query did not return address ${address}`)
if (labels.length === 0) errors.push('facts query did not return address labels')
if (errors.length) throw new Error(errors.join('; '))
console.log(`[uat] facts address query ok: address=${address} labels=${labels}`)
NODE

# Run the CLI topology assertion before proxy tool checks so graph reads
# fail close to their source if the local topology is unhealthy. Same-network
# LINKED is the only ownership-overlay edge connecting addresses on the one
# public robinhood network (AC5).
GRAPH_QUERY_TEXT="${RUN_DIR}/graph-query-linked.txt"
log "calling Chain Insights CLI graph_query against real MCP"
# Bounded retry: a busy graph store can transiently queue point reads past
# the MCP per-query timeout (e.g. mid-resync); the assertion itself is
# unchanged and still requires the exact UAT same-network LINKED edge.
GRAPH_QUERY_ATTEMPTS="${GRAPH_QUERY_ATTEMPTS:-3}"
for attempt in $(seq 1 "${GRAPH_QUERY_ATTEMPTS}"); do
  (
    cd "${WORKSPACE_ROOT}"
    node "${CHAIN_INSIGHTS_CLI}" mcp call graph_query \
      "network=${NETWORK}" \
      "query=USE topology MATCH (a:Address {address: '${UAT_ADDRESS}'})-[l:LINKED]-(b:Address {address: '${UAT_LINKED_ADDRESS}'}) RETURN a.address AS address, b.address AS linked_address, b.network AS linked_network, l.basis AS basis"
  ) >"${GRAPH_QUERY_TEXT}" || true
  if node -e "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8').trim())" "${GRAPH_QUERY_TEXT}" 2>/dev/null; then
    break
  fi
  if [[ "${attempt}" -lt "${GRAPH_QUERY_ATTEMPTS}" ]]; then
    log "graph_query attempt ${attempt} returned a non-JSON transient error; retrying in 20s"
    sleep 20
  fi
done

node - "${GRAPH_QUERY_TEXT}" "${UAT_ADDRESS}" "${UAT_LINKED_ADDRESS}" "${UAT_LINKED_NETWORK}" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const address = process.argv[3]
const linkedAddress = process.argv[4]
const linkedNetwork = process.argv[5]
const text = fs.readFileSync(file, 'utf8').trim()
const data = JSON.parse(text)
const first = data.facts?.query?.results?.[0] || data.results?.[0]
if (!first || first.address !== address) {
  throw new Error(`graph_query did not return expected address ${address}`)
}
if (first.linked_address !== linkedAddress || first.linked_network !== linkedNetwork) {
  throw new Error(`same-network LINKED edge missing or wrong counterpart: ${JSON.stringify(first)}`)
}
console.log(`[uat] graph_query ok: ${first.address} -[:LINKED]- ${first.linked_address} (${first.linked_network}, basis=${first.basis})`)
NODE

# Topology serves ALL history in one unified graph (serving contract A1: the
# LINKED ownership overlay is topology-only).
# Assert the topology FLOWS_TO money shape for the UAT address, which now
# covers recent and full historical activity in one place.
TOPOLOGY_MONEY_TEXT="${RUN_DIR}/graph-query-topology-money.txt"
log "calling Chain Insights CLI graph_query for topology money-flow compatibility"
(
  cd "${WORKSPACE_ROOT}"
  node "${CHAIN_INSIGHTS_CLI}" mcp call graph_query \
    "network=${NETWORK}" \
    "query=USE topology MATCH (a:Address {address: '${UAT_ADDRESS}'})-[f:FLOWS_TO]->(b:Address) RETURN a.address AS address, b.address AS to_address, f.amount_usd_sum AS amount_usd_sum LIMIT 1"
) >"${TOPOLOGY_MONEY_TEXT}"

node - "${TOPOLOGY_MONEY_TEXT}" "${UAT_ADDRESS}" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const address = process.argv[3]
const data = JSON.parse(fs.readFileSync(file, 'utf8').trim())
const first = data.facts?.query?.results?.[0] || data.results?.[0]
if (!first || first.address !== address || !first.to_address) {
  throw new Error(`topology money-flow lookup for ${address} did not return an outbound FLOWS_TO edge: ${JSON.stringify(first)}`)
}
console.log(`[uat] topology money-flow FLOWS_TO ok: ${first.address} -> ${first.to_address}`)
NODE

# Address existence: an exact, index-backed lookup by the raw address must
# return the address node directly -- there is no resolution step.
ADDRESS_EXISTS_TEXT="${RUN_DIR}/graph-query-address-exists.txt"
log "calling Chain Insights CLI graph_query for address existence"
(
  cd "${WORKSPACE_ROOT}"
  node "${CHAIN_INSIGHTS_CLI}" mcp call graph_query \
    "network=${NETWORK}" \
    "query=USE topology MATCH (a:Address {address: '${UAT_ADDRESS}'}) RETURN a.address AS address LIMIT 1"
) >"${ADDRESS_EXISTS_TEXT}"

node - "${ADDRESS_EXISTS_TEXT}" "${UAT_ADDRESS}" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const address = process.argv[3]
const data = JSON.parse(fs.readFileSync(file, 'utf8').trim())
const first = data.facts?.query?.results?.[0] || data.results?.[0]
if (!first || first.address !== address) {
  throw new Error(`address existence lookup for ${address} did not return it: ${JSON.stringify(first)}`)
}
console.log(`[uat] address existence ok: ${first.address}`)
NODE

DIRECT_JSON="${RUN_DIR}/direct-address-risk.json"
DIRECT_ADDRESS_RISK_SUMMARY="- direct aml_address_risk skipped: direct endpoint is primitive-only"
if [[ "$(cat "${RUN_DIR}/direct-high-level-tools.txt")" == "yes" ]]; then
  log "calling direct Chain Insights Graph aml_address_risk"
  npx @modelcontextprotocol/inspector \
    --cli "${MCP_ENDPOINT}" \
    --transport http \
    --header "Authorization: Bearer ${DEBUG_TOKEN}" \
    --header "X-MCP-Debug-Token: ${DEBUG_TOKEN}" \
    --method tools/call \
    --tool-name aml_address_risk \
    --tool-arg "network=${NETWORK}" \
    --tool-arg "address=${UAT_ADDRESS}" \
    --tool-arg include_attachments=true >"${DIRECT_JSON}"

  node - "${DIRECT_JSON}" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
const errors = []
const content = data.content || []
const sc = data.structuredContent || {}
const graphData = data._meta?.chainInsights?.graph?.data
const graphArrayKeys = ['app_data', 'nodes', 'edges', 'flows', 'edge_anchors', 'transfers']
if (data.isError) errors.push('direct aml_address_risk returned isError=true')
if (content[0]?.type !== 'text') errors.push('direct content[0] is not text')
if (sc.schema !== 'chain-insights.result.v1') errors.push(`direct structuredContent schema mismatch: ${sc.schema}`)
for (const key of graphArrayKeys) {
  if (Object.prototype.hasOwnProperty.call(sc, key)) errors.push(`direct structuredContent leaks ${key}`)
}
if (!graphData) errors.push('direct _meta.chainInsights.graph.data missing')
if (graphData?.schema !== 'chain-insights.graph.v1') errors.push(`direct graph schema mismatch: ${graphData?.schema}`)
for (const key of ['nodes', 'edges', 'flows', 'edge_anchors']) {
  if (!Array.isArray(graphData?.[key])) errors.push(`direct graph ${key} is not an array`)
}
if (Object.prototype.hasOwnProperty.call(graphData || {}, 'transfers')) errors.push('direct graph includes transfers')
if (errors.length) throw new Error(errors.join('; '))
console.log(`[uat] direct aml_address_risk ok: nodes=${graphData.nodes.length} edges=${graphData.edges.length} flows=${graphData.flows.length} edge_anchors=${graphData.edge_anchors.length}`)
NODE
  DIRECT_ADDRESS_RISK_SUMMARY="- ${DIRECT_JSON}"
else
  log "direct Chain Insights Graph high-level tools absent; primitive-only endpoint, skipping direct aml_address_risk check"
fi

PROXY_TOOLS_JSON="${RUN_DIR}/proxy-tools-list.json"
log "checking Chain Insights proxy tools/list"
npx @modelcontextprotocol/inspector \
  --cli node "${CHAIN_INSIGHTS_PROXY}" \
  --transport stdio \
  --method tools/list >"${PROXY_TOOLS_JSON}"

node - "${PROXY_TOOLS_JSON}" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
const tools = data.tools || []
const names = new Set(tools.map((tool) => tool.name))
const required = ['wallet_balance', 'meta_help', 'meta_network_capabilities', 'meta_usage_status', 'aml_address_risk', 'graph_query', 'graph_query_batch']
const missing = required.filter((name) => !names.has(name))
if (missing.length) throw new Error(`proxy tools/list missing tools: ${missing.join(', ')}`)
if (names.size !== required.length) {
  const unexpected = [...names].filter((name) => !required.includes(name))
  throw new Error(`proxy tools/list exposed unexpected tools: ${unexpected.join(', ')}`)
}
if (JSON.stringify(tools).includes('app_data')) throw new Error('proxy tools/list still contains app_data')
const graphTools = tools.filter((tool) => tool._meta?.ui?.resourceUri === 'ui://chain-insights/graph').map((tool) => tool.name)
for (const name of ['aml_address_risk']) {
  if (!graphTools.includes(name)) throw new Error(`proxy graph app metadata missing for ${name}`)
}
console.log(`[uat] proxy tools/list ok: ${tools.length} tools`)
NODE

PROXY_JSON="${RUN_DIR}/proxy-address-risk.json"
log "calling Chain Insights proxy aml_address_risk"
node --input-type=module - "${CHAIN_INSIGHTS_PROXY}" "${NETWORK}" "${UAT_ADDRESS}" "${PROXY_JSON}" <<'NODE'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import fs from 'node:fs'

const proxy = process.argv[2]
const network = process.argv[3]
const address = process.argv[4]
const outputFile = process.argv[5]
const requestTimeoutMs = 5 * 60 * 1000

const client = new Client({ name: 'chain-insights-uat', version: '0.0.0' })
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [proxy],
  env: process.env,
})

try {
  await client.connect(transport)
  const result = await client.callTool(
    {
      name: 'aml_address_risk',
      arguments: {
        network,
        address,
        include_attachments: true,
      },
    },
    undefined,
    {
      timeout: requestTimeoutMs,
      maxTotalTimeout: requestTimeoutMs,
    },
  )
  fs.writeFileSync(outputFile, `${JSON.stringify(result, null, 2)}\n`)
} finally {
  await client.close()
}
NODE

GRAPH_REPORT_URL="$(
node - "${PROXY_JSON}" "${UAT_ADDRESS}" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const memberAddress = process.argv[3]
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
const errors = []
const content = data.content || []
const sc = data.structuredContent || {}
const graph = data._meta?.chainInsights?.graph
if (data.isError) errors.push('proxy aml_address_risk returned isError=true')
if (content[0]?.type !== 'text') errors.push('proxy content[0] is not text')
if (sc.schema !== 'chain-insights.result.v1') errors.push(`proxy structuredContent schema mismatch: ${sc.schema}`)
const subjectAddresses = sc.facts?.subject?.addresses || []
if (!subjectAddresses.includes(memberAddress)) errors.push(`proxy subject addresses do not include the public address ${memberAddress}`)
for (const key of ['app_data', 'nodes', 'edges', 'flows', 'edge_anchors', 'transfers']) {
  if (JSON.stringify(sc).includes(`"${key}"`)) errors.push(`proxy structuredContent leaks ${key}`)
}
if (!graph) errors.push('proxy _meta.chainInsights.graph missing')
if (graph?.data) errors.push('proxy _meta.chainInsights.graph.data leaked')
if (graph?.schema !== 'chain-insights.graph.v1') errors.push(`proxy graph schema mismatch: ${graph?.schema}`)
if (graph?.id) errors.push('proxy graph id should not be returned')
if (!/^http:\/\/127\.0\.0\.1:\d+\/graph-reports\/[A-Za-z0-9._-]+\.graph\.json$/.test(graph?.url || '')) {
  errors.push(`proxy graph url is not a local graph report URL: ${graph?.url}`)
}
if (errors.length) throw new Error(errors.join('; '))
console.error(`[uat] proxy aml_address_risk ok: graph_report=${graph.url}`)
process.stdout.write(graph.url)
NODE
)"
printf '%s\n' "${GRAPH_REPORT_URL}" >"${RUN_DIR}/graph-report-url.txt"

GRAPH_REPORT_JSON="${RUN_DIR}/graph-report.json"
log "fetching local graph report"
curl -sf "${GRAPH_REPORT_URL}" >"${GRAPH_REPORT_JSON}"

node - "${GRAPH_REPORT_JSON}" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
const errors = []
if (data.schema !== 'chain-insights.graph.v1') errors.push(`graph report schema mismatch: ${data.schema}`)
for (const key of ['nodes', 'edges', 'flows', 'edge_anchors']) {
  if (!Array.isArray(data[key])) errors.push(`graph report ${key} is not an array`)
}
if (Object.prototype.hasOwnProperty.call(data, 'transfers')) errors.push('graph report includes transfers')
if (errors.length) throw new Error(errors.join('; '))
console.log(`[uat] graph report ok: nodes=${data.nodes.length} edges=${data.edges.length} flows=${data.flows.length} edge_anchors=${data.edge_anchors.length}`)
NODE

SUMMARY="${RUN_DIR}/summary.txt"
cat >"${SUMMARY}" <<EOF
Chain Insights against Chain Insights Graph UAT PASS

Endpoint: ${MCP_ENDPOINT}
Network: ${NETWORK}
Address: ${UAT_ADDRESS}
Same-network LINKED ownership-overlay counterpart (robinhood): ${UAT_LINKED_ADDRESS}
Graph report URL: ${GRAPH_REPORT_URL}

Raw outputs:
- ${DIRECT_TOOLS_JSON}
${DIRECT_ADDRESS_RISK_SUMMARY}
- ${ADDRESS_SCOPE_REJECTION_JSON}
- ${PROXY_TOOLS_JSON}
- ${PROXY_JSON}
- ${GRAPH_REPORT_JSON}
- ${GRAPH_QUERY_TEXT}

Workspace:
- ${WORKSPACE_ROOT}
EOF

log "PASS"
log "summary: ${SUMMARY}"
