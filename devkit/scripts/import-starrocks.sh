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

python3 "$SCRIPT_DIR/starrocks-ddl.py" > "$WORKSPACE/devkit-starrocks/schema.sql"
MYSQL_PWD="$STARROCKS_PASSWORD" "$MYSQL_BIN" \
  --host="$STARROCKS_HOST" \
  --port="$STARROCKS_PORT" \
  --user="$STARROCKS_USER" \
  < "$WORKSPACE/devkit-starrocks/schema.sql"

python3 - "$DEVKIT_ROOT/data/manifest.json" "$WORKSPACE/devkit-starrocks/load.sql" <<'PY'
import json
import sys
from pathlib import Path

manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
output = Path(sys.argv[2])
lines = []
for entry in manifest["objects"]:
    table = entry["name"]
    source = Path(sys.argv[1]).parent / entry["path"]
    plain = output.parent / f"{table}.tsv"
    lines.append((table, source, plain))
with output.open("w", encoding="utf-8") as handle:
    for table, _source, plain in lines:
        handle.write(
            "LOAD DATA LOCAL INFILE "
            f"'{plain}' INTO TABLE bittensor_semantic.{table} "
            "FIELDS TERMINATED BY '\\t' LINES TERMINATED BY '\\n' (raw_line);\n"
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
