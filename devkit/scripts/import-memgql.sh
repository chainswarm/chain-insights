#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"
WORKSPACE="$REPO_ROOT/workspace"
BOOTSTRAP_REL="repos/ml/data-pipeline/ops/memgql/bootstrap.sh"
MAPPING_REL="repos/ml/data-pipeline/ops/memgql/chain_insights_starrocks_mapping.json"
BOOTSTRAP="$REPO_ROOT/$BOOTSTRAP_REL"
MAPPING="$REPO_ROOT/$MAPPING_REL"
if [ -f /mapping/bootstrap.sh ]; then
  BOOTSTRAP="/mapping/bootstrap.sh"
fi
if [ -f /mapping/chain_insights_starrocks_mapping.json ]; then
  MAPPING="/mapping/chain_insights_starrocks_mapping.json"
fi
MGCONSOLE_BIN="${MGCONSOLE_BIN:-mgconsole}"

export MEMGQL_HOST="${MEMGQL_HOST:-memgql}"
export MEMGQL_PORT="${MEMGQL_PORT:-7688}"
export MEMGRAPH_CONNECTOR_URI="${MEMGRAPH_CONNECTOR_URI:-bolt://memgraph:7687}"
export STARROCKS_HOST="${STARROCKS_HOST:-starrocks}"
export STARROCKS_PORT="${STARROCKS_PORT:-9030}"
export STARROCKS_DATABASE="${STARROCKS_DATABASE:-bittensor_semantic}"
export STARROCKS_USER="${STARROCKS_USER:-root}"
export STARROCKS_PASSWORD="${STARROCKS_PASSWORD:-}"
export MEMGQL_STARROCKS_MAPPING_FILE="${MEMGQL_STARROCKS_MAPPING_FILE:-$MAPPING}"

mkdir -p "$WORKSPACE"
export PATH="$SCRIPT_DIR:$PATH"
test -f "$BOOTSTRAP"
test -f "$MAPPING"
command -v "$MGCONSOLE_BIN" >/dev/null

for attempt in $(seq 1 60); do
  if "$MGCONSOLE_BIN" --host "$MEMGQL_HOST" --port "$MEMGQL_PORT" --execute "SHOW CONNECTORS;" >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" -eq 60 ]; then
    echo "MemGQL did not become ready at ${MEMGQL_HOST}:${MEMGQL_PORT}" >&2
    exit 1
  fi
  sleep 2
done

bash "$BOOTSTRAP"

cat > "$WORKSPACE/devkit-memgql-smoke.cypher" <<'CYPHER'
USE live_topology MATCH (i:Identity) RETURN count(i) AS identities LIMIT 1;
USE archive_topology MATCH (i:Identity) RETURN count(i) AS identities LIMIT 1;
USE facts MATCH (l:AddressLabel) RETURN count(l) AS labels LIMIT 1;
CYPHER

"$MGCONSOLE_BIN" \
  --host "$MEMGQL_HOST" \
  --port "$MEMGQL_PORT" \
  < "$WORKSPACE/devkit-memgql-smoke.cypher" \
  > "$WORKSPACE/devkit-memgql-smoke.txt"

printf '%s\n' "MemGQL devkit bootstrap complete."
