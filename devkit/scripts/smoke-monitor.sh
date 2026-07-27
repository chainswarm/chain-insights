#!/usr/bin/env bash
# Monitor UAT smokes: the spec's UAT plan U1-U8 / M1-M8, the W1 watchlist seam,
# and regression cases for chain-insights#225 (full-state re-emission) and
# chain-insights#228 (network scoping).
#
# Requires: devkit up on 127.0.0.1:18012, `npm run build` done, jq.
#
# ------------------------------------------------------------------------
# WHY THIS SCRIPT ASSERTS PAYLOADS, NOT EXIT CODES (chain-insights#231)
# ------------------------------------------------------------------------
# The previous revision collapsed U1-U4 into ONE row:
#
#     check "U1-U4 monitor run over 4 detector cells" "$(rc_of test "$RUN_RC" -le 2)"
#
# `-le 2` is satisfied whether a cell found everything or nothing, and exit 2
# is the ISOLATED-FAILURE code, so a cell that threw on every single run still
# passed. Two of those four cells were in fact permanently broken against the
# devkit ("unsupported network bittensor_evm") and the row stayed green.
# That is the same failure class as chain-insights#225, where three detectors
# accepted the scan window, discarded it, and re-emitted ~2,000 identical
# findings an hour while the checkpoint advanced and made it look incremental.
#
# So: every scenario below reads the RUN DOCUMENT, the FINDINGS DOCUMENT, the
# REVIEW QUEUE, or the ALERT STREAM and asserts on their contents. A scenario
# that cannot assert anything meaningful on this fixture calls `skip` and says
# why, naming the blocker. It never silently passes.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CLI="node $REPO_ROOT/bin/cli.js"
export CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT="${CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT:-http://127.0.0.1:18012/mcp}"
PASS=0; FAIL=0; SKIP=0

pass() { echo "MONITOR-SMOKE PASS $1"; PASS=$((PASS+1)); }
fail() { echo "MONITOR-SMOKE FAIL $1 -- $2"; FAIL=$((FAIL+1)); }
# A deferred scenario is LOUD: it prints, it is counted in its own column, and
# it names the blocker. "Absent" and "deferred" must never look the same here.
skip() { echo "MONITOR-SMOKE SKIP $1 -- $2"; SKIP=$((SKIP+1)); }

# check <name> <condition-exit-code>
check() { if [ "$2" -eq 0 ]; then pass "$1"; else fail "$1" "condition failed"; fi; }
# assert_eq <name> <actual> <expected>
assert_eq() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "got '$2', want '$3'"; fi; }
# assert_ge <name> <actual> <floor>
assert_ge() { if [ "${2:-x}" -ge "$3" ] 2>/dev/null; then pass "$1"; else fail "$1" "got '$2', want >= $3"; fi; }
# assert_contains <name> <haystack> <needle>
assert_contains() { case "$2" in *"$3"*) pass "$1";; *) fail "$1" "'$3' not found in: $2";; esac; }

# Capture a command's exit code WITHOUT tripping `set -e`. A bare
# `cmd; check "..." $?` is a trap: under `set -e` a failing `cmd` kills the
# script before `check` ever runs, so a hard assertion failure exited
# non-zero with no `MONITOR-SMOKE FAIL` row and no summary -- the one case
# where you most need the output.
rc_of() { local rc=0; "$@" >/dev/null 2>&1 || rc=$?; echo "$rc"; }

# Newest run document in a workspace, plus readers over run/findings payloads.
newest_run() { ls "$1"/.chain-insights/monitor/runs/*.run.json 2>/dev/null | sort | tail -1; }
# cell_field <run.json> <cell-name> <field> -> value, or empty when absent
cell_field() { jq -r --arg c "$2" --arg f "$3" '(.cells[] | select(.cell == $c) | .[$f]) // "" | tostring' "$1"; }
# findings_doc <workspace> <detector> <network> -> newest matching document
findings_doc() { ls "$1"/detections/*-"$2"-"$3".findings.json 2>/dev/null | sort | tail -1; }

WORKSPACES=()
new_workspace() { local w; w="$(mktemp -d)"; ( cd "$w" && $CLI init . >/dev/null ); mkdir -p "$w/.chain-insights/monitor"; WORKSPACES+=("$w"); echo "$w"; }
write_config() { cat > "$1/.chain-insights/monitor/config.json"; }

########################################################################
# Fixture capability probe.
#
# The devkit fixture is a checksum-pinned REAL export: devkit/data/manifest.json
# is validated by validate-manifest.py, which fails the import outright on
# synthetic placeholder markers, by design. A detector whose input table is not
# in that export therefore cannot be handed a hand-authored known-answer case
# here -- it is PROBED, and skipped loudly if its input is genuinely absent.
# The probe is what makes the skip self-healing: the moment the export lands,
# the same row starts asserting for real with no edit to this script.
########################################################################
ASSET_ROWS=$($CLI mcp call graph_query network=bittensor \
  'query=USE facts MATCH (t:Asset) RETURN t.asset_contract AS c LIMIT 1' 2>/dev/null \
  | jq -r '.facts.query.results | length' 2>/dev/null || echo 0)

########################################################################
# PHASE A -- the detector sweep (U1, U2, U4, U5), then U3 / #225 over reruns.
#
# All four cells run on `bittensor`, the network the devkit fixture carries end
# to end. address-poisoning is given an explicit scan_window_days: its default
# is a trailing 2-day window relative to NOW, and the fixture's transfers are a
# fixed historical slice, so the default window is permanently empty. The old
# smoke never set it -- its "U2" could not have observed a finding in principle.
########################################################################
WS_A="$(new_workspace)"
write_config "$WS_A" <<'EOF'
{ "cells": [
    { "detector": "fake-token", "network": "bittensor" },
    { "detector": "address-poisoning", "network": "bittensor", "params": { "scan_window_days": "3650" } },
    { "detector": "attack-attribution", "network": "bittensor" },
    { "detector": "mixer", "network": "bittensor", "params": { "time_scope": "recent" } }
  ], "intervalSeconds": 3600, "caseMaxHops": 2 }
EOF

cd "$WS_A"
RUN1_RC=0; $CLI monitor run >/dev/null 2>&1 || RUN1_RC=$?
assert_eq "A/run 1 completes with no isolated cell failure" "$RUN1_RC" "0"
RUN1="$(newest_run "$WS_A")"
check "A/run 1 wrote a run document" "$(rc_of test -n "$RUN1")"
assert_eq "A/run 1 executed all four configured cells" "$(jq '.cells | length' "$RUN1")" "4"

# ---- U1: fake-token cell -> finding ingested, alert emitted ----------------
if [ "$ASSET_ROWS" -eq 0 ]; then
  # Proven, not assumed: the probe above asked the graph and got zero rows.
  skip "U1 fake-token known-answer" \
    "the devkit facts Asset registry is empty (mapped but unexported -- see ALLOWED_UNEXPORTED_TABLES in devkit/scripts/validate-manifest.py, chain-insights#210). The asset registry is this detector's ONLY input, so no spoof case can exist on this fixture. Unit coverage: tests/detection/fake-token.test.ts (findSpoofs known-answer)"
  # What CAN be asserted is that the cell ran and did not fail. That is a
  # strictly weaker claim, and it is labelled as such rather than sold as U1.
  assert_eq "U1 fake-token cell ran without error" "$(cell_field "$RUN1" 'fake-token:bittensor' error)" ""
  assert_eq "U1 fake-token cell reports an empty-registry count" "$(cell_field "$RUN1" 'fake-token:bittensor' findings_count)" "0"
else
  FT_COUNT="$(cell_field "$RUN1" 'fake-token:bittensor' findings_count)"
  assert_ge "U1 fake-token finding ingested" "$FT_COUNT" 1
  FT_DOC="$(findings_doc "$WS_A" fake-token bittensor)"
  assert_eq "U1 fake-token finding is a spoof classification" \
    "$(jq -r '[.findings[].classification] | unique | join(",")' "$FT_DOC")" "fake_token_contract"
  assert_eq "U1 fake-token finding names the impersonated verified contract" \
    "$(jq -r '[.findings[] | select((.evidence.spoofed_verified_contract // "") == "")] | length' "$FT_DOC")" "0"
  assert_ge "U1 fake-token alert emitted" \
    "$($CLI monitor alerts list --all 2>/dev/null | grep -c 'new_findings bittensor fake-token' || true)" 1
fi

# ---- U2: poisoning cell on the dust+lookalike fixture ----------------------
AP_COUNT="$(cell_field "$RUN1" 'address-poisoning:bittensor' findings_count)"
assert_ge "U2 poisoning finding ingested" "$AP_COUNT" 1
AP_DOC="$(findings_doc "$WS_A" address-poisoning bittensor)"
assert_eq "U2 poisoning findings all carry the duster classification" \
  "$(jq -r '[.findings[].classification] | unique | join(",")' "$AP_DOC")" "poisoning_duster"
assert_eq "U2 poisoning findings all carry the vanity-lookalike gate" \
  "$(jq -r '[.findings[].gate] | unique | join(",")' "$AP_DOC")" "vanity_lookalike_dust"
# The whole point of the detector: each duster impersonates one of the VICTIM'S
# OWN real prior counterparties. A finding without that pointer is not a
# poisoning finding, it is just a small transfer.
assert_eq "U2 every poisoning finding names its victim and the impersonated counterparty" \
  "$(jq -r '[.findings[] | select(((.evidence.impersonated_counterparty // "") == "") or ((.evidence.victim // "") == ""))] | length' "$AP_DOC")" "0"
assert_ge "U2 poisoning alert emitted" \
  "$($CLI monitor alerts list --all 2>/dev/null | grep -c 'new_findings bittensor address-poisoning' || true)" 1

# ---- U4: mixer cell, hourglass fixture -------------------------------------
MX_COUNT="$(cell_field "$RUN1" 'mixer:bittensor' findings_count)"
assert_ge "U4 mixer candidate found" "$MX_COUNT" 1
MX_DOC="$(findings_doc "$WS_A" mixer bittensor)"
assert_eq "U4 mixer findings are hourglass candidates" \
  "$(jq -r '[.findings[].gate] | unique | join(",")' "$MX_DOC")" "hourglass_in_out"
# Protocol sinks (0x0, 0x..dead) must never be minted as mixers. Asserted on
# the EMITTED set, not on the classifier's source.
assert_eq "U4 protocol sinks excluded from mixer candidates" \
  "$(jq -r '[.findings[] | select((.address | ascii_downcase) == "0x0000000000000000000000000000000000000000" or (.address | ascii_downcase) == "0x000000000000000000000000000000000000dead")] | length' "$MX_DOC")" "0"
# "candidate in review queue": the findings doc is PENDING and unreviewed, and
# the queue reports the same count the run doc did. This is the gate that keeps
# a machine finding from becoming a label.
MX_QUEUE_COUNT="$($CLI monitor review list 2>/dev/null | awk -F'\t' -v d="$MX_DOC" '$1 == d {print $4}')"
assert_eq "U4 mixer candidates land in the review queue with the run's count" "$MX_QUEUE_COUNT" "$MX_COUNT"
assert_eq "U4 queued mixer doc carries no reviewer (import gate stays shut)" \
  "$(jq -r 'has("reviewer")' "$MX_DOC")" "false"

# ---- U5: exchange-likeness machinery reachable -----------------------------
STATUS_TEXT="$($CLI monitor status 2>&1)"
check "U5/status renders" "$(rc_of test -n "$STATUS_TEXT")"
assert_contains "U5/status reports the configured cell count" "$STATUS_TEXT" "cells: 4"
# The queue the exchange-likeness/corridor gate feeds. Three, not four: the
# review queue lists only documents that have something to review, and the
# fake-token cell wrote an empty document (its registry is unexported, see U1).
assert_contains "U5/status queues only the cells that found something" "$STATUS_TEXT" "pending reviews: 3"

# ---- U3 + #225: the second run scans only the new window -------------------
# The scenario the spec named and the old smoke never implemented -- and
# exactly the defect that shipped as #225. It has two halves, because after the
# #225 fix the detectors declare two honest window modes:
#
#   incremental (address-poisoning): bounds its own queries by the window, so
#     the checkpoint is real. The second run scans (run1, run2] -- a window with
#     no fixture data in it -- and therefore reports nothing.
#
#   full-state (attack-attribution, fake-token, mixer): classifies from current
#     cumulative graph state, which carries no usable event timestamp. It keeps
#     scanning in full every run (correctness), advances NO checkpoint (there is
#     nothing to advance honestly), and emits only findings not already emitted.
#
# The #225 shape was a full-state detector wearing incremental clothes: it
# advanced a checkpoint nothing read while re-emitting its whole result set
# every hour. Both halves below fail if that behavior returns.
sleep 1
RUN2_RC=0; $CLI monitor run >/dev/null 2>&1 || RUN2_RC=$?
assert_eq "U3/run 2 completes with no isolated cell failure" "$RUN2_RC" "0"
RUN2="$(newest_run "$WS_A")"
check "U3/run 2 wrote a second run document" "$(rc_of test "$RUN2" != "$RUN1")"

CP="$WS_A/.chain-insights/detectors/address-poisoning.bittensor.checkpoint.json"
check "U3 incremental detector wrote a checkpoint" "$(rc_of test -f "$CP")"
RUN1_MS="$(jq -r '.run_ms' "$RUN1")"
RUN2_MS="$(jq -r '.run_ms' "$RUN2")"
assert_eq "U3 checkpoint advanced to run 2's watermark" "$(jq -r '.last_block_timestamp_ms' "$CP")" "$RUN2_MS"
check "U3 checkpoint moved forward between runs" "$(rc_of test "$RUN2_MS" -gt "$RUN1_MS")"
# The observable consequence of scanning only (run1, run2]: nothing new.
assert_eq "U3 incremental second run reports nothing for the new window" \
  "$(cell_field "$RUN2" 'address-poisoning:bittensor' findings_count)" "0"

# #225 half: full-state detector, unchanged data.
assert_eq "U3/#225 full-state second run emits nothing new" \
  "$(cell_field "$RUN2" 'attack-attribution:bittensor' findings_count)" "0"
AA_DOC2="$(findings_doc "$WS_A" attack-attribution bittensor)"
# ... and it must still have SCANNED. A detector that stopped scanning would
# also report 0; the suppression warning distinguishes "scanned, nothing new"
# from "did not look".
assert_contains "U3/#225 full-state run 2 still scanned (suppression recorded)" \
  "$(jq -r '(.warnings // []) | join(" ")' "$AA_DOC2")" "already emitted"
assert_eq "U3/#225 full-state detector advances no checkpoint it never reads" \
  "$(rc_of test -f "$WS_A/.chain-insights/detectors/attack-attribution.bittensor.checkpoint.json")" "1"

# Third run: still zero. Two runs could be an ordering fluke; three is the
# steady state the #225 flood violated.
sleep 1
$CLI monitor run >/dev/null 2>&1 || true
RUN3="$(newest_run "$WS_A")"
assert_eq "#225 third run over unchanged data still emits nothing" \
  "$(cell_field "$RUN3" 'attack-attribution:bittensor' findings_count)" "0"
AA_RUN1_COUNT="$(cell_field "$RUN1" 'attack-attribution:bittensor' findings_count)"
assert_ge "#225 the first run DID emit (suppression is not a mute button)" "$AA_RUN1_COUNT" 1

# --full is the documented escape hatch: it must rebuild the whole backlog.
FULL_COUNT="$($CLI detect attack-attribution --network bittensor --full 2>&1 | sed -nE 's/.*: ([0-9]+) finding\(s\).*/\1/p' | tail -1)"
assert_eq "#225 --full re-emits the whole finding set" "$FULL_COUNT" "$AA_RUN1_COUNT"

########################################################################
# PHASE B -- #228 network scoping regression.
#
# Several network names share ONE address-grain topology graph; `network`
# selects the GRAPH, not the address subset inside it. Before #228 every
# `USE topology` MATCH on `:Address` lacked an `Address.network` predicate, so
# both views returned the same wrong-network rows. Nothing pinned it.
#
# Known answer on this fixture: mixer/bittensor yields SS58 addresses only,
# mixer/bittensor_evm yields 0x addresses only, and the two sets are disjoint.
########################################################################
WS_B="$(new_workspace)"
cd "$WS_B"
$CLI detect mixer --network bittensor >/dev/null 2>&1 || true
$CLI detect mixer --network bittensor_evm >/dev/null 2>&1 || true
B_SS58="$(findings_doc "$WS_B" mixer bittensor)"
B_EVM="$(findings_doc "$WS_B" mixer bittensor_evm)"
if [ -z "$B_SS58" ] || [ -z "$B_EVM" ]; then
  fail "#228 network scoping" "one or both findings documents were not written (ss58='$B_SS58' evm='$B_EVM')"
else
  assert_ge "#228 SS58 view returns findings" "$(jq '.findings | length' "$B_SS58")" 1
  assert_ge "#228 EVM view returns findings" "$(jq '.findings | length' "$B_EVM")" 1
  assert_eq "#228 SS58 view returns ONLY SS58 addresses" \
    "$(jq -r '[.findings[] | select(.address | startswith("5") | not)] | length' "$B_SS58")" "0"
  assert_eq "#228 EVM view returns ONLY 0x addresses" \
    "$(jq -r '[.findings[] | select(.address | startswith("0x") | not)] | length' "$B_EVM")" "0"
  # The strongest form: the two views cannot overlap at all. An unscoped query
  # would make these two sets identical.
  OVERLAP="$(jq -s -r '[.[0].findings[].address] as $a | [.[1].findings[].address] | map(select(. as $x | $a | index($x))) | length' "$B_SS58" "$B_EVM")"
  assert_eq "#228 the two views share no addresses" "$OVERLAP" "0"
  assert_eq "#228 the two documents record different network provenance" \
    "$(jq -s -r 'if .[0].network == .[1].network then "same" else "different" end' "$B_SS58" "$B_EVM")" "different"
fi

########################################################################
# PHASE C -- M7: a forced detector failure is isolated, the run completes.
########################################################################
WS_C="$(new_workspace)"
write_config "$WS_C" <<'EOF'
{ "cells": [
    { "detector": "mixer", "network": "bittensor", "params": { "time_scope": "recent" } },
    { "detector": "no-such-detector", "network": "bittensor" }
  ], "intervalSeconds": 3600, "caseMaxHops": 2 }
EOF
cd "$WS_C"
M7_RC=0; $CLI monitor run >/dev/null 2>&1 || M7_RC=$?
assert_eq "M7 forced detector failure exits with the isolated-failure code" "$M7_RC" "2"
RUN_C="$(newest_run "$WS_C")"
check "M7 the run still wrote its run document" "$(rc_of test -n "$RUN_C")"
assert_eq "M7 the failing cell recorded an error" \
  "$(rc_of test -n "$(cell_field "$RUN_C" 'no-such-detector:bittensor' error)")" "0"
# Isolation is the whole claim: the healthy cell must have completed normally.
assert_eq "M7 the healthy sibling cell recorded no error" "$(cell_field "$RUN_C" 'mixer:bittensor' error)" ""
assert_ge "M7 the healthy sibling cell still produced findings" "$(cell_field "$RUN_C" 'mixer:bittensor' findings_count)" 1

########################################################################
# PHASE D -- U6 / U7 / U8 case lifecycle, then M3 import gate (on WS_A).
########################################################################
cd "$WS_A"
# 5ELUzkmGbBs5naVDyGfNN8RQCzrM6MC6nFESgyhuVvwxSb8x is the first SS58 source
# address in the devkit flows fixture (the same selection technique
# devkit/scripts/smoke-chain-insights-parity.sh uses for its SEED_ADDRESS):
# 14 outbound / 25 total flow edges -- a real, active, non-placeholder address.
SEED="5ELUzkmGbBs5naVDyGfNN8RQCzrM6MC6nFESgyhuVvwxSb8x"
check "U6 case add" "$(rc_of $CLI monitor case add theft-1 --type stolen-funds --network bittensor --seed "$SEED")"
sleep 1
$CLI monitor run >/dev/null 2>&1 || true
SNAP1="$(ls "$WS_A"/cases/theft-1/snapshots/*.snapshot.json 2>/dev/null | sort | tail -1 || true)"
check "U6 baseline snapshot written" "$(rc_of test -n "$SNAP1")"
assert_contains "U6 the baseline snapshot seeds the case with its seed address" \
  "$(jq -r '.seed_set | join(",")' "$SNAP1")" "$SEED"
RUN_D1="$(newest_run "$WS_A")"
assert_eq "U6 baseline case cell emits no movements" "$(cell_field "$RUN_D1" "case:theft-1" movements_count)" "0"
sleep 1
$CLI monitor run >/dev/null 2>&1 || true
RUN_D2="$(newest_run "$WS_A")"
assert_ge "U6 a second snapshot was taken" "$(ls "$WS_A"/cases/theft-1/snapshots/*.snapshot.json | wc -l)" 2
# Static fixture => the run-over-run diff is empty, and no case_movement alert
# may be invented from it.
assert_eq "U6 second run over the static fixture yields zero movements" \
  "$(cell_field "$RUN_D2" "case:theft-1" movements_count)" "0"
assert_eq "U6 zero case_movement alerts on the static fixture" \
  "$($CLI monitor alerts list --all 2>/dev/null | grep -c ' case_movement ' || true)" "0"

# ---- U7: synthetic moved-funds snapshot pair -------------------------------
# The spec marks U7 (unit), and the unit coverage EXISTS -- checked before
# writing this row, not assumed:
#   tests/monitor/tracker.test.ts
#     "yields the exact expected movement set for a moved-funds pair"
#       -> exact new_hop / cashout_endpoint / new_deposit_endpoint /
#          frontier_candidate sets over a synthetic snapshot pair
#     "a moved-funds snapshot pair emits the cashout alert, not just the
#      movement (U7)" -> the cashout ALERT, with its address, reaches the
#      alert stream
# It cannot be re-derived here: the devkit fixture is static, so no real case
# ever moves funds between two runs -- which is precisely what U6 above asserts.
skip "U7 synthetic moved-funds snapshot pair" \
  "spec-marked (unit); covered by tests/monitor/tracker.test.ts -- exact movement set incl. cashout, plus the cashout_endpoint alert. A static fixture cannot produce a real movement pair (see U6)"

# ---- U8: approve frontier -> re-run -> corridor expands ---------------------
PENDING_CASE_DOC="$(ls "$WS_A"/detections/*case-theft-1*.findings.json 2>/dev/null | head -1 || true)"
if [ -n "$PENDING_CASE_DOC" ]; then
  check "U8 approve frontier" "$(rc_of $CLI monitor review approve "$PENDING_CASE_DOC" --reviewer smoke)"
  sleep 1
  $CLI monitor run >/dev/null 2>&1 || true
  LAST_SNAP="$(ls "$WS_A"/cases/theft-1/snapshots/*.snapshot.json | sort | tail -1)"
  assert_ge "U8 the approved candidate expanded the corridor seed set" \
    "$(jq '.seed_set | length' "$LAST_SNAP")" 2
  assert_eq "U8 the approved address is now a case seed" \
    "$(jq -r --arg a "$(jq -r '.findings[0].address' "$PENDING_CASE_DOC")" '[.seed_set[] | select(. == $a)] | length' "$LAST_SNAP")" "1"
else
  skip "U8 corridor expansion" \
    "the seed's corridor produced no frontier candidate on this fixture (no propagated_scam / corridor_hub hop), and a labelled scam hub -- the seed that would produce one -- traverses for minutes on this fixture, which is not smoke-sized. Seam covered by tests/monitor/tracker.test.ts 'traceCase expansion seam (AC-13 approve -> re-trace)'"
fi

# ---- M3: the curated-import gate ------------------------------------------
# The importer itself is not part of this repository, so what is assertable
# here is the CONTRACT it reads: an approved doc carries a reviewer identity
# and identical findings; its unreviewed sibling carries no reviewer and is
# therefore refused. U8's `approve` above only proved the command exits 0 --
# it never looked at what the gate would read.
# The OLDEST mixer doc, i.e. the one run 1 wrote with findings in it. Runs 2
# and 3 wrote empty docs (full-state suppression, asserted above) -- approving
# one of those would export zero label rows and make M4 below vacuous.
M3_DOC="$(ls "$WS_A"/detections/*-mixer-bittensor.findings.json 2>/dev/null | sort | head -1 || true)"
check "M3 an unreviewed sibling doc exists" "$(rc_of test -n "$M3_DOC")"
assert_ge "M3 the doc under review actually carries findings" "$(jq '.findings | length' "$M3_DOC")" 1
assert_eq "M3 unreviewed doc carries NO reviewer -> the gate refuses it" \
  "$(jq -r 'has("reviewer")' "$M3_DOC")" "false"
M3_COPY="$($CLI monitor review approve "$M3_DOC" --reviewer smoke-m3 2>&1 | sed -nE 's/^Approved\. Reviewed copy: //p')"
check "M3 approve produced a reviewed copy" "$(rc_of test -f "$M3_COPY")"
assert_eq "M3 approved doc carries the reviewer -> the gate accepts it" \
  "$(jq -r '.reviewer' "$M3_COPY")" "smoke-m3"
# The gate keys on the findings, so the approved copy must be the SAME findings:
# an approval that silently dropped or rewrote rows would import wrong labels.
assert_eq "M3 approved copy preserves the findings verbatim" \
  "$(jq -S -c '.findings' "$M3_DOC" | sha256sum | cut -d' ' -f1)" \
  "$(jq -S -c '.findings' "$M3_COPY" | sha256sum | cut -d' ' -f1)"
assert_eq "M3 the approved doc leaves the pending review queue" \
  "$($CLI monitor review list 2>/dev/null | grep -cF "$M3_DOC	" || true)" "0"

########################################################################
# PHASE E -- M1, M2, M4, M8, M9 store/alert mechanics (WS_A).
########################################################################
# M1: an immediate second run is idempotent at the store level.
M1_RC="$(rc_of $CLI monitor rebuild)"
[ "$M1_RC" -ne 0 ] || { RC=0; $CLI monitor run >/dev/null 2>&1 || RC=$?; [ "$RC" -le 2 ] || M1_RC=$RC; }
[ "$M1_RC" -ne 0 ] || M1_RC="$(rc_of $CLI monitor rebuild)"
check "M1 second run + rebuild clean" "$M1_RC"
# "no duplicate rows": alert ids are unique across every run so far.
ALERT_IDS="$($CLI monitor alerts list --all 2>/dev/null | awk '{print $1}' | sort)"
assert_eq "M1 no duplicate alert ids across runs" \
  "$(grep -c . <<<"$ALERT_IDS")" "$(sort -u <<<"$ALERT_IDS" | grep -c .)"

# M2: rebuild reproduces identical contents including alerts/acks.
BEFORE_REBUILD="$($CLI monitor alerts list --all 2>/dev/null | sort | sha256sum)"
check "M2 rebuild from canonical JSON" "$(rc_of $CLI monitor rebuild)"
assert_eq "M2 rebuild reproduces the alert stream identically" \
  "$BEFORE_REBUILD" "$($CLI monitor alerts list --all 2>/dev/null | sort | sha256sum)"

# M4: export labels -- approved-only.
EXPORT_OUT="$($CLI monitor export labels 2>&1 || true)"
assert_contains "M4 export labels writes JSON" "$EXPORT_OUT" ".json"
assert_contains "M4 export labels writes CSV" "$EXPORT_OUT" ".csv"
M4_JSON="$(sed -nE 's/^JSON: //p' <<<"$EXPORT_OUT")"
if [ -n "$M4_JSON" ] && [ -f "$M4_JSON" ]; then
  # Approved-only is the security property: rows from the doc approved above,
  # and nothing from any still-pending doc.
  assert_ge "M4 export contains the approved rows" "$(jq '. | length' "$M4_JSON")" 1
  assert_eq "M4 export is approved-only (every row carries a reviewer)" \
    "$(jq -r '[.[] | select((.reviewer // "") == "")] | length' "$M4_JSON")" "0"
else
  fail "M4 export labels" "no JSON path in output: $EXPORT_OUT"
fi

# M8: alerts list + ack round trip. Capture the ack's OWN status -- gating the
# capture behind an `if` would report the probe's exit code on the empty path.
FIRST="$($CLI monitor alerts list --all 2>/dev/null | head -1 | awk '{print $1}')"
if [ -n "$FIRST" ]; then
  ACK_RC=0; $CLI monitor alerts ack "$FIRST" >/dev/null 2>&1 || ACK_RC=$?
  assert_eq "M8 alert ack succeeds" "$ACK_RC" "0"
  assert_eq "M8 the acked alert leaves the unacked list" \
    "$($CLI monitor alerts list 2>/dev/null | grep -c "^$FIRST " || true)" "0"
  assert_eq "M8 the acked alert remains in the full list" \
    "$($CLI monitor alerts list --all 2>/dev/null | grep -c "^$FIRST " || true)" "1"
else
  fail "M8 alerts list/ack" "no alerts were emitted, so the ack round trip could not be exercised"
fi

# M9 (#212): a torn trailing line in alerts.jsonl costs that line only.
ALERTS_LOG="$WS_A/.chain-insights/monitor/alerts/alerts.jsonl"
if [ -s "$ALERTS_LOG" ]; then
  GOOD="$($CLI monitor alerts list --all 2>/dev/null | grep -c . || true)"
  printf '{"alert_id":"torn' >> "$ALERTS_LOG"
  assert_eq "M9 torn alerts.jsonl keeps every good alert in the list" \
    "$($CLI monitor alerts list --all 2>/dev/null | grep -c . || true)" "$GOOD"
  check "M9 torn alerts.jsonl still rebuilds" "$(rc_of $CLI monitor rebuild)"
else
  fail "M9 torn alerts.jsonl" "no alerts log to tear"
fi

########################################################################
# PHASE F -- M5: usage guard on real quota. DEFERRED, LOUDLY.
########################################################################
# `stopIfRemainingBelow` reads the backend's remaining quota. The devkit MCP is
# deliberately unmetered -- no billing, metering, or usage-reporting surface --
# so its usage_status carries no quota fields at all. A guard test here would
# either assert nothing or need a faked quota, which proves nothing about the
# real halt path. The metered endpoint is chain-insights#215.
skip "M5 stopIfRemainingBelow clean halt" \
  "requires a metered usage_status endpoint (chain-insights#215); the devkit MCP is unmetered by design. Halt-path unit coverage: tests/monitor/runner.test.ts (usage guard reads facts.usage.remaining_seconds and records the halt reason)"

########################################################################
# PHASE G -- M6: `watch` kill/restart resumes, with no loss and no duplicates.
########################################################################
WS_G="$(new_workspace)"
write_config "$WS_G" <<'EOF'
{ "cells": [ { "detector": "mixer", "network": "bittensor", "params": { "time_scope": "recent" } } ],
  "intervalSeconds": 3600, "caseMaxHops": 2 }
EOF
cd "$WS_G"
# `watch` runs once immediately, then sleeps the interval -- so one pass, a
# hard kill mid-sleep, and a restart is a complete resume cycle with no waiting.
$CLI monitor watch --interval 3600 >/dev/null 2>&1 &
WATCH_PID=$!
for _ in $(seq 1 90); do [ -n "$(newest_run "$WS_G")" ] && break; sleep 1; done
G_RUN1="$(newest_run "$WS_G")"
check "M6 watch produced a first run before the kill" "$(rc_of test -n "$G_RUN1")"
G_ALERTS1="$($CLI monitor alerts list --all 2>/dev/null | awk '{print $1}' | sort)"
kill -9 "$WATCH_PID" 2>/dev/null || true
wait "$WATCH_PID" 2>/dev/null || true
assert_eq "M6 the watch daemon is gone" "$(rc_of kill -0 "$WATCH_PID")" "1"

sleep 1
$CLI monitor watch --interval 3600 >/dev/null 2>&1 &
WATCH_PID2=$!
for _ in $(seq 1 90); do [ "$(newest_run "$WS_G")" != "$G_RUN1" ] && break; sleep 1; done
G_RUN2="$(newest_run "$WS_G")"
kill -9 "$WATCH_PID2" 2>/dev/null || true
wait "$WATCH_PID2" 2>/dev/null || true
check "M6 watch resumed after the kill and produced a new run" "$(rc_of test "$G_RUN2" != "$G_RUN1")"
# No loss: the pre-kill run document survives and the store still rebuilds.
check "M6 the pre-kill run document survived" "$(rc_of test -f "$G_RUN1")"
check "M6 the store rebuilds cleanly after the kill" "$(rc_of $CLI monitor rebuild)"
# No duplicates: alert ids stay unique, and every pre-kill alert is still there.
G_ALL="$($CLI monitor alerts list --all 2>/dev/null | awk '{print $1}' | sort)"
assert_eq "M6 no duplicate alert ids after resume" \
  "$(grep -c . <<<"$G_ALL")" "$(sort -u <<<"$G_ALL" | grep -c .)"
assert_eq "M6 no pre-kill alert was lost on resume" \
  "$(comm -23 <(printf '%s\n' "$G_ALERTS1") <(printf '%s\n' "$G_ALL") | grep -c . || true)" "0"
# The resumed run must not re-emit the suppressed full-state findings -- that
# would be #225 again, reached through the restart path.
assert_eq "M6 the resumed run re-emits nothing over unchanged data" \
  "$(cell_field "$G_RUN2" 'mixer:bittensor' findings_count)" "0"

########################################################################
# PHASE H -- W1 + watchlist dedupe by source_ref (AC-11) and cost (AC-6).
#
# W1 was written into the previous smoke but NEVER EXECUTED: it was gated
# behind a findings probe that never fired under the old bittensor_evm config,
# so the `else` branch printed PASS on every run.
########################################################################
WS_H="$(new_workspace)"
write_config "$WS_H" <<'EOF'
{ "cells": [ { "detector": "mixer", "network": "bittensor", "params": { "time_scope": "recent" } } ],
  "intervalSeconds": 3600, "caseMaxHops": 2,
  "watchlist": { "dustMaxUsd": 1.0, "dustLookbackSeconds": 86400, "enabled": true } }
EOF
cd "$WS_H"
$CLI monitor run >/dev/null 2>&1 || true
H_DOC="$(findings_doc "$WS_H" mixer bittensor)"
if [ -z "$H_DOC" ] || [ "$(jq '.findings | length' "$H_DOC")" -eq 0 ]; then
  fail "W1 watchlist" "the seeding run produced no findings to watch"
else
  # Watch several addresses the run already flagged, on the SAME network.
  # AC-6: the dust probe is one call per distinct NETWORK, never per address.
  mapfile -t WATCHED < <(jq -r '.findings[0:5][].address' "$H_DOC")
  for addr in "${WATCHED[@]}"; do
    $CLI monitor watchlist add "$addr" --network bittensor >/dev/null 2>&1 || true
  done
  assert_eq "W1 five addresses are on the watchlist" "$($CLI monitor watchlist list 2>/dev/null | grep -c .)" "5"
  sleep 1
  $CLI monitor run >/dev/null 2>&1 || true
  WL1="$($CLI monitor alerts list --all 2>/dev/null | grep -c ' watchlist_' || true)"
  assert_ge "W1 a watched address touched by an existing finding raises an alert" "$WL1" 1
  assert_ge "W1 the alert is a watchlist_finding (a local join, not a remote call)" \
    "$($CLI monitor alerts list --all 2>/dev/null | grep -c ' watchlist_finding ' || true)" 1
  # AC-11 dedupe by source_ref: the SAME finding document must not re-alert on
  # the next run. This is the assertion that makes a watchlist survivable.
  sleep 1
  $CLI monitor run >/dev/null 2>&1 || true
  assert_eq "W1 watchlist hits dedupe by source_ref across runs" \
    "$($CLI monitor alerts list --all 2>/dev/null | grep -c ' watchlist_' || true)" "$WL1"
  # AC-6's exact call count is not observable from the workspace: the run
  # document carries no per-cell call counter. Stated, not silently dropped.
  skip "W1/AC-6 exact remote-call count" \
    "the run document records no per-cell call counter, so K-calls-for-K-networks and the never-call-aml_address_risk guarantee are asserted at unit level: tests/monitor/watchlist-run.test.ts 'makes one call per distinct network regardless of address count (AC-6)' and 'the watchlist pass never calls aml_address_risk (AC-6 cost guarantee)'"
fi

########################################################################
# PHASE I -- known-answer case tracking over a real theft corridor, the
# watchlist convergence alert, and the #232 pending-review regression.
#
# The devkit fixture carries a real, forensically traced theft incident whose
# actors are referred to here by neutral on-chain role labels only:
#
#   VICTIM -> THEFT_HOP1 -> {SPLIT_A, SPLIT_B, SPLIT_C}   (near-equal 3-way
#   split, the structuring signature), and a second, independently controlled
#   OPERATOR wallet that funds the SAME exchange deposit the theft chain
#   cashes out through -- the convergence that ties the two together.
#
# Unlike U6's generic seed, every address below is a pinned known answer: the
# baseline corridor from the victim seed is EXACTLY the seed plus the theft
# hop and the three split legs, all classified propagated_scam.
########################################################################
I_VICTIM="5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5"
I_OPERATOR="5D9yaXf5nqrzKHqgoWMYeKqEERthvftdJB7XkrwNgQzNGrYb"
I_THEFT_HOP1="5DABm6GGjNZXuJxL1DwjzDB9Bkxu7Tj7MwRWhvahKi3Qm6c8"
I_SPLIT_A="5EXN8qJ7yhoAYLXi6Jw7gytTxyToVdNeoi3AR2p73tF7uGKn"
I_SPLIT_B="5Eh17XkBu9QncfkoAF9dfhNFYi7woZiUeKZ3aKpA2zJB37nK"
I_SPLIT_C="5GriNFfiqhtgXJ8kd4SRSQMNpyXt2HeY1A1orDHwhnawRwoi"
I_MID_COLDKEY="5EkTMF1noWnWupGxQqtPczW2FFB7ktdVwjaZ22Cam54U93Xx"
I_DEPOSIT_SHARED="5EVTetmsvVf47UyMfaYxhJMeJaGoeY9JMwgnqdWyx5taaTR6"

WS_I="$(new_workspace)"
write_config "$WS_I" <<'EOF'
{ "cells": [ { "detector": "mixer", "network": "bittensor", "params": { "time_scope": "recent" } } ],
  "intervalSeconds": 3600, "caseMaxHops": 2,
  "watchlist": { "dustMaxUsd": 1.0, "dustLookbackSeconds": 86400, "enabled": true } }
EOF
cd "$WS_I"
check "I/case add on the victim seed" \
  "$(rc_of $CLI monitor case add theft-corridor --type stolen-funds --network bittensor --seed "$I_VICTIM")"
sleep 1
I_RUN1_RC=0; $CLI monitor run >/dev/null 2>&1 || I_RUN1_RC=$?
assert_eq "I/baseline run completes" "$I_RUN1_RC" "0"
I_SNAP1="$(ls "$WS_I"/cases/theft-corridor/snapshots/*.snapshot.json 2>/dev/null | sort | tail -1 || true)"
check "I/baseline snapshot written" "$(rc_of test -n "$I_SNAP1")"
# The known answer: the 2-hop corridor from the victim is EXACTLY the seed,
# the theft hop, and the three split legs -- nothing else. An extra address
# here means corridor over-reach; a missing one means the trace lost the theft.
assert_eq "I/baseline corridor is exactly the victim + theft hop + 3-way split (5 addresses)" \
  "$(jq -r '[.addresses[].address] | sort | join(",")' "$I_SNAP1")" \
  "$(printf '%s\n' "$I_VICTIM" "$I_THEFT_HOP1" "$I_SPLIT_A" "$I_SPLIT_B" "$I_SPLIT_C" | sort | paste -sd,)"
assert_eq "I/every non-seed corridor address is propagated_scam" \
  "$(jq -r '[.addresses[] | select(.address != "'"$I_VICTIM"'") | .classification] | unique | join(",")' "$I_SNAP1")" \
  "propagated_scam"
I_RUN1="$(newest_run "$WS_I")"
assert_eq "I/baseline emits no movements" "$(cell_field "$I_RUN1" 'case:theft-corridor' movements_count)" "0"

# ---- convergence: the second actor joins the case ---------------------------
# Watch the shared deposit BEFORE it is discovered -- the investigator's move.
check "I/watch the convergence deposit" \
  "$(rc_of $CLI monitor watchlist add "$I_DEPOSIT_SHARED" --network bittensor)"
# Expand the case with the operator seed -- the real investigative event: a
# second controlled wallet is identified mid-case. This used to require
# hand-editing cases/<id>/case.json (chain-insights#250); it is now a first
# class command that also records WHEN the seed was added.
check "I/add-seed expands the open case with the operator wallet" \
  "$(rc_of $CLI monitor case add-seed theft-corridor --address "$I_OPERATOR" --note 'operator wallet identified mid-case')"
assert_eq "I/the added seed is stamped with the time it entered the case" \
  "$(jq -r --arg a "$I_OPERATOR" '(.seeds_added_at_ms[$a] // "") | tostring | (. != "") | tostring' "$WS_I/cases/theft-corridor/case.json")" "true"
assert_eq "I/the seed addition is recorded as a case event with its note" \
  "$(jq -r '[.seed_events[] | select(.action == "add") | .note] | join(",")' "$WS_I/cases/theft-corridor/case.json")" \
  "operator wallet identified mid-case"
# Idempotent: re-adding the same seed is a no-op, not an error, and must not
# append a second event (a scripted add-seed has to be safe to re-run).
check "I/add-seed is idempotent (re-add exits clean)" \
  "$(rc_of $CLI monitor case add-seed theft-corridor --address "$I_OPERATOR")"
assert_eq "I/an idempotent re-add records no second seed event" \
  "$(jq '[.seed_events[] | select(.action == "add")] | length' "$WS_I/cases/theft-corridor/case.json")" "1"
assert_eq "I/an idempotent re-add does not duplicate the seed" \
  "$(jq --arg a "$I_OPERATOR" '[.seeds[] | select(. == $a)] | length' "$WS_I/cases/theft-corridor/case.json")" "1"
sleep 1
$CLI monitor run >/dev/null 2>&1 || true
I_SNAP2="$(ls "$WS_I"/cases/theft-corridor/snapshots/*.snapshot.json | sort | tail -1)"
check "I/expansion took a new snapshot" "$(rc_of test "$I_SNAP2" != "$I_SNAP1")"
assert_eq "I/expanded seed set carries both actors" \
  "$(jq -r '.seed_set | sort | join(",")' "$I_SNAP2")" \
  "$(printf '%s\n' "$I_OPERATOR" "$I_VICTIM" | sort | paste -sd,)"
# The operator's corridor pulls in the SHARED deposit -- the convergence the
# case exists to prove -- plus the mid coldkey leg of the theft chain.
for role_addr in "shared-deposit:$I_DEPOSIT_SHARED" "mid-coldkey:$I_MID_COLDKEY"; do
  role="${role_addr%%:*}"; addr="${role_addr#*:}"
  assert_eq "I/expanded corridor contains the $role as propagated_scam" \
    "$(jq -r --arg a "$addr" '[.addresses[] | select(.address == $a) | .classification] | join(",")' "$I_SNAP2")" \
    "propagated_scam"
done
I_RUN2="$(newest_run "$WS_I")"
# ---- #250 THE PHANTOM-MOVEMENT ASSERTION --------------------------------
# Nothing moved on this fixture between the two runs: it is a static export,
# and the baseline run above already proved the corridor is stable. Every
# address the expanded run newly sees is visible ONLY because the aperture
# widened. A diff that calls those "movements" is a fabricated forensic claim
# -- it tells the analyst funds reached new hops at a timestamp when they did
# not. So the run must report ZERO movements and account for the same
# addresses as scope expansion instead.
#
# This is the row that fails without the via_seeds attribution in
# src/monitor/tracker.ts: before it, the widened corridor reported
# movements_count >= 1 and a case_movement alert per newly visible address.
assert_eq "#250 the widened corridor manufactures NO movements" \
  "$(cell_field "$I_RUN2" 'case:theft-corridor' movements_count)" "0"
assert_ge "#250 the newly visible addresses are accounted for as scope expansion" \
  "$(cell_field "$I_RUN2" 'case:theft-corridor' scope_expansions_count)" 1
I_ALERTS2="$($CLI monitor alerts list --all 2>/dev/null)"
assert_eq "#250 no case_movement alert is invented for the widened scope" \
  "$(grep -c ' case_movement bittensor theft-corridor ' <<<"$I_ALERTS2" || true)" "0"
assert_ge "#250 the shared deposit raised a case_scope_expansion alert instead" \
  "$(grep -c " case_scope_expansion bittensor theft-corridor $I_DEPOSIT_SHARED" <<<"$I_ALERTS2" || true)" 1
# Scope expansion is NOT suppression: the convergence the add-seed was
# performed to find must still reach review and alerting.
assert_ge "I/the shared deposit raised a frontier_candidate alert" \
  "$(grep -c " frontier_candidate bittensor theft-corridor $I_DEPOSIT_SHARED" <<<"$I_ALERTS2" || true)" 1
assert_ge "I/the operator corridor exposed a cashout endpoint" \
  "$(grep -c ' cashout_endpoint bittensor theft-corridor ' <<<"$I_ALERTS2" || true)" 1
I_CASE_DOC="$(ls "$WS_I"/detections/*case-theft-corridor*.findings.json 2>/dev/null | sort | tail -1 || true)"
check "I/frontier candidates were written as a case findings doc" "$(rc_of test -n "$I_CASE_DOC")"
assert_ge "I/the case findings doc names the shared deposit" \
  "$(jq -r --arg a "$I_DEPOSIT_SHARED" '[.findings[] | select(.address == $a)] | length' "$I_CASE_DOC")" 1

# ---- the watchlist hit: run N+1 joins over what run N ingested --------------
# findingHits/movementHits join the store's finding_addresses/case_movements
# tables, which this run's own documents enter at ingest -- so the watched
# deposit's hit surfaces on the NEXT run. That is the documented cadence, not
# a race: the watchlist scopes "the signal the loop already produced".
sleep 1
$CLI monitor run >/dev/null 2>&1 || true
I_ALERTS3="$($CLI monitor alerts list --all 2>/dev/null)"
assert_ge "I/watched case address raised watchlist_finding (via the case findings doc)" \
  "$(grep -c " watchlist_finding bittensor .*$I_DEPOSIT_SHARED" <<<"$I_ALERTS3" || true)" 1
assert_ge "I/watched case address raised watchlist_movement (via case_movements)" \
  "$(grep -c " watchlist_movement bittensor theft-corridor $I_DEPOSIT_SHARED" <<<"$I_ALERTS3" || true)" 1

# ---- #232: a re-run over unchanged data adds no pending reviews -------------
# The full-state mixer cell still writes one findings document per run --
# empty after suppression. Before #232 every one of those entered the review
# queue (~192/day at 8 hourly cells). The fix excludes findings_count = 0 docs
# from listPending; the count must therefore be flat across idle re-runs.
I_PENDING_BEFORE="$($CLI monitor review list 2>/dev/null | grep -c . || true)"
I_WL_COUNT_BEFORE="$(grep -c ' watchlist_' <<<"$I_ALERTS3" || true)"
sleep 1
$CLI monitor run >/dev/null 2>&1 || true
I_PENDING_AFTER="$($CLI monitor review list 2>/dev/null | grep -c . || true)"
assert_eq "#232 idle re-run adds no pending reviews" "$I_PENDING_AFTER" "$I_PENDING_BEFORE"
# ... and none of the listed items is an empty document.
assert_eq "#232 no zero-findings document is listed for review" \
  "$($CLI monitor review list 2>/dev/null | awk -F'\t' '$4 == 0' | grep -c . || true)" "0"
I_RUN4="$(newest_run "$WS_I")"
assert_eq "#232 idle re-run derives no case movements" \
  "$(cell_field "$I_RUN4" 'case:theft-corridor' movements_count)" "0"
# The expanded corridor is the new baseline: scope expansion is reported ONCE,
# on the run that first sees the wider aperture, never again on every run after.
assert_eq "#250 the widened corridor is quiet on the next idle re-run" \
  "$(cell_field "$I_RUN4" 'case:theft-corridor' scope_expansions_count)" "0"
# Watchlist dedupe by source_ref holds for case-sourced hits too.
assert_eq "I/watchlist hits on the case dedupe across idle re-runs" \
  "$($CLI monitor alerts list --all 2>/dev/null | grep -c ' watchlist_' || true)" "$I_WL_COUNT_BEFORE"

########################################################################
# PHASE J -- chain-insights#250 seed mutation guards: remove-seed narrows a
# live case, the seed set can never be emptied, a CLOSED case refuses both
# mutations, and a Cypher-shaped address never reaches canonical JSON.
#
# Phase I already proved the two halves that need a real trace (add-seed grows
# the corridor; the widened scope emits no phantom movement). What is left is
# guard behavior, asserted on the canonical case document and the snapshot --
# never on an exit code, so "refused" and "crashed" cannot look the same.
########################################################################
J_CASE="$WS_I/cases/theft-corridor/case.json"
cd "$WS_I"

# ---- the seed set can never be emptied ------------------------------------
J_SEEDS_BEFORE="$(jq -c '.seeds | sort' "$J_CASE")"
$CLI monitor case remove-seed theft-corridor --address "$I_VICTIM" "$I_OPERATOR" >/dev/null 2>&1 || true
assert_eq "#250 removing every seed is refused and leaves the case untouched" \
  "$(jq -c '.seeds | sort' "$J_CASE")" "$J_SEEDS_BEFORE"

# ---- an address outside the allow-list never reaches canonical JSON --------
# The seed is interpolated into corridor traversal downstream, so validation is
# on the way IN. Asserted on the FILE, not on an exit code.
$CLI monitor case add-seed theft-corridor --address "$I_OPERATOR' RETURN 1 //" >/dev/null 2>&1 || true
assert_eq "#250 a Cypher-shaped seed is rejected before it is persisted" \
  "$(jq -c '.seeds | sort' "$J_CASE")" "$J_SEEDS_BEFORE"

# ---- remove-seed narrows the traced corridor on the next run ---------------
$CLI monitor case remove-seed theft-corridor --address "$I_OPERATOR" >/dev/null 2>&1 || true
assert_eq "#250 remove-seed drops the seed from the case" \
  "$(jq -r --arg a "$I_OPERATOR" '[.seeds[] | select(. == $a)] | length' "$J_CASE")" "0"
assert_eq "#250 remove-seed clears that seed's addition timestamp" \
  "$(jq -r --arg a "$I_OPERATOR" '(.seeds_added_at_ms // {}) | has($a) | tostring' "$J_CASE")" "false"
assert_eq "#250 the removal is recorded as a case event" \
  "$(jq -r '[.seed_events[] | select(.action == "remove") | .addresses[]] | join(",")' "$J_CASE")" "$I_OPERATOR"
# Idempotent: removing what is no longer a seed changes nothing.
$CLI monitor case remove-seed theft-corridor --address "$I_OPERATOR" >/dev/null 2>&1 || true
assert_eq "#250 remove-seed is idempotent (no second removal event)" \
  "$(jq '[.seed_events[] | select(.action == "remove")] | length' "$J_CASE")" "1"
sleep 1
$CLI monitor run >/dev/null 2>&1 || true
J_SNAP="$(ls "$WS_I"/cases/theft-corridor/snapshots/*.snapshot.json | sort | tail -1)"
assert_eq "#250 the next run traces the narrowed seed set" \
  "$(jq -r --arg a "$I_OPERATOR" '[.seed_set[] | select(. == $a)] | length' "$J_SNAP")" "0"
J_RUN="$(newest_run "$WS_I")"
assert_eq "#250 narrowing the case emits no movements either" \
  "$(cell_field "$J_RUN" 'case:theft-corridor' movements_count)" "0"

# ---- a CLOSED case is a historical record ---------------------------------
# Refuse, with no reopen path: the run loop only re-traces OPEN cases, so a
# seed added to a closed one would sit in canonical JSON with no snapshot
# behind it and silently rewrite what was investigated and when.
$CLI monitor case close theft-corridor >/dev/null 2>&1 || true
assert_eq "#250 the case is closed" "$(jq -r '.status' "$J_CASE")" "closed"
J_CLOSED_SEEDS="$(jq -c '.seeds | sort' "$J_CASE")"
J_ADD_OUT="$($CLI monitor case add-seed theft-corridor --address "$I_MID_COLDKEY" 2>&1 || true)"
assert_contains "#250 add-seed on a closed case is refused, and says why" "$J_ADD_OUT" "closed"
assert_eq "#250 the closed case's seed set is untouched by the refused add" \
  "$(jq -c '.seeds | sort' "$J_CASE")" "$J_CLOSED_SEEDS"
J_RM_OUT="$($CLI monitor case remove-seed theft-corridor --address "$I_VICTIM" 2>&1 || true)"
assert_contains "#250 remove-seed on a closed case is refused, and says why" "$J_RM_OUT" "closed"
assert_eq "#250 the closed case's seed set is untouched by the refused removal" \
  "$(jq -c '.seeds | sort' "$J_CASE")" "$J_CLOSED_SEEDS"
assert_eq "#250 a refused mutation records no seed event" \
  "$(jq '(.closed_at_ms // 0) as $c | [.seed_events[] | select(.at_ms > $c)] | length' "$J_CASE")" "0"
# The store still rebuilds from the mutated canonical JSON.
check "#250 the store rebuilds after the seed mutations" "$(rc_of $CLI monitor rebuild)"

########################################################################
echo "MONITOR-SMOKE done: $PASS pass, $FAIL fail, $SKIP skip"
for w in "${WORKSPACES[@]}"; do echo "MONITOR-SMOKE workspace: $w"; done
[ "$FAIL" -eq 0 ]
