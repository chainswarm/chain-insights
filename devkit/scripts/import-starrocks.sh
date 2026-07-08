#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVKIT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"
WORKSPACE="$REPO_ROOT/workspace"
MYSQL_BIN="${MYSQL_BIN:-mysql}"
STARROCKS_HOST="${STARROCKS_HOST:-starrocks}"
STARROCKS_PORT="${STARROCKS_PORT:-9030}"
STARROCKS_HTTP_PORT="${STARROCKS_HTTP_PORT:-8030}"
STARROCKS_USER="${STARROCKS_USER:-root}"
STARROCKS_PASSWORD="${STARROCKS_PASSWORD:-}"
# Graph node/edge → StarRocks table+column mapping. Post MemGQL retirement the
# canonical source is the devkit's own vendored translator asset; in-container
# it is bind-mounted at /mapping, on host it is read from the devkit tree.
MEMGQL_STARROCKS_MAPPING_FILE="${MEMGQL_STARROCKS_MAPPING_FILE:-/mapping/chain_insights_starrocks_mapping.json}"
if [ ! -f "$MEMGQL_STARROCKS_MAPPING_FILE" ]; then
  MEMGQL_STARROCKS_MAPPING_FILE="$DEVKIT_ROOT/chain-insights-graph-devkit/internal/cyphersql/mapping.json"
fi
export MEMGQL_STARROCKS_MAPPING_FILE

mkdir -p "$WORKSPACE/devkit-starrocks"
LOAD_RUN_ID="${STARROCKS_STREAM_LOAD_RUN_ID:-$(date +%s%N)}"
export LOAD_RUN_ID
command -v "$MYSQL_BIN" >/dev/null
command -v curl >/dev/null
command -v gzip >/dev/null

python3 "$SCRIPT_DIR/validate-manifest.py"

for attempt in $(seq 1 60); do
  if MYSQL_PWD="$STARROCKS_PASSWORD" "$MYSQL_BIN" \
    --host="$STARROCKS_HOST" \
    --port="$STARROCKS_PORT" \
    --user="$STARROCKS_USER" \
    --execute="SELECT 1" >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" -eq 60 ]; then
    echo "StarRocks did not become ready at ${STARROCKS_HOST}:${STARROCKS_PORT}" >&2
    exit 1
  fi
  sleep 2
done

for attempt in $(seq 1 60); do
  if MYSQL_PWD="$STARROCKS_PASSWORD" "$MYSQL_BIN" \
    --host="$STARROCKS_HOST" \
    --port="$STARROCKS_PORT" \
    --user="$STARROCKS_USER" \
    --batch \
    --raw \
    --execute="SHOW BACKENDS" 2>/dev/null \
    | awk -F'\t' 'NR == 1 {for (i = 1; i <= NF; i++) if ($i == "Alive") alive_col = i; next} alive_col && $alive_col == "true" {found = 1} END {exit found ? 0 : 1}'; then
    break
  fi
  if [ "$attempt" -eq 60 ]; then
    echo "StarRocks backend did not become alive at ${STARROCKS_HOST}:${STARROCKS_PORT}" >&2
    exit 1
  fi
  sleep 2
done

python3 "$SCRIPT_DIR/starrocks-ddl.py" > "$WORKSPACE/devkit-starrocks/schema.sql"
MYSQL_PWD="$STARROCKS_PASSWORD" "$MYSQL_BIN" \
  --host="$STARROCKS_HOST" \
  --port="$STARROCKS_PORT" \
  --user="$STARROCKS_USER" \
  < "$WORKSPACE/devkit-starrocks/schema.sql"

python3 - "$DEVKIT_ROOT/data/manifest.json" "$WORKSPACE/devkit-starrocks/stream-load.sh" "$WORKSPACE/devkit-starrocks" <<'PY'
import gzip
import json
import os
import shutil
import shlex
import sys
from pathlib import Path

manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
output = Path(sys.argv[2])
workspace = Path(sys.argv[3])
data_root = Path(sys.argv[1]).parent
objects = [entry for entry in manifest["objects"] if entry["database"] == "bittensor"]


def sql_string(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "''") + "'"


def safe_identifier(value: str) -> str:
    if not value or not value.replace("_", "").isalnum() or value[0].isdigit():
        raise SystemExit(f"unsafe SQL identifier: {value!r}")
    return value


def write_plain_tsv(source: Path, target: Path) -> list[str]:
    with source.open("rb") as raw:
        prefix = raw.read(2)
    if prefix == b"\x1f\x8b":
        with gzip.open(source, "rb") as src, target.open("wb") as dst:
            shutil.copyfileobj(src, dst)
    else:
        shutil.copy(source, target)
    with target.open("r", encoding="utf-8", newline="") as handle:
        header = handle.readline().rstrip("\n")
        if not header:
            raise SystemExit(f"fixture file has no header row: {source}")
        columns = header.split("\t")
        for column in columns:
            safe_identifier(column)
    return columns


def object_sources(entry: dict) -> list[tuple[Path, int]]:
    parts = entry.get("parts") or []
    if not parts:
        return [(data_root / entry["path"], int(entry["row_count"]))]
    return [
        (data_root / part["path"], int(part.get("row_count", 0)))
        for part in parts
    ]


with output.open("w", encoding="utf-8") as handle:
    handle.write("#!/usr/bin/env bash\nset -euo pipefail\n")
    for entry in objects:
        table = safe_identifier(entry["name"])
        if int(entry["row_count"]) == 0:
            continue
        expected_columns = None
        for part_index, (source, source_row_count) in enumerate(object_sources(entry)):
            if source_row_count == 0:
                continue
            target = workspace / f"{table}.{part_index:03d}.tsv"
            columns = write_plain_tsv(source, target)
            if expected_columns is None:
                expected_columns = columns
            elif columns != expected_columns:
                raise SystemExit(f"fixture part columns differ for {table}: {source}")
            column_header = ",".join(columns)
            label = f"devkit_{table}_{os.environ['LOAD_RUN_ID']}_{entry['sha256'][:8]}_{part_index:03d}"
            response = workspace / f"stream-load-{table}-{part_index:03d}.json"
            handle.write(
                "curl --fail --silent --show-error --location-trusted "
                "--connect-to \"127.0.0.1:8040:${STARROCKS_HOST}:8040\" "
                f"-u \"${{STARROCKS_USER}}:${{STARROCKS_PASSWORD}}\" "
                "-H 'Expect:100-continue' "
                f"-H {shlex.quote('label:' + label)} "
                "-H $'column_separator:\\t' "
                "-H 'skip_header:1' "
                f"-H {shlex.quote('columns:' + column_header)} "
                f"-T {shlex.quote(str(target))} "
                f"\"http://${{STARROCKS_HOST}}:${{STARROCKS_HTTP_PORT}}/api/bittensor/{table}/_stream_load\" "
                f"> {shlex.quote(str(response))}\n"
                f"python3 - {shlex.quote(str(response))} <<'CHECK'\n"
                "import json\n"
                "import sys\n"
                "from pathlib import Path\n"
                "payload = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))\n"
                "if payload.get('Status') not in {'Success', 'Publish Timeout'}:\n"
                "    raise SystemExit(f\"stream load failed: {payload}\")\n"
                "CHECK\n"
            )
PY

STARROCKS_HOST="$STARROCKS_HOST" \
STARROCKS_HTTP_PORT="$STARROCKS_HTTP_PORT" \
STARROCKS_USER="$STARROCKS_USER" \
STARROCKS_PASSWORD="$STARROCKS_PASSWORD" \
  bash "$WORKSPACE/devkit-starrocks/stream-load.sh"

python3 - "$DEVKIT_ROOT/data/manifest.json" "$WORKSPACE/devkit-starrocks/counts.sql" <<'PY'
import json
import sys
from pathlib import Path

manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
output = Path(sys.argv[2])
objects = [entry for entry in manifest["objects"] if entry["database"] == "bittensor"]
with output.open("w", encoding="utf-8") as handle:
    for entry in objects:
        handle.write(f"SELECT '{entry['name']}', COUNT(*) FROM bittensor.{entry['name']};\n")
PY

MYSQL_PWD="$STARROCKS_PASSWORD" "$MYSQL_BIN" \
  --host="$STARROCKS_HOST" \
  --port="$STARROCKS_PORT" \
  --user="$STARROCKS_USER" \
  --batch \
  --raw \
  --skip-column-names \
  < "$WORKSPACE/devkit-starrocks/counts.sql" \
  > "$WORKSPACE/devkit-starrocks/counts.tsv"

python3 - "$DEVKIT_ROOT/data/manifest.json" "$WORKSPACE/devkit-starrocks/counts.tsv" "$WORKSPACE/devkit-starrocks-import.json" <<'PY'
import json
import sys
from pathlib import Path

manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
expected = {
    entry["name"]: int(entry["row_count"])
    for entry in manifest["objects"]
    if entry["database"] == "bittensor"
}
actual = {}
for line in Path(sys.argv[2]).read_text(encoding="utf-8").splitlines():
    table, count = line.split("\t")
    actual[table] = int(count)
if expected != actual:
    raise SystemExit(f"StarRocks row counts mismatch: expected={expected} actual={actual}")
Path(sys.argv[3]).write_text(json.dumps({"tables": actual}, indent=2) + "\n", encoding="utf-8")
PY
