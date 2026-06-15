#!/usr/bin/env python3
from pathlib import Path


DEVKIT_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = DEVKIT_ROOT / "data/memgraph"

FILES = {
    "identities": DATA_ROOT / "identities.csv",
    "addresses": DATA_ROOT / "addresses.csv",
    "identity_addresses": DATA_ROOT / "identity_addresses.csv",
    "flows": DATA_ROOT / "flows.csv",
}


def require_files() -> None:
    missing = [str(path) for path in FILES.values() if not path.is_file()]
    if missing:
        raise SystemExit(f"missing Memgraph fixture files: {missing}")


def main() -> None:
    require_files()
    print("MATCH (n) DETACH DELETE n;")
    print("CREATE INDEX ON :Identity(identity_id);")
    print("CREATE INDEX ON :Address(address);")
    print(
        'LOAD CSV FROM "/data/memgraph/identities.csv" WITH HEADER AS row '
        "MERGE (:Identity {identity_id: row.identity_id});"
    )
    print(
        'LOAD CSV FROM "/data/memgraph/addresses.csv" WITH HEADER AS row '
        "MERGE (:Address {address: row.address, network: row.network});"
    )
    print(
        'LOAD CSV FROM "/data/memgraph/identity_addresses.csv" WITH HEADER AS row '
        "MATCH (i:Identity {identity_id: row.identity_id}) "
        "MATCH (a:Address {address: row.address}) "
        "MERGE (i)-[:HAS_ADDRESS]->(a);"
    )
    print(
        'LOAD CSV FROM "/data/memgraph/flows.csv" WITH HEADER AS row '
        "MATCH (from:Identity {identity_id: row.from_identity}) "
        "MATCH (to:Identity {identity_id: row.to_identity}) "
        "MERGE (from)-[:FLOWS_TO]->(to);"
    )


if __name__ == "__main__":
    main()
