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
    # Production FLOWS_TO edges carry first/last_seen_timestamp (epoch
    # MILLISECONDS -- `_timestamp` fields are points in time in ms
    # everywhere), first/last_tx_id anchors, and amount/count fields. The
    # flows.csv fixture has only from/to columns, so seed deterministic
    # production-shaped properties: a bare edge would leave the render-layer
    # verdict path (computeVerdict over edge timestamps) unexercised locally.
    first_seen_ms = 1735569036000  # 2024-12-30T13:50:36Z, fixture era
    last_seen_ms = 1753000000000  # 2025-07-20T08:26:40Z
    print(
        'LOAD CSV FROM "/data/memgraph/flows.csv" WITH HEADER AS row '
        "MATCH (from:Address {address: row.from_address}) "
        "MATCH (to:Address {address: row.to_address}) "
        "MERGE (from)-[r:FLOWS_TO]->(to) "
        f"ON CREATE SET r.first_seen_timestamp = {first_seen_ms}, "
        f"r.last_seen_timestamp = {last_seen_ms}, "
        'r.first_tx_id = "devkit-first-" + row.from_address + "-" + row.to_address, '
        'r.last_tx_id = "devkit-last-" + row.from_address + "-" + row.to_address, '
        "r.amount_usd_sum = 0.0, "
        "r.tx_count = 1;"
    )


if __name__ == "__main__":
    main()
