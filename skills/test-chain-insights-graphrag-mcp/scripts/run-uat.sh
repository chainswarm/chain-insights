#!/usr/bin/env bash
set -Eeuo pipefail

CHAIN_INSIGHTS_DIR="${CHAIN_INSIGHTS_DIR:-/home/aphex5/work/chain-insights}"
GRAPHRAG_ML_DIR="${GRAPHRAG_ML_DIR:-/home/aphex5/work/rbmk/repos/ml}"
GRAPHRAG_DIR="${GRAPHRAG_DIR:-${GRAPHRAG_ML_DIR}/graphrag}"
MCP_ENDPOINT="${GRAPHRAG_MCP_ENDPOINT:-http://localhost:8011/mcp}"
DEBUG_TOKEN="${GRAPHRAG_DEBUG_TOKEN:-chain-insights-dev-debug}"
SERVER_PORT="${CHAIN_INSIGHTS_SERVER_PORT:-4321}"
NETWORK="${NETWORK:-bittensor}"
UAT_ADDRESS="${UAT_ADDRESS:-5Ccmf1dJKzGtXX7h17eN72MVMRsFwvYjPVmkXPUaapczECf6}"
REPORT_DIR="${REPORT_DIR:-${CHAIN_INSIGHTS_DIR}/.tmp/uat}"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="${REPORT_DIR}/${RUN_ID}"
SERVER_PID=""

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

cleanup() {
  if [[ -n "${SERVER_PID}" ]]; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

require_cmd node
require_cmd npm
require_cmd npx
require_cmd docker
require_cmd curl

if [[ ! -d "${CHAIN_INSIGHTS_DIR}" ]]; then
  log "missing Chain Insights repo: ${CHAIN_INSIGHTS_DIR}"
  exit 1
fi

if [[ ! -d "${GRAPHRAG_ML_DIR}" ]]; then
  log "missing GraphRAG compose root: ${GRAPHRAG_ML_DIR}"
  exit 1
fi

if [[ ! -d "${GRAPHRAG_DIR}" ]]; then
  log "missing GraphRAG repo: ${GRAPHRAG_DIR}"
  exit 1
fi

log "report directory: ${RUN_DIR}"
log "starting GraphRAG MCP container"
(cd "${GRAPHRAG_ML_DIR}" && docker compose --env-file .env -f compose/shared.yml -f compose/bittensor.yml up -d graphrag-mcp)

cd "${CHAIN_INSIGHTS_DIR}"

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  log "building Chain Insights dist"
  npm run build
fi

log "configuring Chain Insights MCP endpoint and debug bearer token"
node bin/cli.js config set mcpEndpoint "${MCP_ENDPOINT}" >/dev/null
node bin/cli.js config set mcpAuthToken "${DEBUG_TOKEN}" >/dev/null
node bin/cli.js config set serverPort "${SERVER_PORT}" >/dev/null

if curl -sf "http://127.0.0.1:${SERVER_PORT}/health" >/dev/null 2>&1; then
  log "reusing healthy Chain Insights server on port ${SERVER_PORT}"
else
  log "starting Chain Insights server on port ${SERVER_PORT}"
  node bin/cli.js serve -p "${SERVER_PORT}" >"${RUN_DIR}/chain-insights-server.log" 2>&1 &
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
node bin/cli.js mcp tools --refresh >"${RUN_DIR}/chain-insights-tools.txt"

DIRECT_TOOLS_JSON="${RUN_DIR}/direct-tools-list.json"
log "checking direct GraphRAG tools/list"
npx @modelcontextprotocol/inspector \
  --cli "${MCP_ENDPOINT}" \
  --transport http \
  --header "Authorization: Bearer ${DEBUG_TOKEN}" \
  --header "X-MCP-Debug-Token: ${DEBUG_TOKEN}" \
  --method tools/list >"${DIRECT_TOOLS_JSON}"

node - "${DIRECT_TOOLS_JSON}" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
const tools = data.tools || []
const names = new Set(tools.map((tool) => tool.name))
const required = ['address_risk', 'track_funds', 'money_flows_between_exchanges', 'address_connection_risk', 'graph_query']
const missing = required.filter((name) => !names.has(name))
if (missing.length) throw new Error(`direct tools/list missing tools: ${missing.join(', ')}`)
if (JSON.stringify(tools).includes('app_data')) throw new Error('direct tools/list still contains app_data')
console.log(`[uat] direct tools/list ok: ${tools.length} tools`)
NODE

DIRECT_JSON="${RUN_DIR}/direct-address-risk.json"
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

PROXY_TOOLS_JSON="${RUN_DIR}/proxy-tools-list.json"
log "checking Chain Insights proxy tools/list"
npx @modelcontextprotocol/inspector \
  --cli node bin/mcp-proxy.cjs \
  --transport stdio \
  --method tools/list >"${PROXY_TOOLS_JSON}"

node - "${PROXY_TOOLS_JSON}" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
const tools = data.tools || []
const names = new Set(tools.map((tool) => tool.name))
const required = ['balance', 'topup', 'help', 'address_risk', 'track_funds', 'money_flows_between_exchanges', 'address_connection_risk', 'graph_query']
const missing = required.filter((name) => !names.has(name))
if (missing.length) throw new Error(`proxy tools/list missing tools: ${missing.join(', ')}`)
if (JSON.stringify(tools).includes('app_data')) throw new Error('proxy tools/list still contains app_data')
const graphTools = tools.filter((tool) => tool._meta?.ui?.resourceUri === 'ui://chain-insights/graph').map((tool) => tool.name)
for (const name of ['address_risk', 'track_funds', 'money_flows_between_exchanges', 'address_connection_risk']) {
  if (!graphTools.includes(name)) throw new Error(`proxy graph app metadata missing for ${name}`)
}
console.log(`[uat] proxy tools/list ok: ${tools.length} tools`)
NODE

PROXY_JSON="${RUN_DIR}/proxy-address-risk.json"
log "calling Chain Insights proxy address_risk"
npx @modelcontextprotocol/inspector \
  --cli node bin/mcp-proxy.cjs \
  --transport stdio \
  --method tools/call \
  --tool-name address_risk \
  --tool-arg "network=${NETWORK}" \
  --tool-arg "address=${UAT_ADDRESS}" \
  --tool-arg include_attachments=true >"${PROXY_JSON}"

ARTIFACT_URL="$(
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
if (!graph?.id) errors.push('proxy graph id missing')
if (!/^http:\/\/127\.0\.0\.1:\d+\/artifacts\/[A-Za-z0-9_-]+\/graph\.json$/.test(graph?.url || '')) {
  errors.push(`proxy graph url is not a local artifact URL: ${graph?.url}`)
}
if (errors.length) throw new Error(errors.join('; '))
console.error(`[uat] proxy address_risk ok: artifact=${graph.url}`)
process.stdout.write(graph.url)
NODE
)"
printf '%s\n' "${ARTIFACT_URL}" >"${RUN_DIR}/artifact-url.txt"

ARTIFACT_JSON="${RUN_DIR}/artifact-graph.json"
log "fetching local graph artifact"
curl -sf "${ARTIFACT_URL}" >"${ARTIFACT_JSON}"

node - "${ARTIFACT_JSON}" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
const errors = []
if (data.schema !== 'chain-insights.graph.v1') errors.push(`artifact schema mismatch: ${data.schema}`)
for (const key of ['nodes', 'edges', 'flows', 'edge_anchors']) {
  if (!Array.isArray(data[key])) errors.push(`artifact ${key} is not an array`)
}
if (Object.prototype.hasOwnProperty.call(data, 'transfers')) errors.push('artifact includes transfers')
if (errors.length) throw new Error(errors.join('; '))
console.log(`[uat] artifact ok: nodes=${data.nodes.length} edges=${data.edges.length} flows=${data.flows.length} edge_anchors=${data.edge_anchors.length}`)
NODE

GRAPH_QUERY_TEXT="${RUN_DIR}/graph-query-address.txt"
log "calling Chain Insights CLI graph_query against real MCP"
node bin/cli.js mcp call graph_query \
  "network=${NETWORK}" \
  "query=MATCH (n) WHERE n.address = '${UAT_ADDRESS}' RETURN labels(n) AS labels, n.address AS address LIMIT 1" \
  >"${GRAPH_QUERY_TEXT}"

node - "${GRAPH_QUERY_TEXT}" "${UAT_ADDRESS}" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const address = process.argv[3]
const text = fs.readFileSync(file, 'utf8').trim()
const data = JSON.parse(text)
const first = data.results?.[0]
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
Artifact URL: ${ARTIFACT_URL}

Raw outputs:
- ${DIRECT_TOOLS_JSON}
- ${DIRECT_JSON}
- ${PROXY_TOOLS_JSON}
- ${PROXY_JSON}
- ${ARTIFACT_JSON}
- ${GRAPH_QUERY_TEXT}
EOF

log "PASS"
log "summary: ${SUMMARY}"
