#!/usr/bin/env python3
import json
import re
from pathlib import Path


DEVKIT_ROOT = Path(__file__).resolve().parents[1]
MANIFEST = DEVKIT_ROOT / "data/manifest.json"


def read_manifest() -> dict:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def require_identifier(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value):
        raise SystemExit(f"unsafe SQL identifier: {value}")
    return value


def table_sql(table: str) -> str:
    table = require_identifier(table)
    return f"""CREATE TABLE IF NOT EXISTS bittensor_semantic.{table} (
  raw_line VARCHAR(65533)
)
ENGINE=OLAP
DUPLICATE KEY(raw_line)
DISTRIBUTED BY HASH(raw_line) BUCKETS 1
PROPERTIES (
  "replication_num" = "1"
);
TRUNCATE TABLE bittensor_semantic.{table};"""


def main() -> None:
    manifest = read_manifest()
    print("CREATE DATABASE IF NOT EXISTS bittensor_semantic;")
    print("CREATE DATABASE IF NOT EXISTS bittensor;")
    print("CREATE DATABASE IF NOT EXISTS bittensor_evm;")
    for entry in manifest["objects"]:
        if entry["database"] != "bittensor_semantic":
            raise SystemExit(f"unexpected object database: {entry['database']}")
        print(table_sql(entry["name"]))


if __name__ == "__main__":
    main()
