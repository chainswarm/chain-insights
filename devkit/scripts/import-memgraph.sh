#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"
WORKSPACE="$REPO_ROOT/workspace"
DEVKIT_MEMGRAPH_DATA_REL="repos/infra/chain-insights/devkit/data/memgraph"
DEVKIT_MEMGRAPH_DATA="$REPO_ROOT/$DEVKIT_MEMGRAPH_DATA_REL"
MGCONSOLE_BIN="${MGCONSOLE_BIN:-mgconsole}"
MEMGRAPH_HOST="${MEMGRAPH_HOST:-memgraph}"
MEMGRAPH_PORT="${MEMGRAPH_PORT:-7687}"

mkdir -p "$WORKSPACE"
test -d "$DEVKIT_MEMGRAPH_DATA"
command -v "$MGCONSOLE_BIN" >/dev/null

python3 "$SCRIPT_DIR/validate-manifest.py"
python3 "$SCRIPT_DIR/memgraph-cypher.py" > "$WORKSPACE/devkit-memgraph-import.cypher"

for attempt in $(seq 1 60); do
  if "$MGCONSOLE_BIN" --host "$MEMGRAPH_HOST" --port "$MEMGRAPH_PORT" --execute "RETURN 1;" >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" -eq 60 ]; then
    echo "Memgraph did not become ready at ${MEMGRAPH_HOST}:${MEMGRAPH_PORT}" >&2
    exit 1
  fi
  sleep 2
done

"$MGCONSOLE_BIN" \
  --host "$MEMGRAPH_HOST" \
  --port "$MEMGRAPH_PORT" \
  < "$WORKSPACE/devkit-memgraph-import.cypher"

cat > "$WORKSPACE/devkit-memgraph-counts.cypher" <<'CYPHER'
MATCH (i:Identity) RETURN 'Identity', count(i);
MATCH (a:Address) RETURN 'Address', count(a);
MATCH ()-[r:HAS_ADDRESS]->() RETURN 'HAS_ADDRESS', count(r);
MATCH ()-[r:FLOWS_TO]->() RETURN 'FLOWS_TO', count(r);
CYPHER

"$MGCONSOLE_BIN" \
  --host "$MEMGRAPH_HOST" \
  --port "$MEMGRAPH_PORT" \
  < "$WORKSPACE/devkit-memgraph-counts.cypher" \
  > "$WORKSPACE/devkit-memgraph-counts.txt"

python3 - "$WORKSPACE/devkit-memgraph-counts.txt" "$WORKSPACE/devkit-memgraph-import.json" <<'PY'
import json
import re
import sys
from pathlib import Path

counts = {}
for line in Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace").splitlines():
    match = re.search(r"(Identity|Address|HAS_ADDRESS|FLOWS_TO).*?([0-9]+)", line)
    if match:
        counts[match.group(1)] = int(match.group(2))
required = {"Identity", "Address", "HAS_ADDRESS", "FLOWS_TO"}
missing = required - counts.keys()
if missing:
    raise SystemExit(f"missing Memgraph import counts: {sorted(missing)}")
Path(sys.argv[2]).write_text(json.dumps({"counts": counts}, indent=2) + "\n", encoding="utf-8")
PY
