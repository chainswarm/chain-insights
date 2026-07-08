#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"
EVIDENCE_DIR="$REPO_ROOT/workspace/devkit-smoke"
export CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT=http://127.0.0.1:18012/mcp

mkdir -p "$EVIDENCE_DIR"

FLOWS="$REPO_ROOT/repos/infra/chain-insights/devkit/data/memgraph/flows.csv.gz"
# render-manifest.py / render-memgraph-csv-fixtures.py split any fixture
# over ~40MB into sorted flows.csv.gz.part-NNN.gz siblings (GitHub's
# 50MB/100MB blob limits; address-grain edge-count growth made this
# routine) and remove the plain file when they do. zcat concatenates
# multiple files transparently; the `$1 ~ /^5/` content filter already
# excludes every part's own repeated header row (its from_address field
# is the literal string "from_address", never starting with "5").
if [ -f "$FLOWS" ]; then
  FLOW_PARTS=("$FLOWS")
else
  FLOW_PARTS=("$FLOWS".part-*.gz)
fi
SEED_ADDRESS="$(
  zcat "${FLOW_PARTS[@]}" | awk -F, '{ gsub(/\r/, "") } NR > 1 && $1 ~ /^5/ { print $1; exit }'
)"
test -n "$SEED_ADDRESS"

npm --silent --prefix repos/infra/chain-insights run dev -- mcp networks --json \
  > "$EVIDENCE_DIR/chain-insights-networks.json"

# devkit MCP only serves graph primitive calls; Chain Insights owns this recipe.
npm --silent --prefix repos/infra/chain-insights run dev -- mcp call aml_address_risk "address=${SEED_ADDRESS}" network=bittensor \
  > "$EVIDENCE_DIR/chain-insights-aml-address-risk.txt"

printf '%s\n' "Chain Insights devkit backend smoke written to workspace/devkit-smoke"
