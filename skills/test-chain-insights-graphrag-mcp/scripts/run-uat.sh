#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHAIN_INSIGHTS_DIR="${CHAIN_INSIGHTS_DIR:-$(cd "${SCRIPT_DIR}/../../.." && pwd)}"
MCP_ENDPOINT="${GRAPHRAG_MCP_ENDPOINT:-http://localhost:8012/mcp}"
DEBUG_TOKEN="${GRAPHRAG_DEBUG_TOKEN:-chain-insights-dev-debug}"
SERVER_PORT="${CHAIN_INSIGHTS_SERVER_PORT:-4321}"
NETWORK="${NETWORK:-bittensor}"
UAT_ADDRESS="${UAT_ADDRESS:-5Ccmf1dJKzGtXX7h17eN72MVMRsFwvYjPVmkXPUaapczECf6}"
# Identity-route facts are keyed by the public identity key form
# '<network>:<canonical_evm_address>' (deterministic H160 mapping of
# UAT_ADDRESS). Override together with UAT_ADDRESS.
UAT_IDENTITY_KEY="${UAT_IDENTITY_KEY:-bittensor:0x1874a43d7c6d888f9eda3d22a3a49704e3cadb24}"
UAT_EXPOSURE_ACCOUNT="${UAT_EXPOSURE_ACCOUNT:-}"
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
const hasHighLevel = ['aml_address_risk', 'aml_trace_victim_funds'].every((name) => names.has(name))
fs.writeFileSync(highLevelFile, hasHighLevel ? 'yes\n' : 'no\n')
console.log(`[uat] direct tools/list ok: ${tools.length} tools (${hasHighLevel ? 'high-level' : 'primitive-only'})`)
NODE

DIRECT_CAPABILITIES_JSON="${RUN_DIR}/direct-network-capabilities.json"
log "checking semantic identity network capabilities"
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
const byName = new Map(networks.map((entry) => [entry.network, entry]))
const source = byName.get(network)
const errors = []
if (!source) errors.push(`network_capabilities missing source network ${network}`)
if (source?.layers?.topology?.enabled !== true) errors.push(`${network} topology is not enabled`)
if (source?.tools?.graph_query !== 'available') errors.push(`${network} graph_query is not available`)
if (network === 'bittensor') {
  const evm = byName.get('bittensor_evm')
  if (!evm) errors.push('network_capabilities missing bittensor_evm source network')
  if (evm?.layers?.topology?.enabled !== true) errors.push('bittensor_evm topology is not enabled')
}
if (errors.length) throw new Error(errors.join('; '))
console.log(`[uat] network_capabilities ok: source=${network}`)
NODE

IDENTITY_TOPOLOGY_JSON="${RUN_DIR}/direct-identity-topology.json"
IDENTITY_TOPOLOGY_QUERY="USE live_topology MATCH (s:Identity)-[f:FLOWS_TO]->(d:Identity) RETURN count(f) AS identity_flows"
log "checking public-route identity topology (network=${NETWORK} topology_scope=identity)"
npx @modelcontextprotocol/inspector \
  --cli "${MCP_ENDPOINT}" \
  --transport http \
  --header "Authorization: Bearer ${DEBUG_TOKEN}" \
  --header "X-MCP-Debug-Token: ${DEBUG_TOKEN}" \
  --method tools/call \
  --tool-name graph_query \
  --tool-arg "network=${NETWORK}" \
  --tool-arg "topology_scope=identity" \
  --tool-arg "query=${IDENTITY_TOPOLOGY_QUERY}" >"${IDENTITY_TOPOLOGY_JSON}"

node - "${IDENTITY_TOPOLOGY_JSON}" "${NETWORK}" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const network = process.argv[3]
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
const errors = []
if (data.isError) errors.push(`identity topology query returned isError=true: ${data.content?.[0]?.text || 'unknown error'}`)
const facts = data.structuredContent?.facts
const subject = facts?.subject
const routing = facts?.routing
const flows = facts?.query?.results?.[0]?.identity_flows
if (subject?.network !== network) errors.push(`identity subject network mismatch: ${subject?.network}`)
if (subject?.topology_scope !== 'identity') errors.push(`identity subject topology_scope mismatch: ${subject?.topology_scope}`)
if (routing?.starrocks_database !== `${network}_semantic`) errors.push(`identity routing database mismatch: ${routing?.starrocks_database}`)
if (!Number.isFinite(Number(flows)) || Number(flows) <= 0) errors.push(`identity FLOWS_TO count not positive: ${flows}`)
if (errors.length) throw new Error(errors.join('; '))
console.log(`[uat] public-route identity topology ok: flows=${flows} routing=${routing.starrocks_database}`)
NODE

SEMANTIC_FACTS_JSON="${RUN_DIR}/direct-semantic-facts.json"
SEMANTIC_FACTS_QUERY="USE facts MATCH (a:Address {address: '${UAT_IDENTITY_KEY}'}) RETURN a.address AS identity_key, a.labels AS labels, a.is_exchange AS is_exchange LIMIT 1"
log "checking semantic identity facts query"
npx @modelcontextprotocol/inspector \
  --cli "${MCP_ENDPOINT}" \
  --transport http \
  --header "Authorization: Bearer ${DEBUG_TOKEN}" \
  --header "X-MCP-Debug-Token: ${DEBUG_TOKEN}" \
  --method tools/call \
  --tool-name graph_query \
  --tool-arg "network=${NETWORK}" \
  --tool-arg "topology_scope=identity" \
  --tool-arg "query=${SEMANTIC_FACTS_QUERY}" >"${SEMANTIC_FACTS_JSON}"

node - "${SEMANTIC_FACTS_JSON}" "${NETWORK}" "${UAT_IDENTITY_KEY}" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const network = process.argv[3]
const identityKey = process.argv[4]
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
const errors = []
if (data.isError) errors.push(`semantic facts query returned isError=true: ${data.content?.[0]?.text || 'unknown error'}`)
const subject = data.structuredContent?.facts?.subject
const routing = data.structuredContent?.facts?.routing
const results = data.structuredContent?.facts?.query?.results || []
const match = results.find((row) => row.identity_key === identityKey)
const labels = Array.isArray(match?.labels) ? match.labels.join(',') : (match?.labels || '')
if (subject?.network !== network) errors.push(`semantic facts subject network mismatch: ${subject?.network}`)
if (subject?.topology_scope !== 'identity') errors.push(`semantic facts subject scope mismatch: ${subject?.topology_scope}`)
if (routing?.starrocks_database !== `${network}_semantic`) errors.push(`semantic facts routing database mismatch: ${routing?.starrocks_database}`)
if (!match) errors.push(`semantic facts query did not return identity key ${identityKey}`)
if (labels.length === 0) errors.push('semantic facts query did not return identity labels')
if (errors.length) throw new Error(errors.join('; '))
console.log(`[uat] semantic facts query ok: identity_key=${identityKey} labels=${labels}`)
NODE

ADDRESS_TOPOLOGY_JSON="${RUN_DIR}/direct-address-topology.json"
ADDRESS_TOPOLOGY_QUERY="USE live_topology MATCH (a:Address)-[f:FLOWS_TO]->(b:Address) RETURN count(f) AS address_flows"
log "checking address topology unregression (network=${NETWORK})"
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
if (data.isError) errors.push(`address topology query returned isError=true: ${data.content?.[0]?.text || 'unknown error'}`)
const facts = data.structuredContent?.facts
const subject = facts?.subject
const flows = facts?.query?.results?.[0]?.address_flows
if (subject?.network !== network) errors.push(`address subject network mismatch: ${subject?.network}`)
if (subject?.topology_scope !== 'address') errors.push(`address subject topology_scope mismatch: ${subject?.topology_scope}`)
if (!Number.isFinite(Number(flows)) || Number(flows) <= 0) errors.push(`address FLOWS_TO count not positive: ${flows}`)
if (errors.length) throw new Error(errors.join('; '))
console.log(`[uat] address topology unregressed: flows=${flows}`)
NODE

DIRECT_JSON="${RUN_DIR}/direct-address-risk.json"
DIRECT_ADDRESS_RISK_SUMMARY="- direct aml_address_risk skipped: direct endpoint is primitive-only"
if [[ "$(cat "${RUN_DIR}/direct-high-level-tools.txt")" == "yes" ]]; then
  log "calling direct GraphRAG aml_address_risk"
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
  log "direct GraphRAG high-level tools absent; primitive-only endpoint, skipping direct aml_address_risk check"
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
const required = ['balance', 'help', 'aml_address_risk', 'exposure_profile', 'exposure_quality', 'exposure_carry', 'exposure_crowding', 'exposure_exit_pressure', 'exposure_correlation', 'exposure_explain', 'aml_trace_victim_funds', 'aml_trace_suspect_funds', 'aml_trace_deposit_sources', 'network_capabilities', 'graph_query', 'graph_query_batch', 'usage_status']
const missing = required.filter((name) => !names.has(name))
if (missing.length) throw new Error(`proxy tools/list missing tools: ${missing.join(', ')}`)
if (names.size !== required.length) {
  const unexpected = [...names].filter((name) => !required.includes(name))
  throw new Error(`proxy tools/list exposed unexpected tools: ${unexpected.join(', ')}`)
}
if (JSON.stringify(tools).includes('app_data')) throw new Error('proxy tools/list still contains app_data')
const graphTools = tools.filter((tool) => tool._meta?.ui?.resourceUri === 'ui://chain-insights/graph').map((tool) => tool.name)
for (const name of ['aml_address_risk', 'exposure_profile', 'exposure_quality', 'exposure_carry', 'exposure_crowding', 'exposure_exit_pressure', 'exposure_correlation', 'exposure_explain', 'aml_trace_victim_funds', 'aml_trace_suspect_funds', 'aml_trace_deposit_sources']) {
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
node - "${PROXY_JSON}" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
const errors = []
const content = data.content || []
const sc = data.structuredContent || {}
const graph = data._meta?.chainInsights?.graph
if (data.isError) errors.push('proxy aml_address_risk returned isError=true')
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

EXPOSURE_ACCOUNT="${UAT_EXPOSURE_ACCOUNT}"
EXPOSURE_DISCOVERY_JSON="${RUN_DIR}/exposure-account-discovery.json"
if [[ -z "${EXPOSURE_ACCOUNT}" ]]; then
  log "discovering generic exposure UAT account"
  npx @modelcontextprotocol/inspector \
    --cli "${MCP_ENDPOINT}" \
    --transport http \
    --header "Authorization: Bearer ${DEBUG_TOKEN}" \
    --header "X-MCP-Debug-Token: ${DEBUG_TOKEN}" \
    --method tools/call \
    --tool-name graph_query_batch \
    --tool-arg "network=${NETWORK}" \
    --tool-arg 'queries=[{"id":"live_exposure_uat_account","query":"USE live_topology MATCH (account:Address)-[:HAS_EXPOSURE]->(exposure:Exposure)-[:TARGETS_INSTRUMENT]->(instrument:Instrument) RETURN account.address AS account_address, exposure.venue AS venue, instrument.display_id AS instrument_display_id, exposure.side AS side LIMIT 1"},{"id":"archive_exposure_uat_account","query":"USE archive_topology MATCH (account:Address)-[:HAS_EXPOSURE]->(exposure:Exposure)-[:TARGETS_INSTRUMENT]->(instrument:Instrument) RETURN account.address AS account_address, exposure.venue AS venue, instrument.display_id AS instrument_display_id, exposure.side AS side LIMIT 1"}]' >"${EXPOSURE_DISCOVERY_JSON}"

  EXPOSURE_ACCOUNT="$(
    node - "${EXPOSURE_DISCOVERY_JSON}" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
const textPayload = data.content?.find((item) => item.type === 'text')?.text
const parsedText = textPayload ? JSON.parse(textPayload) : {}
const queries = data.structuredContent?.facts?.queries || parsedText.facts?.queries || []
const rows = queries.flatMap((query) => Array.isArray(query.results) ? query.results : [])
const account = rows.map((row) => row.account_address).find((value) => typeof value === 'string' && value.length > 0)
if (!account) {
  throw new Error('no generic exposure rows found; run exposure GraphRAG sync or set UAT_EXPOSURE_ACCOUNT')
}
process.stdout.write(account)
NODE
  )"
fi
printf '%s\n' "${EXPOSURE_ACCOUNT}" >"${RUN_DIR}/exposure-account.txt"
log "using generic exposure UAT account: ${EXPOSURE_ACCOUNT}"

EXPOSURE_PROFILE_JSON="${RUN_DIR}/proxy-exposure-profile.json"
log "calling Chain Insights proxy exposure_profile"
node --input-type=module - "${CHAIN_INSIGHTS_PROXY}" "${NETWORK}" "${EXPOSURE_ACCOUNT}" "${EXPOSURE_PROFILE_JSON}" <<'NODE'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import fs from 'node:fs'

const proxy = process.argv[2]
const network = process.argv[3]
const account = process.argv[4]
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
      name: 'exposure_profile',
      arguments: {
        network,
        account,
        limit: 3,
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

node - "${EXPOSURE_PROFILE_JSON}" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
const errors = []
const content = data.content || []
const sc = data.structuredContent || {}
const serialized = JSON.stringify(data)
if (data.isError) errors.push('proxy exposure_profile returned isError=true')
if (content[0]?.type !== 'text') errors.push('proxy exposure_profile content[0] is not text')
if (sc.schema !== 'chain-insights.exposure_profile.v1') errors.push(`proxy exposure_profile schema mismatch: ${sc.schema}`)
if (sc.tool !== 'exposure_profile') errors.push(`proxy exposure_profile tool mismatch: ${sc.tool}`)
if (!Array.isArray(sc.exposures) || sc.exposures.length < 1) errors.push('proxy exposure_profile returned no exposures')
if (sc.exposures?.length > 3) errors.push(`proxy exposure_profile exceeded requested limit: ${sc.exposures.length}`)
for (const forbidden of [
  'source_backend',
  'evidence_relationship_type',
  'STAKES_IN',
  'HAS_EXPOSURE',
  'TARGETS_HOTKEY',
  'live_topology',
  'archive_topology',
  'core_exposure',
  'include_attachments',
  'stake_unit',
]) {
  if (serialized.includes(forbidden)) errors.push(`proxy exposure_profile leaks ${forbidden}`)
}
if (errors.length) throw new Error(errors.join('; '))
console.log(`[uat] exposure_profile ok: exposures=${sc.exposures.length}`)
NODE

EXPOSURE_INSIGHTS_JSON="${RUN_DIR}/proxy-exposure-insights.json"
log "calling Chain Insights proxy generic exposure tools"
node --input-type=module - "${CHAIN_INSIGHTS_PROXY}" "${NETWORK}" "${EXPOSURE_ACCOUNT}" "${EXPOSURE_PROFILE_JSON}" "${EXPOSURE_INSIGHTS_JSON}" <<'NODE'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import fs from 'node:fs'

const proxy = process.argv[2]
const network = process.argv[3]
const account = process.argv[4]
const profileFile = process.argv[5]
const outputFile = process.argv[6]
const requestTimeoutMs = 5 * 60 * 1000
const profileData = JSON.parse(fs.readFileSync(profileFile, 'utf8'))
const profile = profileData.structuredContent || {}
const exposure = Array.isArray(profile.exposures) ? profile.exposures[0] : undefined
const instrument = exposure?.instrument?.display_name || exposure?.instrument?.id

if (!instrument) throw new Error('proxy exposure_profile did not return an instrument for generic exposure smoke')

const calls = [
  { name: 'exposure_quality', arguments: { network, account, limit: 3 } },
  { name: 'exposure_carry', arguments: { network, account, limit: 3 } },
  { name: 'exposure_crowding', arguments: { network, instrument, limit: 10 } },
  { name: 'exposure_exit_pressure', arguments: { network, account, limit: 3 } },
  { name: 'exposure_correlation', arguments: { network, account, candidate_accounts: account, limit: 3 } },
  { name: 'exposure_explain', arguments: { network, account, instrument, limit: 3 } },
]

const client = new Client({ name: 'chain-insights-uat-exposure', version: '0.0.0' })
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [proxy],
  env: process.env,
})

try {
  await client.connect(transport)
  const results = {}
  for (const call of calls) {
    results[call.name] = await client.callTool(
      call,
      undefined,
      {
        timeout: requestTimeoutMs,
        maxTotalTimeout: requestTimeoutMs,
      },
    )
  }
  fs.writeFileSync(outputFile, `${JSON.stringify({ instrument, results }, null, 2)}\n`)
} finally {
  await client.close()
}
NODE

node - "${EXPOSURE_INSIGHTS_JSON}" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
const expected = {
  exposure_quality: 'chain-insights.exposure_quality.v1',
  exposure_carry: 'chain-insights.exposure_carry.v1',
  exposure_crowding: 'chain-insights.exposure_crowding.v1',
  exposure_exit_pressure: 'chain-insights.exposure_exit_pressure.v1',
  exposure_correlation: 'chain-insights.exposure_correlation.v1',
  exposure_explain: 'chain-insights.exposure_explain.v1',
}
const forbidden = [
  'source_backend',
  'evidence_relationship_type',
  'STAKES_IN',
  'HAS_EXPOSURE',
  'TARGETS_HOTKEY',
  'live_topology',
  'archive_topology',
  'core_exposure',
  'include_attachments',
  'stake_unit',
]
const errors = []
for (const [name, schema] of Object.entries(expected)) {
  const result = data.results?.[name]
  const sc = result?.structuredContent || {}
  const serialized = JSON.stringify(result || {})
  if (!result) errors.push(`${name} result missing`)
  if (result?.isError) errors.push(`${name} returned isError=true`)
  if (result?.content?.[0]?.type !== 'text') errors.push(`${name} content[0] is not text`)
  if (sc.schema !== schema) errors.push(`${name} schema mismatch: ${sc.schema}`)
  if (sc.tool !== name) errors.push(`${name} tool mismatch: ${sc.tool}`)
  if (result?._meta?.chainInsights?.graph) errors.push(`${name} returned forbidden graph metadata`)
  for (const field of forbidden) {
    if (serialized.includes(field)) errors.push(`${name} leaks ${field}`)
  }
}
if (errors.length) throw new Error(errors.join('; '))
console.log(`[uat] generic exposure tools ok: ${Object.keys(expected).join(', ')}`)
NODE

log "checking exposure persistence contract"
node - "${WORKSPACE_ROOT}" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')

const workspace = process.argv[2]
const reportsDir = path.join(workspace, 'reports')
const tablesDir = path.join(reportsDir, 'tables')
const graphsDir = path.join(reportsDir, 'graphs')
const tools = [
  'exposure_profile',
  'exposure_quality',
  'exposure_carry',
  'exposure_crowding',
  'exposure_exit_pressure',
  'exposure_correlation',
  'exposure_explain',
]

const reportFiles = fs.readdirSync(reportsDir).filter((name) => name.endsWith('.exposure-report.md'))
const tableFiles = fs.readdirSync(tablesDir)
const graphFiles = fs.existsSync(graphsDir) ? fs.readdirSync(graphsDir) : []
const errors = []

for (const tool of tools) {
  if (!reportFiles.some((name) => name.includes(tool))) errors.push(`${tool} report markdown missing`)
  if (!tableFiles.some((name) => name.includes(tool) && name.endsWith('.compact-facts.json'))) {
    errors.push(`${tool} compact facts JSON missing`)
  }
}

for (const name of reportFiles) {
  if (name.includes('exposure_') && name.endsWith('.graph.html')) errors.push(`forbidden exposure graph html persisted: ${name}`)
}
for (const name of graphFiles) {
  if (name.includes('exposure_')) errors.push(`forbidden exposure graph json persisted: ${name}`)
}

if (errors.length) throw new Error(errors.join('; '))
console.log(`[uat] exposure persistence ok: reports=${reportFiles.length} tables=${tableFiles.length}`)
NODE

GRAPH_QUERY_TEXT="${RUN_DIR}/graph-query-address.txt"
log "calling Chain Insights CLI graph_query against real MCP"
# Bounded retry: a busy graph store can transiently queue point reads past
# the MCP per-query timeout (e.g. mid-resync); the assertion itself is
# unchanged and still requires the exact UAT address row.
GRAPH_QUERY_ATTEMPTS="${GRAPH_QUERY_ATTEMPTS:-3}"
for attempt in $(seq 1 "${GRAPH_QUERY_ATTEMPTS}"); do
  (
    cd "${WORKSPACE_ROOT}"
    node "${CHAIN_INSIGHTS_CLI}" mcp call graph_query \
      "network=${NETWORK}" \
      "query=USE live_topology MATCH (n:Address) WHERE n.address = '${UAT_ADDRESS}' RETURN n.labels AS labels, n.address AS address LIMIT 1"
  ) >"${GRAPH_QUERY_TEXT}" || true
  if node -e "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8').trim())" "${GRAPH_QUERY_TEXT}" 2>/dev/null; then
    break
  fi
  if [[ "${attempt}" -lt "${GRAPH_QUERY_ATTEMPTS}" ]]; then
    log "graph_query attempt ${attempt} returned a non-JSON transient error; retrying in 20s"
    sleep 20
  fi
done

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
Exposure account: ${EXPOSURE_ACCOUNT}
Graph report URL: ${GRAPH_REPORT_URL}

Raw outputs:
- ${DIRECT_TOOLS_JSON}
${DIRECT_ADDRESS_RISK_SUMMARY}
- ${PROXY_TOOLS_JSON}
- ${PROXY_JSON}
- ${GRAPH_REPORT_JSON}
- ${EXPOSURE_DISCOVERY_JSON}
- ${EXPOSURE_PROFILE_JSON}
- ${EXPOSURE_INSIGHTS_JSON}
- ${GRAPH_QUERY_TEXT}

Workspace:
- ${WORKSPACE_ROOT}
EOF

log "PASS"
log "summary: ${SUMMARY}"
