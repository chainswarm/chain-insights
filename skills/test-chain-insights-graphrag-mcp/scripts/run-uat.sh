#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHAIN_INSIGHTS_DIR="${CHAIN_INSIGHTS_DIR:-$(cd "${SCRIPT_DIR}/../../.." && pwd)}"
MCP_ENDPOINT="${GRAPHRAG_MCP_ENDPOINT:-http://localhost:8012/mcp}"
DEBUG_TOKEN="${GRAPHRAG_DEBUG_TOKEN:-chain-insights-dev-debug}"
SERVER_PORT="${CHAIN_INSIGHTS_SERVER_PORT:-4321}"
NETWORK="${NETWORK:-bittensor}"
UAT_ADDRESS="${UAT_ADDRESS:-5Ccmf1dJKzGtXX7h17eN72MVMRsFwvYjPVmkXPUaapczECf6}"
REPORT_DIR="${REPORT_DIR:-${CHAIN_INSIGHTS_DIR}/.tmp/uat}"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="${REPORT_DIR}/${RUN_ID}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-${RUN_DIR}/workspace}"
CHAIN_INSIGHTS_CLI="${CHAIN_INSIGHTS_DIR}/bin/cli.js"
CHAIN_INSIGHTS_PROXY="${CHAIN_INSIGHTS_DIR}/bin/mcp-proxy.cjs"
GLOBAL_REPORTS="${HOME}/.chain-insights/reports"
GLOBAL_CASES="${HOME}/.chain-insights/cases"
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
  for dir in "${GLOBAL_REPORTS}" "${GLOBAL_CASES}"; do
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
    log "global investigation output roots changed; reports/cases must stay workspace-local"
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
log "using GraphRAG MCP endpoint: ${MCP_ENDPOINT}"

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
log "checking direct GraphRAG tools/list"
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
const hasHighLevel = ['address_risk', 'track_funds'].every((name) => names.has(name))
fs.writeFileSync(highLevelFile, hasHighLevel ? 'yes\n' : 'no\n')
console.log(`[uat] direct tools/list ok: ${tools.length} tools (${hasHighLevel ? 'high-level' : 'primitive-only'})`)
NODE

DIRECT_JSON="${RUN_DIR}/direct-address-risk.json"
DIRECT_ADDRESS_RISK_SUMMARY="- direct address_risk skipped: direct endpoint is primitive-only"
if [[ "$(cat "${RUN_DIR}/direct-high-level-tools.txt")" == "yes" ]]; then
  log "calling direct GraphRAG address_risk"
  npx @modelcontextprotocol/inspector \
    --cli "${MCP_ENDPOINT}" \
    --transport http \
    --header "Authorization: Bearer ${DEBUG_TOKEN}" \
    --header "X-MCP-Debug-Token: ${DEBUG_TOKEN}" \
    --method tools/call \
    --tool-name address_risk \
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
if (data.isError) errors.push('direct address_risk returned isError=true')
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
console.log(`[uat] direct address_risk ok: nodes=${graphData.nodes.length} edges=${graphData.edges.length} flows=${graphData.flows.length} edge_anchors=${graphData.edge_anchors.length}`)
NODE
  DIRECT_ADDRESS_RISK_SUMMARY="- ${DIRECT_JSON}"
else
  log "direct GraphRAG high-level tools absent; primitive-only endpoint, skipping direct address_risk check"
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
const required = ['balance', 'help', 'address_risk', 'stake_insights', 'track_funds', 'scam_topology', 'network_capabilities', 'graph_query', 'graph_query_batch']
const missing = required.filter((name) => !names.has(name))
if (missing.length) throw new Error(`proxy tools/list missing tools: ${missing.join(', ')}`)
for (const hidden of ['topup', 'trace_funds', 'money_flows_between_exchanges', 'address_connection_risk']) {
  if (names.has(hidden)) throw new Error(`proxy tools/list exposed hidden tool: ${hidden}`)
}
if (JSON.stringify(tools).includes('app_data')) throw new Error('proxy tools/list still contains app_data')
const graphTools = tools.filter((tool) => tool._meta?.ui?.resourceUri === 'ui://chain-insights/graph').map((tool) => tool.name)
for (const name of ['address_risk', 'stake_insights', 'track_funds', 'scam_topology']) {
  if (!graphTools.includes(name)) throw new Error(`proxy graph app metadata missing for ${name}`)
}
console.log(`[uat] proxy tools/list ok: ${tools.length} tools`)
NODE

PROXY_JSON="${RUN_DIR}/proxy-address-risk.json"
log "calling Chain Insights proxy address_risk"
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
      name: 'address_risk',
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
node - "${PROXY_JSON}" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
const errors = []
const content = data.content || []
const sc = data.structuredContent || {}
const graph = data._meta?.chainInsights?.graph
if (data.isError) errors.push('proxy address_risk returned isError=true')
if (content[0]?.type !== 'text') errors.push('proxy content[0] is not text')
if (sc.schema !== 'chain-insights.result.v1') errors.push(`proxy structuredContent schema mismatch: ${sc.schema}`)
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
console.error(`[uat] proxy address_risk ok: graph_report=${graph.url}`)
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

GRAPH_QUERY_TEXT="${RUN_DIR}/graph-query-address.txt"
log "calling Chain Insights CLI graph_query against real MCP"
(
  cd "${WORKSPACE_ROOT}"
  node "${CHAIN_INSIGHTS_CLI}" mcp call graph_query \
    "network=${NETWORK}" \
    "query=USE live_topology MATCH (n) WHERE n.address = '${UAT_ADDRESS}' RETURN n.labels AS labels, n.address AS address LIMIT 1"
) >"${GRAPH_QUERY_TEXT}"

node - "${GRAPH_QUERY_TEXT}" "${UAT_ADDRESS}" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const address = process.argv[3]
const text = fs.readFileSync(file, 'utf8').trim()
const data = JSON.parse(text)
const first = data.facts?.query?.results?.[0] || data.results?.[0]
if (!first || first.address !== address) {
  throw new Error(`graph_query did not return expected address ${address}`)
}
console.log(`[uat] graph_query ok: ${first.address}`)
NODE

SUMMARY="${RUN_DIR}/summary.txt"
cat >"${SUMMARY}" <<EOF
Chain Insights vs GraphRAG MCP UAT PASS

Endpoint: ${MCP_ENDPOINT}
Network: ${NETWORK}
Address: ${UAT_ADDRESS}
Graph report URL: ${GRAPH_REPORT_URL}

Raw outputs:
- ${DIRECT_TOOLS_JSON}
${DIRECT_ADDRESS_RISK_SUMMARY}
- ${PROXY_TOOLS_JSON}
- ${PROXY_JSON}
- ${GRAPH_REPORT_JSON}
- ${GRAPH_QUERY_TEXT}

Workspace:
- ${WORKSPACE_ROOT}
EOF

log "PASS"
log "summary: ${SUMMARY}"
