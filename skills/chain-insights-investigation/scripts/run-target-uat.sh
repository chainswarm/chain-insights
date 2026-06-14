#!/usr/bin/env bash
set -Eeuo pipefail

TARGET_ADDRESS="${TARGET_ADDRESS:-5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5}"
NETWORK="${NETWORK:-bittensor}"
GRAPH_MCP_ENDPOINT="${GRAPH_MCP_ENDPOINT:-http://localhost:8012/mcp}"
GRAPH_MCP_DEBUG_TOKEN="${GRAPH_MCP_DEBUG_TOKEN:-chain-insights-dev-debug}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(mktemp -d /tmp/chain-insights-investigation-uat.XXXXXX)}"
GLOBAL_REPORTS="${HOME}/.chain-insights/reports"
GLOBAL_ARTIFACTS="${HOME}/.chain-insights/artifacts"
GLOBAL_SNAPSHOT_BEFORE="$(mktemp /tmp/chain-insights-global-before.XXXXXX)"
GLOBAL_SNAPSHOT_AFTER="$(mktemp /tmp/chain-insights-global-after.XXXXXX)"
CONFIG_SNAPSHOT_READY=0

log() {
  printf '[chain-insights-investigation-uat] %s\n' "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '[chain-insights-investigation-uat] missing command: %s\n' "$1" >&2
    exit 127
  fi
}

snapshot_global_outputs() {
  local output_file="$1"
  : >"${output_file}"
  for dir in "${GLOBAL_REPORTS}" "${GLOBAL_ARTIFACTS}"; do
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
    log "global workspace output roots changed; reports/artifacts must stay workspace-local"
    diff -u "${GLOBAL_SNAPSHOT_BEFORE}" "${GLOBAL_SNAPSHOT_AFTER}" >&2 || true
    return 1
  fi
}

restore_mode() {
  if [[ "${CONFIG_SNAPSHOT_READY}" != "1" ]]; then
    return
  fi
  if [[ -n "${OLD_GRAPH_MCP_MODE:-}" ]]; then
    cia config set graphMcpMode "${OLD_GRAPH_MCP_MODE}" >/dev/null || true
  fi
  if [[ -n "${OLD_GRAPH_MCP_ENDPOINT:-}" ]]; then
    cia config set graphMcpEndpoint "${OLD_GRAPH_MCP_ENDPOINT}" >/dev/null || true
  fi
  cia config set graphMcpAuthToken "${OLD_GRAPH_MCP_AUTH_TOKEN:-}" >/dev/null || true
}

finish() {
  local status="$?"
  set +e
  if [[ -f "${GLOBAL_SNAPSHOT_BEFORE}" ]]; then
    assert_no_global_outputs_changed || status=1
  fi
  restore_mode
  rm -f "${GLOBAL_SNAPSHOT_BEFORE}" "${GLOBAL_SNAPSHOT_AFTER}"
  exit "${status}"
}
trap finish EXIT

require_cmd cia
require_cmd jq
require_cmd sha256sum

snapshot_global_outputs "${GLOBAL_SNAPSHOT_BEFORE}"

OLD_GRAPH_MCP_MODE="$(cia config get graphMcpMode || true)"
OLD_GRAPH_MCP_ENDPOINT="$(cia config get graphMcpEndpoint || true)"
OLD_GRAPH_MCP_AUTH_TOKEN="$(cia config get graphMcpAuthToken || true)"
CONFIG_SNAPSHOT_READY=1

log "workspace: ${WORKSPACE_ROOT}"
log "target: ${NETWORK}:${TARGET_ADDRESS}"
log "enabling Graph MCP debug mode for UAT"
cia debug on --token "${GRAPH_MCP_DEBUG_TOKEN}" --endpoint "${GRAPH_MCP_ENDPOINT}" >/dev/null

cia init "${WORKSPACE_ROOT}" --force >/dev/null
cd "${WORKSPACE_ROOT}"

mkdir -p reports/uat reports/tables reports/graphs artifacts entities .chain-insights/schema

SCHEMA_RAW=".chain-insights/schema/${NETWORK}.graph-schema.raw.json"
SCHEMA_FILE=".chain-insights/schema/${NETWORK}.graph-schema.json"
RESULT_FILE="reports/uat/member_address_identity.json"
COMPACT_FILE="reports/tables/member_address_identity.compact.json"
REPORT_FILE="reports/member_address_identity.md"
ENTITY_FILE="entities/${TARGET_ADDRESS}.md"

log "capturing ${NETWORK} graph schema"
cia mcp call graph_query_batch \
  network="${NETWORK}" \
  'queries=[{"id":"node_labels","query":"USE live_topology MATCH (i:Identity) RETURN \"Identity\" AS node_label, count(i) AS sample_count LIMIT 1"},{"id":"relationship_types","query":"USE live_topology MATCH (:Identity)-[r:FLOWS_TO]->(:Identity) RETURN \"FLOWS_TO\" AS rel_name, count(r) AS sample_count LIMIT 1"},{"id":"member_address_sample","query":"USE live_topology MATCH (i:Identity)-[:HAS_ADDRESS]->(m:Address) RETURN i.identity_id AS identity_id, m.address AS member_address, m.network AS member_network LIMIT 20"},{"id":"flow_sample","query":"USE live_topology MATCH (:Identity)-[r:FLOWS_TO]->(:Identity) RETURN r.amount_usd_sum AS amount_usd_sum, r.tx_count AS tx_count LIMIT 20"},{"id":"archive_flow_sample","query":"USE archive_topology MATCH (:Identity)-[r:FLOWS_TO]->(:Identity) RETURN r.amount_usd_sum AS amount_usd_sum, r.tx_count AS tx_count LIMIT 20"},{"id":"archive_member_address_sample","query":"USE archive_topology MATCH (i:Identity)-[:HAS_ADDRESS]->(m:Address) RETURN i.identity_id AS identity_id, m.address AS member_address, m.network AS member_network LIMIT 20"}]' \
  > "${SCHEMA_RAW}"

jq --arg network "${NETWORK}" '{
  schema:"chain-insights.runtime_graph_schema.v1",
  network:$network,
  source:"graph_query_batch",
  node_labels:(.facts.queries[]|select(.id=="node_labels")|.results),
  relationship_types:(.facts.queries[]|select(.id=="relationship_types")|.results)
}' "${SCHEMA_RAW}" > "${SCHEMA_FILE}"

log "running graph_query_batch member_address_identity"
cia mcp call graph_query_batch \
  network="${NETWORK}" \
  "queries=[{\"id\":\"member_address_identity\",\"query\":\"USE live_topology MATCH (m:Address {address: \\\"${TARGET_ADDRESS}\\\"})<-[:HAS_ADDRESS]-(i:Identity) RETURN m.address AS address, m.network AS member_network, i.identity_id AS identity_id, i.labels AS labels, i.degree_in AS degree_in, i.degree_out AS degree_out LIMIT 1\"}]" \
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
  query_ids:["member_address_identity"],
  identity_matches:(.facts.queries[]|select(.id=="member_address_identity")|.results)
}' "${RESULT_FILE}" > "${COMPACT_FILE}"

cat > "${REPORT_FILE}" <<EOF
# Member Address Identity UAT

- Network: ${NETWORK}
- Member address: ${TARGET_ADDRESS}
- Source: graph_query_batch
- Compact facts: ${COMPACT_FILE}
- Runtime schema: ${SCHEMA_FILE}
EOF

cat > "${ENTITY_FILE}" <<EOF
# Entity Note

- Member address: ${TARGET_ADDRESS}
- Evidence: ${REPORT_FILE}
- Compact facts: ${COMPACT_FILE}
EOF

if [[ -d cases || -d Evidence ]]; then
  log "workspace scaffold still created legacy case-oriented directories"
  find . -maxdepth 2 | sort >&2
  exit 1
fi

for path in "${SCHEMA_FILE}" "${RESULT_FILE}" "${COMPACT_FILE}" "${REPORT_FILE}" "${ENTITY_FILE}"; do
  if [[ ! -f "${path}" ]]; then
    log "missing expected file: ${path}"
    exit 1
  fi
done

log "PASS"
log "workspace: ${WORKSPACE_ROOT}"
log "result: ${WORKSPACE_ROOT}/${RESULT_FILE}"
log "schema: ${WORKSPACE_ROOT}/${SCHEMA_FILE}"
log "compact: ${WORKSPACE_ROOT}/${COMPACT_FILE}"
