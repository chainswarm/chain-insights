#!/usr/bin/env bash
# Capability probe suite — archive lane (requires a RUNNING devkit compose).
#
# Probes archive_topology / facts (StarRocks-backed, GQL→SQL translation)
# through the devkit's MemGQL service. Semantic rows use the deterministic
# devkit fixture: expected values live in
# devkit/capability-probes/expected-archive.json (meta.anchor_identity is a
# fixture identity chosen at authoring time; regenerating the fixture
# requires re-deriving the expected rows).
#
# Emits: workspace/capability-matrix-archive.<memgql-tag>.json
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORKSPACE="$REPO_ROOT/workspace"
mkdir -p "$WORKSPACE"

EXPECTED="$REPO_ROOT/devkit/capability-probes/expected-archive.json"
# Devkit MemGQL binds bolt on container-local 127.0.0.1 (bootstrap and the
# lite MCP share its network namespace) — probes join that namespace too.
MEMGQL_CONTAINER="${MEMGQL_CONTAINER:-devkit-memgql-1}"
MEMGQL_HOST="127.0.0.1"
MGCONSOLE_IMAGE="memgraph/mgconsole:1.5.1"

MEMGQL_IMAGE="$(grep -oE 'memgraph/memgql:[0-9.]+' "$REPO_ROOT/devkit/docker-compose.yml" | head -1)"
TAG="${MEMGQL_IMAGE##*:}"
OUT="$WORKSPACE/capability-matrix-archive.$TAG.json"
# AC7: artifact carries tag AND digest of the running devkit memgql.
MEMGQL_DIGEST="$(docker inspect "$MEMGQL_CONTAINER" --format '{{.Image}}' 2>/dev/null || echo unknown)"

ANCHOR="$(python3 -c "import json;print(json.load(open('$EXPECTED'))['meta']['anchor_identity'])")"

gql() {
  docker run --rm -i --network "container:$MEMGQL_CONTAINER" --entrypoint sh "$MGCONSOLE_IMAGE" \
    -c "echo \"\$1\" | timeout 45 mgconsole --host $MEMGQL_HOST --port 7688" sh "$1" 2>&1
}

classify() {
  local out="$1"
  if echo "$out" | grep -q "Terminated"; then echo "timeout"; return; fi
  if echo "$out" | grep -qi "Parse error"; then echo "rejected-parse"; return; fi
  if echo "$out" | grep -qiE "Unknown column|SQL|syntax.*near"; then echo "rejected-translation"; return; fi
  if echo "$out" | grep -qiE "exception|error"; then echo "error"; return; fi
  echo "supported"
}

cells() { echo "$1" | grep -oE '^\| "[A-Za-z0-9_]+" *\|' | tr -d '|" ' | sort | paste -sd, -; }
count_cell() { echo "$1" | grep -oE '^\| [0-9]+ *\|$' | tr -d '| ' | head -1; }

ROWS_TMP="$(mktemp)"
FAILED=0

probe() {
  local id="$1" expected_outcome="$2" expected_field="$3" issue="$4" query="$5"
  local start end wall out actual_outcome actual="" expected_val verdict
  expected_val="$(python3 -c "import json;r=[x for x in json.load(open('$EXPECTED'))['rows'] if x['probe_id']=='$id'];print(r[0].get('$expected_field') or '')" 2>/dev/null)"
  start=$(date +%s%N); out=$(gql "$query"); end=$(date +%s%N)
  wall=$(( (end - start) / 1000000 ))
  actual_outcome=$(classify "$out")
  case "$expected_field" in
    expected_count) actual="$(count_cell "$out")" ;;
    expected_rows)  actual="$(cells "$out")" ;;
  esac
  if [ "$actual_outcome" = "supported" ] && [ -n "$expected_val" ] && [ "$actual" != "$expected_val" ]; then
    actual_outcome="supported-but-wrong"
  fi
  if [ "$actual_outcome" = "$expected_outcome" ]; then verdict="PASS"; else verdict="FAIL"; FAILED=1; fi
  printf '%-5s %-22s %-8s wall=%sms actual=[%s]\n' "$id" "$actual_outcome" "$verdict" "$wall" "$actual"
  python3 - "$id" "$query" "$expected_outcome" "$actual_outcome" "$actual" "$issue" "$wall" <<'PY' >> "$ROWS_TMP"
import json, sys
i, q, eo, ao, a, iss, w = sys.argv[1:8]
print(json.dumps({"probe_id": i, "layer": "archive_topology", "query": q,
  "expected_outcome": eo, "actual_outcome": ao, "actual": a or None,
  "upstream_issue": iss or None, "wall_ms": int(w)}))
PY
}

echo "── capability probes: archive lane ($MEMGQL_IMAGE via container:$MEMGQL_CONTAINER) ──"

probe A01 supported expected_count "" \
 "USE archive_topology MATCH (i:Identity {identity_id:'$ANCHOR'})-[f:FLOWS_TO]->(t:Identity) RETURN count(f) AS c;"
# {m,n} on StarRocks: MemGQL emits WITH RECURSIVE, which StarRocks does not
# support (memgraph/memgraph#4178 dialect gap). Pinned as rejected until a
# release adds a StarRocks-compatible translation.
probe A02 rejected-translation expected_count "memgraph/memgraph#4178" \
 "USE archive_topology MATCH (i:Identity {identity_id:'$ANCHOR'})-[:FLOWS_TO]->{1,1}(t:Identity) RETURN count(t) AS c;"
probe A03 rejected-translation expected_count "memgraph/memgraph#4178" \
 "USE archive_topology MATCH (i:Identity {identity_id:'$ANCHOR'})-[:FLOWS_TO]->{1,2}(t:Identity) RETURN count(t) AS c;"
# Inner WHERE on archive: mirror of live P04/P05 — expected outcome pinned
# from the authoring run (supported-but-wrong if SQL translation also
# discards; rejected-* if the SQL path rejects instead).
probe A04 "$(python3 -c "import json;print([x for x in json.load(open('$EXPECTED'))['rows'] if x['probe_id']=='A04'][0]['expected_outcome'])")" expected_count "memgraph/memgraph#4343" \
 "USE archive_topology MATCH (i:Identity {identity_id:'$ANCHOR'})(-[f:FLOWS_TO WHERE f.amount_usd_sum >= 999999999]->(x:Identity)){1,2}(t:Identity) RETURN count(t) AS c;"
probe A05 rejected-parse "" "memgraph/memgraph#4241" \
 "USE archive_topology MATCH (a:Identity)-[:FLOWS_TO*1..2]->(t:Identity) RETURN t.identity_id LIMIT 1;"
probe A06 rejected-translation "" "" \
 "USE archive_topology MATCH (a:Identity {identity_id:'$ANCHOR'}), (t:Identity) WHERE a <> t RETURN count(t) AS c;"
probe A07 rejected-translation "" "memgraph/memgraph#4178" \
 "USE archive_topology MATCH (i:Identity {identity_id:'$ANCHOR'})-[f:FLOWS_TO]->(t:Identity) RETURN collect(t.identity_id) AS ids;"
probe A08 rejected-translation "" "" \
 "USE archive_topology MATCH (a:Identity {identity_id:'$ANCHOR'})-[:FLOWS_TO]->{1,}(t:Identity) RETURN count(t) AS c;"

python3 - "$OUT" "$MEMGQL_IMAGE" "$MEMGQL_DIGEST" "$ROWS_TMP" <<'PY'
import json, sys
out, image, digest, rows_path = sys.argv[1:5]
rows = [json.loads(l) for l in open(rows_path) if l.strip()]
for r in rows:
    r["memgql_image"] = image
    r["memgql_digest"] = digest
json.dump({"lane": "archive", "memgql_image": image, "memgql_digest": digest,
           "rows": rows}, open(out, "w"), indent=1, sort_keys=True)
print(f"wrote {out} ({len(rows)} rows)")
PY
rm -f "$ROWS_TMP"
exit "$FAILED"
