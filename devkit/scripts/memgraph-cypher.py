#!/usr/bin/env python3
from pathlib import Path


DEVKIT_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = DEVKIT_ROOT / "data/memgraph"

FILES = {
    "addresses": DATA_ROOT / "addresses.csv",
    "flows": DATA_ROOT / "flows.csv",
}


def require_files() -> None:
    missing = [str(path) for path in FILES.values() if not path.is_file()]
    if missing:
        raise SystemExit(f"missing Memgraph fixture files: {missing}")


def main() -> None:
    print("MATCH (n) DETACH DELETE n;")
    print("CREATE INDEX ON :Address(address);")
    print(
        'LOAD CSV FROM "/data/memgraph/addresses.csv" WITH HEADER AS row '
        "MERGE (:Address {address: row.address, network: row.network});"
    )
    print(
        'LOAD CSV FROM "/data/memgraph/flows.csv" WITH HEADER AS row '
        "MATCH (from:Address {address: row.from_address}) "
        "MATCH (to:Address {address: row.to_address}) "
        "MERGE (from)-[:FLOWS_TO]->(to);"
    )


if __name__ == "__main__":
    main()
