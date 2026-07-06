#!/usr/bin/env bash
# Capability probe suite — live lane (self-contained; no devkit required).
#
# Empirically pins what the MemGQL federation layer accepts AND what it
# returns on a Memgraph-backed live_topology graph. Result-set assertions
# are mandatory: a "supported-but-wrong" outcome class exists because
# MemGQL 0.7.0 accepts quantifier-inner WHERE syntax and silently discards
# the predicates (memgraph/memgraph#4343; see also #4344, #4345).
#
# Emits: workspace/capability-matrix.<memgql-tag>.json
# Compared against: devkit/capability-probes/expected-live.json
# (tests/capability-matrix.test.ts, gated by CAPABILITY_PROBES=1).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORKSPACE="$REPO_ROOT/workspace"
mkdir -p "$WORKSPACE"

# Probe against the same MemGQL image the devkit pins.
MEMGQL_IMAGE="$(grep -oE 'memgraph/memgql:[0-9.]+' "$REPO_ROOT/devkit/docker-compose.yml" | head -1)"
MEMGRAPH_IMAGE="$(grep -oE 'memgraph/memgraph:[0-9.]+' "$REPO_ROOT/devkit/docker-compose.yml" | head -1)"
MGCONSOLE_IMAGE="memgraph/mgconsole:1.5.1"
TAG="${MEMGQL_IMAGE##*:}"
OUT="$WORKSPACE/capability-matrix.$TAG.json"

SUFFIX="$$"
NET="capprobe-net-$SUFFIX"
MG="capprobe-mg-$SUFFIX"
GQL="capprobe-gql-$SUFFIX"
CON="capprobe-con-$SUFFIX"

cleanup() {
  docker rm -f "$MG" "$GQL" "$CON" >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
}
cleanup 2>/dev/null
trap cleanup EXIT

set -e
docker network create "$NET" >/dev/null
docker run -d --name "$MG" --network "$NET" "$MEMGRAPH_IMAGE" >/dev/null
docker run -d --name "$GQL" --network "$NET" \
  -e CONNECTOR_TYPE=multi -e BOLT_LISTEN_ADDR=0.0.0.0:7688 "$MEMGQL_IMAGE" >/dev/null
docker run -d --name "$CON" --network "$NET" --entrypoint sh "$MGCONSOLE_IMAGE" -c 'sleep 900' >/dev/null
MEMGQL_DIGEST="$(docker inspect --format '{{index .Image}}' "$GQL")"
set +e

mg()  { docker exec -i "$CON" sh -c "echo \"\$0\" | timeout 20 mgconsole --host $MG --port 7687" "$1" 2>&1; }
gql() { docker exec -i "$CON" sh -c "echo \"\$0\" | timeout 20 mgconsole --host $GQL --port 7688" "$1" 2>&1; }

for i in $(seq 1 45); do mg "RETURN 1;" >/dev/null 2>&1 && break; sleep 1; done

# Deterministic probe topology (same as the 2026-07-06 spike):
#   A->B 100, B->C 50, A->D 10, D->E 5, E->C 20
#   C = :Identity:Exchange {is_exchange:'binance'}; D = :Identity:Scam
mg "CREATE (:Identity {identity_id:'A'});" >/dev/null
mg "CREATE (:Identity {identity_id:'B'});" >/dev/null
mg "CREATE (:Identity:Exchange {identity_id:'C', is_exchange:'binance'});" >/dev/null
mg "CREATE (:Identity:Scam {identity_id:'D', address_type:'SCAM'});" >/dev/null
mg "CREATE (:Identity {identity_id:'E'});" >/dev/null
mg "MATCH (a {identity_id:'A'}),(b {identity_id:'B'}) CREATE (a)-[:FLOWS_TO {amount_usd_sum:100.0}]->(b);" >/dev/null
mg "MATCH (b {identity_id:'B'}),(c {identity_id:'C'}) CREATE (b)-[:FLOWS_TO {amount_usd_sum:50.0}]->(c);" >/dev/null
mg "MATCH (a {identity_id:'A'}),(d {identity_id:'D'}) CREATE (a)-[:FLOWS_TO {amount_usd_sum:10.0}]->(d);" >/dev/null
mg "MATCH (d {identity_id:'D'}),(e {identity_id:'E'}) CREATE (d)-[:FLOWS_TO {amount_usd_sum:5.0}]->(e);" >/dev/null
mg "MATCH (e {identity_id:'E'}),(c {identity_id:'C'}) CREATE (e)-[:FLOWS_TO {amount_usd_sum:20.0}]->(c);" >/dev/null

for i in $(seq 1 45); do gql "SHOW CONNECTORS;" >/dev/null 2>&1 && break; sleep 1; done
gql "ADD CONNECTOR live_topology TYPE memgraph URI 'bolt://$MG:7687' GRAPH memgraph;" >/dev/null
gql "CONNECT live_topology AS live_topology_conn;" >/dev/null
gql "ADD GRAPH live_topology ON CONNECTOR live_topology GRAPH memgraph;" >/dev/null

ROWS_TMP="$(mktemp)"
FAILED=0

# classify <output> -> supported | rejected-parse | rejected-translation | error | timeout
classify() {
  local out="$1"
  if echo "$out" | grep -q "Terminated"; then echo "timeout"; return; fi
  if echo "$out" | grep -qi "Parse error"; then echo "rejected-parse"; return; fi
  # Backend-side error on translated query = MemGQL emitted invalid Cypher
  if echo "$out" | grep -q "Memgraph.ClientError.MemgraphError"; then echo "rejected-translation"; return; fi
  if echo "$out" | grep -qiE "exception|error"; then echo "error"; return; fi
  echo "supported"
}

# extract sorted data cells (single-column results) as CSV
cells() {
  echo "$1" | grep -oE '^\| "[A-Za-z0-9_]+" *\|$' | tr -d '|" ' | sort | paste -sd, -
}

probe() {
  local id="$1" desc="$2" expected_outcome="$3" expected_rows="$4" issue="$5" query="$6"
  local out actual_outcome actual_rows verdict
  out=$(gql "$query")
  actual_outcome=$(classify "$out")
  actual_rows=$(cells "$out")
  # supported + row mismatch vs KNOWN-CORRECT expectation = supported-but-wrong
  if [ "$actual_outcome" = "supported" ] && [ -n "$expected_rows" ] && [ "$actual_rows" != "$expected_rows" ]; then
    actual_outcome="supported-but-wrong"
  fi
  if [ "$actual_outcome" = "$expected_outcome" ]; then verdict="PASS"; else verdict="FAIL"; FAILED=1; fi
  printf '%-4s %-22s %-8s expected=%s actual=%s rows=[%s]\n' "$id" "$actual_outcome" "$verdict" "$expected_outcome" "$actual_outcome" "$actual_rows"
  python3 - "$id" "$query" "$expected_outcome" "$actual_outcome" "$expected_rows" "$actual_rows" "$issue" <<'PY' >> "$ROWS_TMP"
import json, sys
i, q, eo, ao, er, ar, iss = sys.argv[1:8]
print(json.dumps({
  "probe_id": i, "layer": "live_topology", "query": q,
  "expected_outcome": eo, "actual_outcome": ao,
  "expected_rows": er.split(",") if er else None,
  "actual_rows": ar.split(",") if ar else None,
  "upstream_issue": iss or None,
}))
PY
}

echo "── capability probes: live lane ($MEMGQL_IMAGE) ──"

probe P01 "baseline-match" supported "A,B" "" \
 "USE live_topology MATCH (n:Identity) RETURN n.identity_id AS id ORDER BY n.identity_id LIMIT 2;"
probe P02 "plain-quantifier" supported "B,C,D,E" "" \
 "USE live_topology MATCH (a:Identity {identity_id:'A'})-[:FLOWS_TO]->{1,3}(t:Identity) RETURN DISTINCT t.identity_id AS t ORDER BY t;"
probe P03 "group-quantifier" supported "" "" \
 "USE live_topology MATCH ((s:Identity)-[:FLOWS_TO]->(x:Identity)){1,3} RETURN count(*) AS c LIMIT 1;"
# 4343: inner WHERE parsed but DISCARDED -> unfiltered rows (A leak included).
# Correct result excluding B everywhere: D (1 hop), E (2), C (3 via D,E).
probe P04 "inner-where-node" supported-but-wrong "C,D,E" "memgraph/memgraph#4343" \
 "USE live_topology MATCH (a:Identity {identity_id:'A'})(-[:FLOWS_TO]->(x:Identity WHERE x.identity_id <> 'B')){1,3}(t:Identity) RETURN DISTINCT t.identity_id AS t ORDER BY t;"
probe P05 "inner-where-edge" supported-but-wrong "B" "memgraph/memgraph#4343" \
 "USE live_topology MATCH (a:Identity {identity_id:'A'})(-[r:FLOWS_TO WHERE r.amount_usd_sum >= 60]->(x:Identity)){1,3}(t:Identity) RETURN DISTINCT t.identity_id AS t ORDER BY t;"
probe P06 "any-shortest-binding" supported "" "" \
 "USE live_topology MATCH p = ANY SHORTEST (a:Identity {identity_id:'A'})-[:FLOWS_TO]->{1,5}(c:Identity {identity_id:'C'}) RETURN p;"
probe P07 "shortest-k" rejected-translation "" "memgraph/memgraph#4344" \
 "USE live_topology MATCH p = SHORTEST 2 (a:Identity {identity_id:'A'})-[:FLOWS_TO]->{1,5}(c:Identity {identity_id:'C'}) RETURN p;"
probe P08 "all-shortest" supported "" "" \
 "USE live_topology MATCH p = ALL SHORTEST (a:Identity {identity_id:'A'})-[:FLOWS_TO]->{1,5}(c:Identity {identity_id:'C'}) RETURN count(p) AS routes;"
probe P09 "bare-secondary-label" supported "C" "" \
 "USE live_topology MATCH (n:Exchange) RETURN n.identity_id AS id;"
probe P10 "label-conjunction" supported "C" "" \
 "USE live_topology MATCH (n:Identity&Exchange) RETURN n.identity_id AS id;"
probe P11 "label-colon-stacking" rejected-parse "" "" \
 "USE live_topology MATCH (n:Identity:Exchange) RETURN n.identity_id AS id;"
probe P12 "scam-label" supported "D" "" \
 "USE live_topology MATCH (n:Scam) RETURN n.identity_id AS id;"
probe P13 "for-x-in" supported "" "" \
 "USE live_topology FOR x IN [1,2,3] RETURN x;"
probe P14 "node-compare" supported "" "" \
 "USE live_topology MATCH (a:Identity {identity_id:'A'}), (t:Identity) WHERE a <> t RETURN count(t) AS c;"
probe P15 "cypher-star-varlen" rejected-parse "" "memgraph/memgraph#4241" \
 "USE live_topology MATCH (a:Identity {identity_id:'A'})-[:FLOWS_TO*1..3]->(t:Identity) RETURN t.identity_id;"
probe P16 "labels-function" rejected-parse "" "" \
 "USE live_topology MATCH (n:Identity) RETURN labels(n) LIMIT 1;"
# 4345: anchor dropped when inner WHERE combines with shortest. RETURN p
# (not count(p) — aggregating a path variable is itself a parse error).
# Wrongness signal: >1 path row (correct anchored behavior returns exactly
# one A->…->C route).
probe_p17() {
  local q="USE live_topology MATCH p = ANY SHORTEST (a:Identity {identity_id:'A'})(-[:FLOWS_TO]->(x:Identity WHERE x.is_exchange IS NULL)){0,4}(m:Identity)-[:FLOWS_TO]->(c:Identity {identity_id:'C'}) RETURN p;"
  local out paths actual verdict
  out=$(gql "$q")
  actual=$(classify "$out")
  paths=$(echo "$out" | grep -c "FLOWS_TO")
  if [ "$actual" = "supported" ] && [ "$paths" -ne 1 ]; then actual="supported-but-wrong"; fi
  if [ "$actual" = "supported-but-wrong" ]; then verdict="PASS"; else verdict="FAIL"; FAILED=1; fi
  printf '%-4s %-22s %-8s expected=supported-but-wrong actual=%s path_rows=%s\n' P17 "$actual" "$verdict" "$actual" "$paths"
  python3 - "$q" "$actual" <<'PY' >> "$ROWS_TMP"
import json, sys
print(json.dumps({"probe_id":"P17","layer":"live_topology","query":sys.argv[1],
  "expected_outcome":"supported-but-wrong","actual_outcome":sys.argv[2],
  "expected_rows":None,"actual_rows":None,"upstream_issue":"memgraph/memgraph#4345"}))
PY
}
probe_p17

# P18: determinism — ANY SHORTEST 5x must return the identical route.
DET_Q="USE live_topology MATCH p = ANY SHORTEST (a:Identity {identity_id:'A'})-[:FLOWS_TO]->{1,5}(c:Identity {identity_id:'C'}) RETURN p;"
DET_FIRST=""; DET_OK=1; DET_NONEMPTY=1
for i in 1 2 3 4 5; do
  OUT=$(gql "$DET_Q")
  # A failed or empty response must never count as "deterministic": require
  # a successful classification AND a non-empty path row every repeat.
  if [ "$(classify "$OUT")" != "supported" ]; then DET_NONEMPTY=0; break; fi
  # Strip property maps before comparing: Memgraph's property print order
  # is nondeterministic; route identity = the node/edge sequence only.
  R=$(echo "$OUT" | grep FLOWS_TO | sed 's/{[^}]*}//g')
  if [ -z "$R" ]; then DET_NONEMPTY=0; break; fi
  if [ -z "$DET_FIRST" ]; then DET_FIRST="$R"; elif [ "$R" != "$DET_FIRST" ]; then DET_OK=0; fi
done
if [ "$DET_NONEMPTY" = "1" ] && [ "$DET_OK" = "1" ]; then DET_OUTCOME="supported"; DET_VERDICT="PASS"
elif [ "$DET_NONEMPTY" = "0" ]; then DET_OUTCOME="error"; DET_VERDICT="FAIL"; FAILED=1
else DET_OUTCOME="supported-but-wrong"; DET_VERDICT="FAIL"; FAILED=1; fi
printf '%-4s %-22s %-8s (5-repeat identical route)\n' P18 "$DET_OUTCOME" "$DET_VERDICT"
python3 - "$DET_Q" "$DET_OUTCOME" <<'PY' >> "$ROWS_TMP"
import json, sys
print(json.dumps({"probe_id":"P18","layer":"live_topology","query":sys.argv[1],
  "expected_outcome":"supported","actual_outcome":sys.argv[2],
  "expected_rows":None,"actual_rows":None,"upstream_issue":None}))
PY

python3 - "$OUT" "$MEMGQL_IMAGE" "$MEMGQL_DIGEST" "$ROWS_TMP" <<'PY'
import json, sys
out, image, digest, rows_path = sys.argv[1:5]
rows = [json.loads(l) for l in open(rows_path) if l.strip()]
for r in rows:
    r["memgql_image"] = image
    r["memgql_digest"] = digest
json.dump({"lane": "live", "memgql_image": image, "memgql_digest": digest,
           "rows": rows}, open(out, "w"), indent=1, sort_keys=True)
print(f"wrote {out} ({len(rows)} rows)")
PY

rm -f "$ROWS_TMP"
exit "$FAILED"
