#!/usr/bin/env python3
import json
import os
import re
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
DEVKIT_ROOT = SCRIPT_DIR.parent
MANIFEST = DEVKIT_ROOT / "data/manifest.json"
# Graph node/edge → StarRocks table+column mapping. Post MemGQL retirement the
# canonical source is the devkit's own vendored translator asset
# (chain-insights-graph-devkit/internal/cyphersql/mapping.json); the old
# data-pipeline federation mapping is deleted. In-container it is provided at
# /mapping via a compose bind; on host it is read directly.
VENDORED_MAPPING = (
    DEVKIT_ROOT / "chain-insights-graph-devkit/internal/cyphersql/mapping.json"
)
MAPPING_CANDIDATES = [
    Path(os.environ["MEMGQL_STARROCKS_MAPPING_FILE"])
    if os.environ.get("MEMGQL_STARROCKS_MAPPING_FILE")
    else None,
    Path("/mapping/chain_insights_starrocks_mapping.json"),
    VENDORED_MAPPING,
]

COMPATIBILITY_COLUMNS_BY_TABLE = {
    "facts_address_features_view": {
        "active_days": "activity_span_days",
    },
}

# Every column defaults to VARCHAR(4096) below; typed overrides go here.
# The facts views the translator now serves carry no columns needing a typed
# override (is_exchange and the other Address enrichment properties are a
# native Memgraph/topology concern and never load through StarRocks).
COLUMN_TYPE_OVERRIDES_BY_TABLE: dict[str, dict[str, str]] = {}


def read_manifest() -> dict | None:
    if not MANIFEST.is_file():
        return None
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def read_mapping() -> dict:
    for candidate in MAPPING_CANDIDATES:
        if candidate is not None and candidate.is_file():
            return json.loads(candidate.read_text(encoding="utf-8"))
    raise SystemExit(f"MemGQL mapping file not found; checked {MAPPING_CANDIDATES}")


def require_identifier(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value):
        raise SystemExit(f"unsafe SQL identifier: {value}")
    return value


def mapped_columns_by_table() -> dict[str, list[str]]:
    mapping = read_mapping()
    columns: dict[str, list[str]] = {}

    def add_column(table: str, column: str) -> None:
        table = require_identifier(table)
        column = require_identifier(column)
        table_columns = columns.setdefault(table, [])
        if column not in table_columns:
            table_columns.append(column)

    for node in mapping["nodes"]:
        table = node["table"]
        add_column(table, node["id_column"])
        for column in node.get("properties", {}).values():
            add_column(table, column)
    for edge in mapping["edges"]:
        table = edge["table"]
        add_column(table, edge["id_column"])
        add_column(table, edge["source_column"])
        add_column(table, edge["target_column"])
        for column in edge.get("properties", {}).values():
            add_column(table, column)
    for table, compatibility_columns in COMPATIBILITY_COLUMNS_BY_TABLE.items():
        for column in compatibility_columns:
            add_column(table, column)
    return columns


def quote_identifier(value: str) -> str:
    return f"`{require_identifier(value)}`"


def table_sql(table: str, columns: list[str]) -> str:
    table = require_identifier(table)
    if not columns:
        raise SystemExit(f"mapped table has no columns: {table}")
    type_overrides = COLUMN_TYPE_OVERRIDES_BY_TABLE.get(table, {})
    column_sql = ",\n".join(
        f"  {quote_identifier(column)} {type_overrides.get(column, 'VARCHAR(4096)')}"
        for column in columns
    )
    key = quote_identifier(columns[0])
    return f"""CREATE TABLE IF NOT EXISTS bittensor.{table} (
{column_sql}
)
ENGINE=OLAP
DUPLICATE KEY({key})
DISTRIBUTED BY HASH({key}) BUCKETS 1
PROPERTIES (
  "replication_num" = "1"
);
TRUNCATE TABLE bittensor.{table};"""


def main() -> None:
    manifest = read_manifest()
    mapped_columns = mapped_columns_by_table()
    print("CREATE DATABASE IF NOT EXISTS bittensor;")
    print("CREATE DATABASE IF NOT EXISTS bittensor_evm;")
    if manifest is None:
        for table in sorted(mapped_columns):
            print(table_sql(table, mapped_columns[table]))
        return
    for entry in manifest["objects"]:
        if entry["database"] != "bittensor":
            continue
        table = entry["name"]
        if table not in mapped_columns:
            raise SystemExit(f"manifest object is not in MemGQL mapping: {table}")
        print(table_sql(table, mapped_columns[table]))


if __name__ == "__main__":
    main()
