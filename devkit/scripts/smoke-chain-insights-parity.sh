#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"
CHAIN_INSIGHTS_DIR="$REPO_ROOT/repos/infra/chain-insights"
EVIDENCE_DIR="$REPO_ROOT/workspace/devkit-smoke/chain-insights-parity"
WORKSPACE_DIR="$EVIDENCE_DIR/workspace"
HOME_DIR="$EVIDENCE_DIR/home"
export CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT="${CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT:-http://127.0.0.1:18012/mcp}"
export HOME="$HOME_DIR"

mkdir -p "$EVIDENCE_DIR" "$HOME_DIR"
rm -rf "$WORKSPACE_DIR"
mkdir -p "$WORKSPACE_DIR"

CIA_TSX="$CHAIN_INSIGHTS_DIR/node_modules/.bin/tsx"
CIA_SRC="$CHAIN_INSIGHTS_DIR/src/cli.ts"
test -x "$CIA_TSX"
test -f "$CIA_SRC"

cia() {
  "$CIA_TSX" "$CIA_SRC" "$@"
}

cia_in_workspace() {
  (cd "$WORKSPACE_DIR" && "$CIA_TSX" "$CIA_SRC" "$@")
}

FLOWS="$REPO_ROOT/repos/infra/chain-insights/devkit/data/memgraph/flows.csv.gz"
# The first flow edge whose endpoints are both SS58 :Address nodes
# (address-grain revert: flows.csv carries from_address/to_address directly,
# no identity indirection). render-manifest.py / render-memgraph-csv-
# fixtures.py split any fixture over ~40MB into sorted
# flows.csv.gz.part-NNN.gz siblings (GitHub's 50MB/100MB blob limits) and
# remove the plain file when they do; zcat concatenates multiple files
# transparently, and the `$1 ~ /^5/ && $2 ~ /^5/` content filter already
# excludes every part's own repeated header row.
if [ -f "$FLOWS" ]; then
  FLOW_PARTS=("$FLOWS")
else
  FLOW_PARTS=("$FLOWS".part-*.gz)
fi
read -r SEED_ADDRESS PEER_ADDRESS <<<"$(
  zcat "${FLOW_PARTS[@]}" | awk -F, '{ gsub(/\r/, "") } NR > 1 && $1 ~ /^5/ && $2 ~ /^5/ { print $1, $2; exit }'
)"
test -n "$SEED_ADDRESS"
test -n "$PEER_ADDRESS"

cia --version > "$EVIDENCE_DIR/chain-insights-version.txt"
cia mcp networks --json > "$EVIDENCE_DIR/meta-network-capabilities.json"
cia mcp tools --refresh > "$EVIDENCE_DIR/visible-tools.txt"
cia mcp call meta_help > "$EVIDENCE_DIR/meta-help.txt"
cia mcp call meta_network_capabilities > "$EVIDENCE_DIR/meta-network-capabilities-call.json"
cia mcp call meta_usage_status > "$EVIDENCE_DIR/meta-usage-status.json"
if cia mcp call wallet_balance > "$EVIDENCE_DIR/wallet-balance.txt" 2>&1; then
  printf '%s\n' "wallet_balance unexpectedly succeeded in isolated smoke HOME" >&2
  exit 1
fi

cia mcp call graph_query \
  network=bittensor \
  "query=USE topology MATCH (a:Address {address: '${SEED_ADDRESS}'}) RETURN a.address, a.network LIMIT 1" \
  > "$EVIDENCE_DIR/graph-query-topology.json"

cia mcp call graph_query \
  network=bittensor \
  'query=USE topology MATCH (src:Address)-[r:FLOWS_TO]->(dst:Address) RETURN count(r) AS row_count LIMIT 1' \
  > "$EVIDENCE_DIR/graph-query-topology-flows.json"

cia mcp call graph_query \
  network=bittensor \
  "query=USE facts MATCH (a:Address {address: '${SEED_ADDRESS}'})-[:HAS_FEATURE]->(f:AddressFeature) RETURN count(f) AS row_count LIMIT 1" \
  > "$EVIDENCE_DIR/graph-query-facts.json"

# The facts sub-query carries an {address: ...} predicate -- StarRocks-backed
# aggregate graph queries (COUNT/SUM/...) are refused by the cypheradmit
# cost-shape gate unless they carry an indexed predicate (address map/WHERE,
# or a WHERE range on an indexed date/height/timestamp column); see
# devkit/chain-insights-graph-devkit/internal/cypheradmit/cypher.go
# validateGraphQueryCostShape. The topology sub-queries stay predicate-free:
# USE topology runs natively on Memgraph and is exempt from the StarRocks
# cost-shape gate entirely.
cia mcp call graph_query_batch \
  network=bittensor \
  "queries=[{\"id\":\"topology\",\"query\":\"USE topology MATCH (a:Address) RETURN count(a) AS addresses LIMIT 1\"},{\"id\":\"topology-flows\",\"query\":\"USE topology MATCH (:Address)-[r:FLOWS_TO]->(:Address) RETURN count(r) AS flows LIMIT 1\"},{\"id\":\"facts\",\"query\":\"USE facts MATCH (a:Address {address: '${SEED_ADDRESS}'})-[:HAS_FEATURE]->(f:AddressFeature) RETURN count(f) AS features LIMIT 1\"}]" \
  > "$EVIDENCE_DIR/graph-query-batch.json"

cia mcp call aml_address_risk "address=${SEED_ADDRESS}" network=bittensor \
  > "$EVIDENCE_DIR/aml-address-risk.txt"

cia_in_workspace init . > "$EVIDENCE_DIR/workspace-init.txt"
cia_in_workspace mcp call aml_trace_victim_funds "victim_addresses=${SEED_ADDRESS}" network=bittensor max_hops=2 \
  > "$EVIDENCE_DIR/aml-trace-victim-funds.txt"
cia_in_workspace mcp call aml_trace_suspect_funds "suspect_addresses=${SEED_ADDRESS}" network=bittensor max_hops=2 \
  > "$EVIDENCE_DIR/aml-trace-suspect-funds.txt"
cia_in_workspace mcp call aml_trace_deposit_sources "deposit_addresses=${PEER_ADDRESS}" network=bittensor max_hops=2 \
  > "$EVIDENCE_DIR/aml-trace-deposit-sources.txt"

"$SCRIPT_DIR/smoke-memgql-objects.py" > "$EVIDENCE_DIR/memgql-object-coverage.json"

python3 - "$EVIDENCE_DIR" "$SEED_ADDRESS" "$PEER_ADDRESS" <<'PY'
import json
import re
import sys
from pathlib import Path

evidence = Path(sys.argv[1])
seed = sys.argv[2]
peer = sys.argv[3]

def text(name: str) -> str:
    return (evidence / name).read_text(encoding="utf-8")

networks = json.loads(text("meta-network-capabilities.json"))
network = networks["networks"][0]
assert network["network"] == "bittensor"
assert network["layers"]["topology"]["enabled"] is True
assert network["layers"]["facts"]["enabled"] is True
assert network["tools"]["graph_query"] == "available"
assert network["tools"]["graph_query_batch"] == "available"

usage = json.loads(text("meta-usage-status.json"))
# The devkit backend serves the real usage_status tool; older devkit builds
# lacked it and cia fell back to the primitive path. Accept either shape.
assert usage["tool"] in ("meta_usage_status", "usage_status")
assert isinstance(usage["facts"]["usage"], dict) and usage["facts"]["usage"]

required_terms = {
    "visible-tools.txt": ["graph_query", "graph_query_batch"],
    "meta-help.txt": ["aml_*", "graph_query", "graph_query_batch"],
    "wallet-balance.txt": ["Wallet not configured"],
    "graph-query-topology.json": [seed],
    "graph-query-topology-flows.json": ["row_count"],
    "graph-query-facts.json": ["row_count"],
    "graph-query-batch.json": ["chain-insights.result.v1", "facts"],
    "aml-address-risk.txt": ["Risk:", seed],
    "aml-trace-victim-funds.txt": ["Trace victim funds complete", seed],
    "aml-trace-suspect-funds.txt": ["Trace suspect funds complete", seed],
    "aml-trace-deposit-sources.txt": ["Trace deposit sources complete", peer],
}
for filename, terms in required_terms.items():
    content = text(filename)
    for term in terms:
        if term not in content:
            raise SystemExit(f"{filename} missing expected term: {term}")
    if re.search(r"Partial query failures|unknown tool|MCP error|cannot be resolved|x402", content, re.I):
        raise SystemExit(f"{filename} contains failure marker")

coverage = json.loads(text("memgql-object-coverage.json"))
assert coverage["summary"]["failures"] == 0
# Node/relationship totals are derived from the live MemGQL mapping by
# smoke-memgql-objects.py; assert coverage ran, not a pinned mapping shape.
assert coverage["summary"]["nodes"] > 0
assert coverage["summary"]["relationships"] > 0
assert coverage["summary"]["checks"] == coverage["summary"]["nodes"] + coverage["summary"]["relationships"]
for check in coverage["checks"]:
    if not check["ok"]:
        raise SystemExit(f"object coverage failed: {check}")

summary = {
    "schema": "chain-insights.devkit.cia-parity-smoke.v1",
    "network": "bittensor",
    "seed_address": seed,
    "peer_address": peer,
    "tools_checked": [
        "meta_help",
        "meta_network_capabilities",
        "meta_usage_status",
        "wallet_balance",
        "graph_query",
        "graph_query_batch",
        "aml_address_risk",
        "aml_trace_victim_funds",
        "aml_trace_suspect_funds",
        "aml_trace_deposit_sources",
    ],
    "mapping_object_checks": coverage["summary"],
}
(evidence / "summary.json").write_text(json.dumps(summary, indent=2, sort_keys=True), encoding="utf-8")
PY

printf '%s\n' "Chain Insights devkit parity smoke written to workspace/devkit-smoke/chain-insights-parity"
