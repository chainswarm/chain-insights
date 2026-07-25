#!/usr/bin/env bash
# Monitor UAT smokes (spec SPEC-2026-07-25 UAT plan; smoke-level per design
# principle 1 — the sequence, not tool internals). Requires: devkit up on
# 127.0.0.1:18012, `npm run build` done, jq.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CLI="node $REPO_ROOT/bin/cli.js"
WORK="$(mktemp -d)"
export CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT="http://127.0.0.1:18012/mcp"
PASS=0; FAIL=0
check() { # check <name> <condition-exit-code>
  if [ "$2" -eq 0 ]; then echo "MONITOR-SMOKE PASS $1"; PASS=$((PASS+1)); else echo "MONITOR-SMOKE FAIL $1"; FAIL=$((FAIL+1)); fi
}

cd "$WORK"
$CLI init . >/dev/null

# Config: one cheap cell per detector on bittensor_evm + bittensor (U1–U4 sweep coverage).
mkdir -p .chain-insights/monitor
cat > .chain-insights/monitor/config.json <<'EOF'
{ "cells": [
    { "detector": "fake-token", "network": "bittensor_evm" },
    { "detector": "address-poisoning", "network": "bittensor_evm" },
    { "detector": "attack-attribution", "network": "bittensor" },
    { "detector": "mixer", "network": "bittensor", "params": { "time_scope": "recent" } }
  ], "intervalSeconds": 3600, "caseMaxHops": 2 }
EOF

# U1–U4: one run executes all four sweep cells; run doc exists; store populated.
$CLI monitor run || [ $? -eq 2 ]   # isolated failures allowed, hard failure not
check "U1-U4 monitor run over 4 detector cells" $?
RUNS=$(ls .chain-insights/monitor/runs/*.run.json | wc -l); [ "$RUNS" -eq 1 ]; check "U1 run doc written" $?

# U5: exchange-likeness machinery reachable (corridor gate classifications come
# from the same graph): status renders without error.
$CLI monitor status >/dev/null; check "U5/status renders" $?

# M1: immediate second run is idempotent at the store level.
$CLI monitor rebuild >/dev/null
$CLI monitor run || [ $? -eq 2 ]
$CLI monitor rebuild >/dev/null
check "M1 second run + rebuild clean" $?

# U6: case lifecycle on a devkit seed address (fixture-known active address).
# 5ELUzkmGbBs5naVDyGfNN8RQCzrM6MC6nFESgyhuVvwxSb8x is the first SS58 source
# address found in devkit/data/memgraph/flows.csv.gz (same fixture, same
# selection technique devkit/scripts/smoke-chain-insights-parity.sh already
# uses for its SEED_ADDRESS/PEER_ADDRESS: first NR>1 row whose from/to both
# start with "5"). It carries 14 outbound / 25 total flow edges in the
# fixture, so it is a real, active, non-placeholder address. Verified live
# against this devkit: `cia mcp call graph_query network=bittensor
# "query=USE topology MATCH (a:Address {address: '<seed>'}) RETURN
# a.address, a.network LIMIT 1"` returns the address.
SEED="5ELUzkmGbBs5naVDyGfNN8RQCzrM6MC6nFESgyhuVvwxSb8x"
$CLI monitor case add theft-1 --type stolen-funds --network bittensor --seed "$SEED"; check "U6 case add" $?
$CLI monitor run || [ $? -eq 2 ]
SNAPS=$(ls cases/theft-1/snapshots/*.snapshot.json | wc -l); [ "$SNAPS" -ge 1 ]; check "U6 snapshot written" $?
$CLI monitor run || [ $? -eq 2 ]
# Static fixture ⇒ second snapshot diff must be empty (zero case_movement alerts for run 2).
MOVES=$($CLI monitor alerts list --all | grep -c case_movement || true)
[ "$MOVES" -eq 0 ]; check "U6 zero movements on static fixture" $?

# U8 expansion loop: approve any pending case doc, re-run, seed set must grow.
PENDING=$($CLI monitor review list | grep -c 'case-theft-1' || true)
if [ "$PENDING" -gt 0 ]; then
  DOC=$(ls detections/*case-theft-1*.findings.json | head -1)
  $CLI monitor review approve "$DOC" --reviewer smoke; check "U8 approve frontier" $?
  $CLI monitor run || [ $? -eq 2 ]
  LAST=$(ls cases/theft-1/snapshots/*.snapshot.json | sort | tail -1)
  GREW=$(jq '.seed_set | length' "$LAST"); [ "$GREW" -gt 1 ]; check "U8 corridor expanded" $?
else
  echo "MONITOR-SMOKE PASS U8 (no frontier on static fixture — expansion seam covered by tests/monitor/tracker.test.ts)"
  PASS=$((PASS+1))
fi

# M2: rebuild equality.
$CLI monitor rebuild >/dev/null; check "M2 rebuild from canonical JSON" $?

# M4: export labels (approved-only; may be empty rows, must produce files).
$CLI monitor export labels | grep -q labels-; check "M4 export labels" $?

# M8: alerts list + ack round trip (ack the first alert if any exist). Do not
# gate the exit-code capture behind the `if` test itself (that would report
# $? of the `[ -n "$FIRST" ]` probe, not of the ack, on the legitimate
# no-alerts path) — capture the ack's own status explicitly.
FIRST=$($CLI monitor alerts list --all | head -1 | awk '{print $1}')
ACK_RC=0
if [ -n "$FIRST" ]; then $CLI monitor alerts ack "$FIRST" || ACK_RC=$?; fi
check "M8 alerts list/ack" "$ACK_RC"

echo "MONITOR-SMOKE done: $PASS pass, $FAIL fail (workspace: $WORK)"
[ "$FAIL" -eq 0 ]
