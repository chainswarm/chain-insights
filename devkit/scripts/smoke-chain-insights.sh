#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"
EVIDENCE_DIR="$REPO_ROOT/workspace/devkit-smoke"
export CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT=http://127.0.0.1:18012/mcp

mkdir -p "$EVIDENCE_DIR"

SEED_ADDRESS="$(
  # repos/infra/chain-insights/devkit/scripts/read-manifest.py uat.seed_address
  python3 "$REPO_ROOT/repos/infra/chain-insights/devkit/scripts/read-manifest.py" uat.seed_address
)"

npm --silent --prefix repos/infra/chain-insights run dev -- mcp networks --json \
  > "$EVIDENCE_DIR/chain-insights-networks.json"

# devkit MCP only serves graph primitive calls; Chain Insights owns this recipe.
npm --silent --prefix repos/infra/chain-insights run dev -- mcp call aml_address_risk "address=${SEED_ADDRESS}" network=bittensor \
  > "$EVIDENCE_DIR/chain-insights-aml-address-risk.txt"

printf '%s\n' "Chain Insights devkit backend smoke written to workspace/devkit-smoke"
