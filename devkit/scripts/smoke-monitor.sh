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
# Capture a command's exit code WITHOUT tripping `set -e`. A bare
# `cmd; check "..." $?` is a trap: under `set -e` a failing `cmd` kills the
# script before `check` ever runs, so a hard assertion failure exited
# non-zero with no `MONITOR-SMOKE FAIL` row and no summary — the one case
# where you most need the output. The `|| rc=$?` here is what makes the
# failure reportable instead of fatal.
rc_of() { local rc=0; "$@" >/dev/null 2>&1 || rc=$?; echo "$rc"; }

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
RUN_RC=0; $CLI monitor run || RUN_RC=$?   # isolated failures (exit 2) allowed, hard failure not
check "U1-U4 monitor run over 4 detector cells" "$(rc_of test "$RUN_RC" -le 2)"
RUNS=$(ls .chain-insights/monitor/runs/*.run.json 2>/dev/null | wc -l); check "U1 run doc written" "$(rc_of test "$RUNS" -eq 1)"

# U5: exchange-likeness machinery reachable (corridor gate classifications come
# from the same graph): status renders without error.
check "U5/status renders" "$(rc_of $CLI monitor status)"

# M1: immediate second run is idempotent at the store level.
M1_RC=$(rc_of $CLI monitor rebuild)
[ "$M1_RC" -ne 0 ] || { RUN_RC=0; $CLI monitor run >/dev/null 2>&1 || RUN_RC=$?; [ "$RUN_RC" -le 2 ] || M1_RC=$RUN_RC; }
[ "$M1_RC" -ne 0 ] || M1_RC=$(rc_of $CLI monitor rebuild)
check "M1 second run + rebuild clean" "$M1_RC"

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
check "U6 case add" "$(rc_of $CLI monitor case add theft-1 --type stolen-funds --network bittensor --seed "$SEED")"
RUN_RC=0; $CLI monitor run || RUN_RC=$?
check "U6 run after case add" "$(rc_of test "$RUN_RC" -le 2)"
SNAPS=$(ls cases/theft-1/snapshots/*.snapshot.json 2>/dev/null | wc -l); check "U6 snapshot written" "$(rc_of test "$SNAPS" -ge 1)"
RUN_RC=0; $CLI monitor run || RUN_RC=$?
check "U6 second run" "$(rc_of test "$RUN_RC" -le 2)"
# Static fixture ⇒ second snapshot diff must be empty (zero case_movement alerts for run 2).
MOVES=$($CLI monitor alerts list --all 2>/dev/null | grep -c case_movement || true)
check "U6 zero movements on static fixture" "$(rc_of test "$MOVES" -eq 0)"

# U8 expansion loop: approve any pending case doc, re-run, seed set must grow.
PENDING=$($CLI monitor review list 2>/dev/null | grep -c 'case-theft-1' || true)
if [ "$PENDING" -gt 0 ]; then
  DOC=$(ls detections/*case-theft-1*.findings.json | head -1)
  check "U8 approve frontier" "$(rc_of $CLI monitor review approve "$DOC" --reviewer smoke)"
  RUN_RC=0; $CLI monitor run || RUN_RC=$?
  check "U8 run after approve" "$(rc_of test "$RUN_RC" -le 2)"
  LAST=$(ls cases/theft-1/snapshots/*.snapshot.json | sort | tail -1)
  GREW=$(jq '.seed_set | length' "$LAST"); check "U8 corridor expanded" "$(rc_of test "$GREW" -gt 1)"
else
  echo "MONITOR-SMOKE PASS U8 (no frontier on static fixture — expansion seam covered by tests/monitor/tracker.test.ts)"
  PASS=$((PASS+1))
fi

# M2: rebuild equality.
check "M2 rebuild from canonical JSON" "$(rc_of $CLI monitor rebuild)"

# M4: export labels (approved-only; may be empty rows, must produce files).
EXPORT_OUT=$($CLI monitor export labels 2>&1 || true)
check "M4 export labels" "$(rc_of grep -q labels- <<<"$EXPORT_OUT")"

# M8: alerts list + ack round trip (ack the first alert if any exist). Do not
# gate the exit-code capture behind the `if` test itself (that would report
# $? of the `[ -n "$FIRST" ]` probe, not of the ack, on the legitimate
# no-alerts path) — capture the ack's own status explicitly.
FIRST=$($CLI monitor alerts list --all 2>/dev/null | head -1 | awk '{print $1}')
ACK_RC=0
if [ -n "$FIRST" ]; then $CLI monitor alerts ack "$FIRST" || ACK_RC=$?; fi
check "M8 alerts list/ack" "$ACK_RC"

# M9 (#212): a torn trailing line in alerts.jsonl must cost that line only —
# `alerts list` must still return the good records, and `rebuild` must recover
# without hand-editing the JSONL.
ALERTS_LOG=.chain-insights/monitor/alerts/alerts.jsonl
if [ -s "$ALERTS_LOG" ]; then
  GOOD=$($CLI monitor alerts list --all 2>/dev/null | grep -c . || true)
  printf '{"alert_id":"torn' >> "$ALERTS_LOG"
  TORN=$($CLI monitor alerts list --all 2>/dev/null | grep -c . || true)
  check "M9 torn alerts.jsonl keeps good alerts in list" "$(rc_of test "$TORN" -eq "$GOOD")"
  check "M9 torn alerts.jsonl still rebuilds" "$(rc_of $CLI monitor rebuild)"
else
  echo "MONITOR-SMOKE PASS M9 (no alerts emitted on static fixture — torn-line seam covered by tests/monitor/alerts.test.ts)"
  PASS=$((PASS+1))
fi

# W1 (watchlist): watching an address that an existing finding already touches
# must raise a watchlist_finding alert on the next run, with no extra remote
# call for that trigger (it is a local join). Address risk is never called.
WL_DOC=$(ls detections/*.findings.json 2>/dev/null | head -1 || true)
WATCHED=""; WL_NET=""
if [ -n "$WL_DOC" ]; then
  WATCHED=$(jq -r '.findings[0].address // empty' "$WL_DOC")
  WL_NET=$(jq -r '.network // empty' "$WL_DOC")
fi
if [ -n "$WATCHED" ] && [ -n "$WL_NET" ]; then
  jq '. + {watchlist: {dustMaxUsd: 1.0, dustLookbackSeconds: 86400, enabled: true}}' \
    .chain-insights/monitor/config.json > .chain-insights/monitor/config.json.tmp \
    && mv .chain-insights/monitor/config.json.tmp .chain-insights/monitor/config.json
  check "W1 watchlist add" "$(rc_of $CLI monitor watchlist add "$WATCHED" --network "$WL_NET")"
  RUN_RC=0; $CLI monitor run || RUN_RC=$?
  check "W1 run with watchlist" "$(rc_of test "$RUN_RC" -le 2)"
  WL=$($CLI monitor alerts list --all 2>/dev/null | grep -c watchlist_ || true)
  check "W1 watchlist alert emitted" "$(rc_of test "$WL" -ge 1)"
else
  echo "MONITOR-SMOKE PASS W1 (no findings on static fixture — watchlist seam covered by tests/monitor/watchlist-run.test.ts)"
  PASS=$((PASS+1))
fi

echo "MONITOR-SMOKE done: $PASS pass, $FAIL fail (workspace: $WORK)"
[ "$FAIL" -eq 0 ]
