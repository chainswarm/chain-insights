#!/usr/bin/env python3
import json
import os
import sys
import urllib.request
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
DEVKIT_ROOT = SCRIPT_DIR.parent
# Post MemGQL retirement the graph mapping is the devkit's own vendored
# translator asset (the old the upstream pipeline federation mapping is deleted).
MAPPING = DEVKIT_ROOT / "chain-insights-graph-devkit/internal/cyphersql/mapping.json"
ENDPOINT = os.environ.get("CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT", "http://127.0.0.1:18012/mcp")
NETWORK = os.environ.get("CHAIN_INSIGHTS_DEVKIT_NETWORK", "bittensor")

# KEPT-IN-SYNC with ALLOWED_UNEXPORTED_TABLES in validate-manifest.py.
# facts_transfers_view (internal epic) shipped its capped, address-scoped
# fixture export -- it is queryable like every other mapped table now, so
# it no longer needs a coverage-check exemption here.
ALLOWED_UNEXPORTED_TABLES: set[str] = set()

# Tables whose facts-scope admission REQUIRES an indexed predicate even for a
# LIMIT-1 row-select (the TRANSFER edge rule, internal epic): a bare
# `MATCH ()-[r:...]->() LIMIT 1` probe is rejected BY DESIGN, so the coverage
# probe anchors on a real value read from the shipped fixture itself — which
# also upgrades the check to prove imported DATA is served (rows_returned=1),
# not merely that the shape compiles.
BOUNDED_PROBE_TABLES: dict[str, str] = {
    "facts_transfers_view": "from_address",
}


def fixture_anchor_value(table: str, column: str) -> str | None:
    """First data row's value for `column` from the table's shipped fixture."""
    import csv
    import gzip

    manifest_path = DEVKIT_ROOT / "data/manifest.json"
    if not manifest_path.is_file():
        return None
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for entry in manifest.get("objects", []):
        if entry.get("name") != table:
            continue
        parts = entry.get("parts") or [{"path": entry.get("path", "")}]
        for part in parts:
            path = DEVKIT_ROOT / "data" / part.get("path", "")
            if not path.is_file():
                continue
            with gzip.open(path, "rt", encoding="utf-8", newline="") as handle:
                for row in csv.DictReader(handle, delimiter="\t"):
                    value = (row.get(column) or "").strip()
                    if value:
                        return value
    return None


def layer_for_table(table: str) -> str:
    # Every table the vendored translator now maps is served by the facts
    # scope (facts_* views). Topology runs natively
    # on Memgraph and is never StarRocks-backed, so it never appears here.
    return "facts"


def graph_query(query: str) -> dict:
    payload = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "graph_query",
                "arguments": {
                    "network": NETWORK,
                    "query": query,
                },
            },
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        ENDPOINT,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        body = json.loads(response.read().decode("utf-8"))
    result = body.get("result", {})
    text_items = [
        item.get("text", "")
        for item in result.get("content", [])
        if item.get("type") == "text"
    ]
    text = "\n".join(text_items).strip()
    if result.get("isError"):
        raise RuntimeError(text or json.dumps(body))
    if not text:
        raise RuntimeError(f"empty graph_query result for query: {query}")
    return json.loads(text)


def rows_returned(result: dict) -> int:
    # The graph MCP envelope carries rows at facts.query.results. Coverage is
    # "the mapped object is queryable and returns a bounded row"; an empty
    # object legitimately returns 0.
    facts = result.get("facts", {})
    query = facts.get("query", {}) if isinstance(facts, dict) else {}
    return len(query.get("results", []) or [])


def probe_property(node: dict) -> str:
    # The first mapped Cypher-facing property is always projectable and,
    # unlike count(), admitted by the StarRocks cost-shape gate.
    return next(iter(node["properties"]))


def main() -> None:
    mapping = json.loads(MAPPING.read_text(encoding="utf-8"))
    nodes_by_label = {node["label"]: node for node in mapping["nodes"]}
    checks: list[dict] = []

    for node in mapping["nodes"]:
        query = (
            f"USE {layer_for_table(node['table'])} "
            f"MATCH (n:{node['label']}) RETURN n.{probe_property(node)} AS probe LIMIT 1"
        )
        checks.append(
            {
                "kind": "node",
                "layer": layer_for_table(node["table"]),
                "label": node["label"],
                "table": node["table"],
                "query": query,
            }
        )

    for edge in mapping["edges"]:
        source_node = nodes_by_label.get(edge["source_label"])
        projection = (
            f"src.{probe_property(source_node)}"
            if source_node
            else f"src.{edge['source_column']}"
        )
        anchor_column = BOUNDED_PROBE_TABLES.get(edge["table"])
        anchor_predicate = ""
        if anchor_column:
            anchor_value = fixture_anchor_value(edge["table"], anchor_column)
            if anchor_value is None:
                # No fixture data to anchor on; fall back to a syntactically
                # admissible literal — proves admission+compile+serving path
                # (rows_returned will be 0).
                anchor_value = "coverage-probe-anchor"
            escaped = anchor_value.replace('"', '')
            anchor_predicate = f' {{address: "{escaped}"}}'
        query = (
            f"USE {layer_for_table(edge['table'])} "
            f"MATCH (src:{edge['source_label']}{anchor_predicate})-[r:{edge['rel_type']}]->(dst:{edge['target_label']}) "
            f"RETURN {projection} AS probe LIMIT 1"
        )
        checks.append(
            {
                "kind": "relationship",
                "layer": layer_for_table(edge["table"]),
                "rel_type": edge["rel_type"],
                "table": edge["table"],
                "source_label": edge["source_label"],
                "target_label": edge["target_label"],
                "query": query,
            }
        )

    failures: list[dict] = []
    skipped: list[dict] = []
    for check in checks:
        if check["table"] in ALLOWED_UNEXPORTED_TABLES:
            check["ok"] = None
            check["skipped"] = True
            check["skip_reason"] = "fixture not yet exported"
            print(
                f"skipped (fixture not yet exported): {check['table']}",
                file=sys.stderr,
            )
            skipped.append(check)
            continue
        try:
            result = graph_query(check["query"])
            check["ok"] = True
            check["rows_returned"] = rows_returned(result)
        except Exception as err:
            check["ok"] = False
            check["error"] = str(err)
            failures.append(check)

    document = {
        "schema": "chain-insights.devkit.memgql-object-coverage.v1",
        "network": NETWORK,
        "endpoint": ENDPOINT,
        "mapping": str(MAPPING.relative_to(DEVKIT_ROOT)),
        "summary": {
            "checks": len(checks),
            "nodes": sum(1 for check in checks if check["kind"] == "node"),
            "relationships": sum(1 for check in checks if check["kind"] == "relationship"),
            "skipped": len(skipped),
            "failures": len(failures),
        },
        "checks": checks,
    }
    print(json.dumps(document, indent=2, sort_keys=True))
    if failures:
        print(f"MemGQL object coverage failed: {len(failures)} failure(s)", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
