#!/usr/bin/env python3
import argparse
import gzip
import json
import os
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

from neo4j import GraphDatabase


SCRIPT_DIR = Path(__file__).resolve().parent
DEVKIT_ROOT = SCRIPT_DIR.parent
DEFAULT_DATA_ROOT = DEVKIT_ROOT / "data/memgraph"
IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
NODE_BATCH_SIZE = 1000
RELATIONSHIP_BATCH_SIZE = 1000


def validate_identifier(kind: str, value: str) -> None:
    if not IDENTIFIER_PATTERN.match(value):
        raise SystemExit(f"unsafe Memgraph {kind} identifier in fixture import: {value}")


def cypher_label(label: str) -> str:
    validate_identifier("node label", label)
    return f":`{label}`"


def cypher_relationship_type(relationship_type: str) -> str:
    validate_identifier("relationship type", relationship_type)
    return f"`{relationship_type}`"


def read_json_lines(path: Path) -> Iterable[dict[str, Any]]:
    if not path.is_file():
        raise SystemExit(f"missing Memgraph JSONL fixture file: {path}")
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            text = line.strip()
            if not text:
                continue
            payload = json.loads(text)
            if not isinstance(payload, dict):
                raise SystemExit(f"{path}:{line_number} is not a JSON object")
            yield payload


def batches(rows: Iterable[dict[str, Any]], batch_size: int) -> Iterable[list[dict[str, Any]]]:
    batch: list[dict[str, Any]] = []
    for row in rows:
        batch.append(row)
        if len(batch) == batch_size:
            yield batch
            batch = []
    if batch:
        yield batch


def grouped_nodes(data_root: Path) -> dict[tuple[str, ...], list[dict[str, Any]]]:
    groups: dict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(list)
    for row in read_json_lines(data_root / "nodes.jsonl.gz"):
        labels = tuple(sorted(str(label) for label in row.get("labels", [])))
        if not labels:
            raise SystemExit(f"node fixture row has no labels: {row}")
        if "GlobalState" in labels:
            raise SystemExit("Memgraph fixture must not import GlobalState")
        for label in labels:
            validate_identifier("node label", label)
        properties = row.get("properties", {})
        if not isinstance(properties, dict):
            raise SystemExit(f"node fixture properties must be an object: {row}")
        groups[labels].append({"id": str(row["id"]), "properties": properties})
    return groups


def grouped_relationships(data_root: Path) -> dict[str, list[dict[str, Any]]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in read_json_lines(data_root / "relationships.jsonl.gz"):
        relationship_type = str(row["type"])
        validate_identifier("relationship type", relationship_type)
        properties = row.get("properties", {})
        if not isinstance(properties, dict):
            raise SystemExit(f"relationship fixture properties must be an object: {row}")
        groups[relationship_type].append(
            {
                "start_id": str(row["start_id"]),
                "end_id": str(row["end_id"]),
                "properties": properties,
            }
        )
    return groups


def execute_schema(session: Any) -> None:
    statements = [
        "MATCH (node) DETACH DELETE node",
        "CREATE INDEX ON :DevkitFixture(_devkit_export_id)",
        "CREATE INDEX ON :Identity(identity_id);",
        "CREATE INDEX ON :Address(address);",
        "CREATE INDEX ON :Subnet(netuid);",
    ]
    for statement in statements:
        session.run(statement).consume()


def import_nodes(session: Any, node_groups: dict[tuple[str, ...], list[dict[str, Any]]]) -> int:
    imported = 0
    for labels, rows in node_groups.items():
        label_clause = "".join(cypher_label(label) for label in labels)
        query = f"""
UNWIND $rows AS row
CREATE (node:DevkitFixture{label_clause} {{_devkit_export_id: row.id}})
SET node += row.properties
"""
        for batch in batches(rows, NODE_BATCH_SIZE):
            session.run(query, rows=batch).consume()
            imported += len(batch)
    return imported


def import_relationships(session: Any, relationship_groups: dict[str, list[dict[str, Any]]]) -> int:
    imported = 0
    for relationship_type, rows in relationship_groups.items():
        relationship_type_clause = cypher_relationship_type(relationship_type)
        query = f"""
UNWIND $rows AS row
MATCH (start:DevkitFixture {{_devkit_export_id: row.start_id}})
MATCH (end:DevkitFixture {{_devkit_export_id: row.end_id}})
CREATE (start)-[relationship:{relationship_type_clause}]->(end)
SET relationship += row.properties
"""
        for batch in batches(rows, RELATIONSHIP_BATCH_SIZE):
            session.run(query, rows=batch).consume()
            imported += len(batch)
    return imported


def remove_fixture_import_keys(session: Any) -> None:
    session.run(
        """
MATCH (node:DevkitFixture)
REMOVE node:DevkitFixture
REMOVE node._devkit_export_id
"""
    ).consume()


def write_import_summary(
    session: Any,
    output_path: Path,
    imported_nodes: int,
    imported_relationships: int,
    relationship_groups: dict[str, list[dict[str, Any]]],
) -> None:
    counts: dict[str, int] = {
        "Node": imported_nodes,
        "Relationship": imported_relationships,
    }
    for label in ("Identity", "Address", "Subnet", "Scam", "Victim", "Exchange"):
        result = session.run(f"MATCH (node:`{label}`) RETURN count(node) AS count").single()
        counts[label] = int(result["count"]) if result is not None else 0
    for relationship_type in sorted(relationship_groups):
        result = session.run(
            f"MATCH ()-[relationship:`{relationship_type}`]->() RETURN count(relationship) AS count"
        ).single()
        counts[relationship_type] = int(result["count"]) if result is not None else 0
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps({"counts": counts}, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=os.environ.get("MEMGRAPH_HOST", "memgraph"))
    parser.add_argument("--port", default=os.environ.get("MEMGRAPH_PORT", "7687"))
    parser.add_argument("--data-root", default=str(DEFAULT_DATA_ROOT))
    parser.add_argument("--output", required=True)
    arguments = parser.parse_args()

    data_root = Path(arguments.data_root)
    node_groups = grouped_nodes(data_root)
    relationship_groups = grouped_relationships(data_root)

    uri = f"bolt://{arguments.host}:{arguments.port}"
    driver = GraphDatabase.driver(uri, auth=None)
    try:
        with driver.session() as session:
            execute_schema(session)
            imported_nodes = import_nodes(session, node_groups)
            imported_relationships = import_relationships(session, relationship_groups)
            remove_fixture_import_keys(session)
            write_import_summary(
                session,
                Path(arguments.output),
                imported_nodes,
                imported_relationships,
                relationship_groups,
            )
    finally:
        driver.close()


if __name__ == "__main__":
    main()
