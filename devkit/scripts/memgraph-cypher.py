#!/usr/bin/env python3
# Manual dev utility (no caller in this tree): prints the Cypher a fresh
# devkit Memgraph load would run. Memgraph's own LOAD CSV clause cannot
# read gzip, and the committed source is addresses.csv.gz/flows.csv.gz --
# split into sorted <name>.gz.part-NNN.gz siblings once a file would
# exceed ~40MB (GitHub warns at 50MB, hard-blocks the push at 100MB; the
# address-grain revert's edge-count growth made splitting routine, not
# exceptional) -- the operator must gunzip a concatenated working copy
# into the mounted data dir first, e.g.:
#   for f in addresses flows; do
#     if [ -f "data/memgraph/$f.csv.gz" ]; then
#       gunzip -k "data/memgraph/$f.csv.gz"
#     else
#       zcat data/memgraph/$f.csv.gz.part-*.gz \
#         | awk 'NR==1 || !/^address,network$|^from_address,to_address$/' \
#         > "data/memgraph/$f.csv"
#     fi
#   done
# (the compose mount is read-only from inside the container, so the
# decompression/concatenation has to happen host-side before mgconsole
# runs this output; the awk keeps only the very first header line since
# every part repeats its own).
from pathlib import Path


DEVKIT_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = DEVKIT_ROOT / "data/memgraph"

FILES = {
    "addresses": DATA_ROOT / "addresses.csv.gz",
    "flows": DATA_ROOT / "flows.csv.gz",
}


def require_files() -> None:
    missing = [
        str(path)
        for path in FILES.values()
        if not path.is_file() and not list(path.parent.glob(f"{path.name}.part-*.gz"))
    ]
    if missing:
        raise SystemExit(f"missing Memgraph fixture files (or their .part-*.gz siblings): {missing}")


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
