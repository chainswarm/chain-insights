#!/usr/bin/env bash
set -Eeuo pipefail

TARGET_ADDRESS="${TARGET_ADDRESS:-5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5}"
NETWORK="${NETWORK:-bittensor}"
GRAPH_MCP_ENDPOINT="${GRAPH_MCP_ENDPOINT:-http://localhost:8012/mcp}"
GRAPH_MCP_DEBUG_TOKEN="${GRAPH_MCP_DEBUG_TOKEN:-chain-insights-dev-debug}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(mktemp -d /tmp/chain-insights-investigation-uat.XXXXXX)}"

log() {
  printf '[chain-insights-investigation-uat] %s\n' "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '[chain-insights-investigation-uat] missing command: %s\n' "$1" >&2
    exit 127
  fi
}

restore_mode() {
  if [[ -n "${OLD_GRAPH_MCP_MODE:-}" ]]; then
    cia config set graphMcpMode "${OLD_GRAPH_MCP_MODE}" >/dev/null || true
  fi
  if [[ -n "${OLD_GRAPH_MCP_ENDPOINT:-}" ]]; then
    cia config set graphMcpEndpoint "${OLD_GRAPH_MCP_ENDPOINT}" >/dev/null || true
  fi
  cia config set graphMcpAuthToken "${OLD_GRAPH_MCP_AUTH_TOKEN:-}" >/dev/null || true
}
trap restore_mode EXIT

require_cmd cia
require_cmd node
require_cmd jq

OLD_GRAPH_MCP_MODE="$(cia config get graphMcpMode || true)"
OLD_GRAPH_MCP_ENDPOINT="$(cia config get graphMcpEndpoint || true)"
OLD_GRAPH_MCP_AUTH_TOKEN="$(cia config get graphMcpAuthToken || true)"

log "workspace: ${WORKSPACE_ROOT}"
log "target: ${NETWORK}:${TARGET_ADDRESS}"
log "enabling Graph MCP debug mode for UAT"
cia debug on --token "${GRAPH_MCP_DEBUG_TOKEN}" --endpoint "${GRAPH_MCP_ENDPOINT}" >/dev/null

cia init "${WORKSPACE_ROOT}" --force >/dev/null
cd "${WORKSPACE_ROOT}"

CASE_NAME="Tracking stolen funds from ${TARGET_ADDRESS}"
cia case open "${CASE_NAME}" --tags "${NETWORK},uat" --description "Fresh-folder Chain Insights investigation UAT." >/tmp/chain-insights-uat-case-open.txt
CASE_ID="$(sed -n 's/^Case opened: //p' /tmp/chain-insights-uat-case-open.txt | head -n1)"
if [[ -z "${CASE_ID}" ]]; then
  log "failed to parse case id"
  cat /tmp/chain-insights-uat-case-open.txt >&2
  exit 1
fi

cia case session start 1 "UAT graph evidence for ${TARGET_ADDRESS}" >/dev/null
mkdir -p reports/uat reports/graphs .chain-insights/schema

SCHEMA_RAW=".chain-insights/schema/${NETWORK}.graph-schema.raw.json"
SCHEMA_FILE=".chain-insights/schema/${NETWORK}.graph-schema.json"
log "capturing ${NETWORK} graph schema"
cia mcp call graph_query_batch \
  network="${NETWORK}" \
  'queries=[{"id":"node_labels","query":"MATCH (n) UNWIND labels(n) AS label RETURN label, count(*) AS count ORDER BY count DESC LIMIT 100"},{"id":"relationship_types","query":"MATCH ()-[r]->() RETURN type(r) AS relationship_type, count(*) AS count ORDER BY count DESC LIMIT 100"},{"id":"address_property_keys","query":"MATCH (n:Address) WITH keys(n) AS keys LIMIT 1000 UNWIND keys AS property_key RETURN property_key, count(*) AS sample_count ORDER BY sample_count DESC, property_key LIMIT 200"},{"id":"flows_to_property_keys","query":"MATCH ()-[r:FLOWS_TO]->() WITH keys(r) AS keys LIMIT 1000 UNWIND keys AS property_key RETURN property_key, count(*) AS sample_count ORDER BY sample_count DESC, property_key LIMIT 200"}]' \
  > "${SCHEMA_RAW}"

jq --arg network "${NETWORK}" '{
  schema:"chain-insights.runtime_graph_schema.v1",
  network:$network,
  source:"graph_query_batch",
  node_labels:(.facts.queries[]|select(.id=="node_labels")|.results),
  relationship_types:(.facts.queries[]|select(.id=="relationship_types")|.results),
  address_property_keys:(.facts.queries[]|select(.id=="address_property_keys")|.results|map(.property_key)),
  flows_to_property_keys:(.facts.queries[]|select(.id=="flows_to_property_keys")|.results|map(.property_key))
}' "${SCHEMA_RAW}" > "${SCHEMA_FILE}"

if ! jq -e '.flows_to_property_keys | index("amount_sum")' "${SCHEMA_FILE}" >/dev/null; then
  log "schema did not include FLOWS_TO.amount_sum"
  cat "${SCHEMA_FILE}" >&2
  exit 1
fi

RESULT_FILE="reports/uat/address_exists.json"
COMPACT_FILE="reports/uat/address_exists.compact.json"

log "running graph_query_batch address_exists"
cia mcp call graph_query_batch \
  network="${NETWORK}" \
  "queries=[{\"id\":\"address_exists\",\"query\":\"MATCH (n:Address {address: \\\"${TARGET_ADDRESS}\\\"}) RETURN n.address AS address, labels(n) AS labels, n.degree_in AS degree_in, n.degree_out AS degree_out, n.tx_total_count AS tx_total_count, n.total_volume_usd AS total_volume_usd LIMIT 1\"}]" \
  > "${RESULT_FILE}"

if ! grep -q "${TARGET_ADDRESS}" "${RESULT_FILE}"; then
  log "graph result did not contain target address"
  cat "${RESULT_FILE}" >&2
  exit 1
fi

jq --arg network "${NETWORK}" '{
  schema:"chain-insights.compact_evidence.v1",
  source:"graph_query_batch",
  network:$network,
  query_ids:["address_exists"],
  addresses:(.facts.queries[]|select(.id=="address_exists")|.results)
}' "${RESULT_FILE}" > "${COMPACT_FILE}"

EVIDENCE_OUT="$(cia case evidence add 1 \
  --source graph_query_batch_compact \
  --query-params "network=${NETWORK} address=${TARGET_ADDRESS} query=address_exists compact=true schema=${SCHEMA_FILE}" \
  --content "$(cat "${COMPACT_FILE}")")"
printf '%s\n' "${EVIDENCE_OUT}" > reports/uat/evidence-add.txt

SHOW_OUT="$(cia case show 1)"
printf '%s\n' "${SHOW_OUT}" > reports/uat/case-show.txt
if ! printf '%s\n' "${SHOW_OUT}" | grep -q 'Evidence files: 1'; then
  log "case show did not report one evidence file"
  printf '%s\n' "${SHOW_OUT}" >&2
  exit 1
fi

cia case dossier update 1 "${TARGET_ADDRESS}" \
  --type unknown \
  --finding "UAT confirmed the target address exists in ${NETWORK}; see compact address_exists evidence and ${SCHEMA_FILE}." >/dev/null

cia case session end 1 \
  --findings "UAT confirmed schema capture and compact graph_query_batch evidence for the target address." \
  --next-steps "Run narrow FLOWS_TO projections and save graph JSON under reports/graphs/." >/dev/null

FINAL_SHOW="$(cia case show 1)"
printf '%s\n' "${FINAL_SHOW}" > reports/uat/final-case-show.txt
if ! printf '%s\n' "${FINAL_SHOW}" | grep -q 'Dossiers: 1'; then
  log "case show did not report one dossier"
  printf '%s\n' "${FINAL_SHOW}" >&2
  exit 1
fi

log "PASS"
log "workspace: ${WORKSPACE_ROOT}"
log "case: ${CASE_ID}"
log "result: ${WORKSPACE_ROOT}/${RESULT_FILE}"
log "schema: ${WORKSPACE_ROOT}/${SCHEMA_FILE}"
log "evidence:"
find "cases/${CASE_ID}/evidence" -maxdepth 1 -type f -print | sort
