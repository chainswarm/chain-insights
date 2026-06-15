#!/usr/bin/env python3
import json
import os
import sys
import urllib.request
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[4]
MAPPING = REPO_ROOT / "repos/ml/data-pipeline/ops/memgql/chain_insights_starrocks_mapping.json"
ENDPOINT = os.environ.get("CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT", "http://127.0.0.1:18012/mcp")
NETWORK = os.environ.get("CHAIN_INSIGHTS_DEVKIT_NETWORK", "bittensor")


def layer_for_table(table: str) -> str:
    return "facts" if table.startswith("facts_") else "archive_topology"


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


def row_count(result: dict) -> int:
    rows = result.get("rows", [])
    if not rows:
        return 0
    value = rows[0].get("row_count", 0)
    return int(value)


def main() -> None:
    mapping = json.loads(MAPPING.read_text(encoding="utf-8"))
    checks: list[dict] = []

    for node in mapping["nodes"]:
        query = (
            f"USE {layer_for_table(node['table'])} "
            f"MATCH (n:{node['label']}) RETURN count(n) AS row_count LIMIT 1"
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
        query = (
            f"USE {layer_for_table(edge['table'])} "
            f"MATCH (src:{edge['source_label']})-[r:{edge['rel_type']}]->(dst:{edge['target_label']}) "
            "RETURN count(r) AS row_count LIMIT 1"
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
    for check in checks:
        try:
            result = graph_query(check["query"])
            check["ok"] = True
            check["row_count"] = row_count(result)
        except Exception as err:
            check["ok"] = False
            check["error"] = str(err)
            failures.append(check)

    document = {
        "schema": "chain-insights.devkit.memgql-object-coverage.v1",
        "network": NETWORK,
        "endpoint": ENDPOINT,
        "mapping": str(MAPPING.relative_to(REPO_ROOT)),
        "summary": {
            "checks": len(checks),
            "nodes": sum(1 for check in checks if check["kind"] == "node"),
            "relationships": sum(1 for check in checks if check["kind"] == "relationship"),
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
