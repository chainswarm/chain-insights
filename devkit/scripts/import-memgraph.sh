#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"
WORKSPACE="$REPO_ROOT/workspace"
DEVKIT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEVKIT_MEMGRAPH_DATA="$DEVKIT_ROOT/data/memgraph"
MEMGRAPH_HOST="${MEMGRAPH_HOST:-memgraph}"
MEMGRAPH_PORT="${MEMGRAPH_PORT:-7687}"

mkdir -p "$WORKSPACE"
export PATH="$SCRIPT_DIR:$PATH"
test -d "$DEVKIT_MEMGRAPH_DATA"
command -v python3 >/dev/null

python3 "$SCRIPT_DIR/validate-manifest.py"

for attempt in $(seq 1 60); do
  if python3 "$SCRIPT_DIR/run-cypher.py" --host "$MEMGRAPH_HOST" --port "$MEMGRAPH_PORT" --execute "RETURN 1;" >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" -eq 60 ]; then
    echo "Memgraph did not become ready at ${MEMGRAPH_HOST}:${MEMGRAPH_PORT}" >&2
    exit 1
  fi
  sleep 2
done

python3 "$SCRIPT_DIR/import-memgraph-jsonl.py" \
  --host "$MEMGRAPH_HOST" \
  --port "$MEMGRAPH_PORT" \
  --data-root "$DEVKIT_MEMGRAPH_DATA" \
  --output "$WORKSPACE/devkit-memgraph-import.json"
