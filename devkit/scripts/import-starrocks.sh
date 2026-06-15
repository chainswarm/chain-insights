#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVKIT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"
WORKSPACE="$REPO_ROOT/workspace"
MYSQL_BIN="${MYSQL_BIN:-mysql}"
STARROCKS_HOST="${STARROCKS_HOST:-starrocks}"
STARROCKS_PORT="${STARROCKS_PORT:-9030}"
STARROCKS_USER="${STARROCKS_USER:-root}"
STARROCKS_PASSWORD="${STARROCKS_PASSWORD:-}"
MEMGQL_STARROCKS_MAPPING_FILE="${MEMGQL_STARROCKS_MAPPING_FILE:-/mapping/chain_insights_starrocks_mapping.json}"
if [ ! -f "$MEMGQL_STARROCKS_MAPPING_FILE" ]; then
  MEMGQL_STARROCKS_MAPPING_FILE="$REPO_ROOT/repos/ml/data-pipeline/ops/memgql/chain_insights_starrocks_mapping.json"
fi
export MEMGQL_STARROCKS_MAPPING_FILE

mkdir -p "$WORKSPACE/devkit-starrocks"
command -v "$MYSQL_BIN" >/dev/null
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

python3 - "$DEVKIT_ROOT/data/manifest.json" "$WORKSPACE/devkit-starrocks/load.sql" <<'PY'
import gzip
import json
import sys
from pathlib import Path

manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
output = Path(sys.argv[2])


def sql_string(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "''") + "'"


def rows_from_fixture(source: Path) -> tuple[list[str], list[list[str]]]:
    with source.open("rb") as raw:
        prefix = raw.read(2)
    opener = gzip.open if prefix == b"\x1f\x8b" else open
    with opener(source, "rt", encoding="utf-8", newline="") as handle:
        header = handle.readline().rstrip("\n")
        if not header:
            raise SystemExit(f"fixture file has no header row: {source}")
        columns = header.split("\t")
        for column in columns:
            if not column or not column.replace("_", "").isalnum() or column[0].isdigit():
                raise SystemExit(f"unsafe TSV column {column!r} in {source}")
        rows = [line.rstrip("\n").split("\t") for line in handle if line.rstrip("\n")]
    for row in rows:
        if len(row) != len(columns):
            raise SystemExit(f"fixture row has {len(row)} values, expected {len(columns)}: {source}")
    return columns, rows


with output.open("w", encoding="utf-8") as handle:
    for entry in manifest["objects"]:
        table = entry["name"]
        source = Path(sys.argv[1]).parent / entry["path"]
        columns, rows = rows_from_fixture(source)
        if not rows:
            continue
        column_sql = ", ".join(f"`{column}`" for column in columns)
        for row in rows:
            value_sql = ", ".join(sql_string(value) for value in row)
            handle.write(
                f"INSERT INTO bittensor_semantic.{table} ({column_sql}) "
                f"VALUES ({value_sql});\n"
            )
PY

python3 - "$DEVKIT_ROOT/data/manifest.json" "$WORKSPACE/devkit-starrocks" <<'PY'
import gzip
import json
import shutil
import sys
from pathlib import Path

manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
workspace = Path(sys.argv[2])
data_root = Path(sys.argv[1]).parent
for entry in manifest["objects"]:
    source = data_root / entry["path"]
    target = workspace / f"{entry['name']}.tsv"
    with source.open("rb") as raw:
        prefix = raw.read(2)
    if prefix == b"\x1f\x8b":
        with gzip.open(source, "rb") as src, target.open("wb") as dst:
            shutil.copyfileobj(src, dst)
    else:
        shutil.copyfile(source, target)
PY

MYSQL_PWD="$STARROCKS_PASSWORD" "$MYSQL_BIN" \
  --host="$STARROCKS_HOST" \
  --port="$STARROCKS_PORT" \
  --user="$STARROCKS_USER" \
  --local-infile=1 \
  < "$WORKSPACE/devkit-starrocks/load.sql"

python3 - "$DEVKIT_ROOT/data/manifest.json" "$WORKSPACE/devkit-starrocks/counts.sql" <<'PY'
import json
import sys
from pathlib import Path

manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
output = Path(sys.argv[2])
with output.open("w", encoding="utf-8") as handle:
    for entry in manifest["objects"]:
        handle.write(f"SELECT '{entry['name']}', COUNT(*) FROM bittensor_semantic.{entry['name']};\n")
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
expected = {entry["name"]: int(entry["row_count"]) for entry in manifest["objects"]}
actual = {}
for line in Path(sys.argv[2]).read_text(encoding="utf-8").splitlines():
    table, count = line.split("\t")
    actual[table] = int(count)
if expected != actual:
    raise SystemExit(f"StarRocks row counts mismatch: expected={expected} actual={actual}")
Path(sys.argv[3]).write_text(json.dumps({"tables": actual}, indent=2) + "\n", encoding="utf-8")
PY
