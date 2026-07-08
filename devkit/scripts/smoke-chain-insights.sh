#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"
EVIDENCE_DIR="$REPO_ROOT/workspace/devkit-smoke"
export CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT=http://127.0.0.1:18012/mcp

mkdir -p "$EVIDENCE_DIR"

FLOWS="$REPO_ROOT/repos/infra/chain-insights/devkit/data/memgraph/flows.csv"
SEED_ADDRESS="$(
  awk -F, '{ gsub(/\r/, "") } NR > 1 && $1 ~ /^5/ { print $1; exit }' "$FLOWS"
)"
test -n "$SEED_ADDRESS"

npm --silent --prefix repos/infra/chain-insights run dev -- mcp networks --json \
  > "$EVIDENCE_DIR/chain-insights-networks.json"

# devkit MCP only serves graph primitive calls; Chain Insights owns this recipe.
npm --silent --prefix repos/infra/chain-insights run dev -- mcp call aml_address_risk "address=${SEED_ADDRESS}" network=bittensor \
  > "$EVIDENCE_DIR/chain-insights-aml-address-risk.txt"

printf '%s\n' "Chain Insights devkit backend smoke written to workspace/devkit-smoke"
