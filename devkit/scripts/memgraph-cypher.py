#!/usr/bin/env python3
# Manual dev utility (no caller in this tree): prints the Cypher a fresh
# devkit Memgraph load would run. Memgraph's own LOAD CSV clause cannot
# read gzip, and the committed source files are addresses.csv.gz/flows.csv.gz
# (GitHub's 100MB file-size limit forced compression once the address-grain
# revert's edge count made the address-grain flows.csv exceed it) — the
# operator must gunzip a working copy into the mounted data dir first:
#   gunzip -k data/memgraph/addresses.csv.gz data/memgraph/flows.csv.gz
# (the compose mount is read-only from inside the container, so the
# decompression has to happen host-side before mgconsole runs this output).
from pathlib import Path


DEVKIT_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = DEVKIT_ROOT / "data/memgraph"

FILES = {
    "addresses": DATA_ROOT / "addresses.csv.gz",
    "flows": DATA_ROOT / "flows.csv.gz",
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
