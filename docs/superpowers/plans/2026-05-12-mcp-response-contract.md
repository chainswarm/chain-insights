# MCP Response Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move GraphRAG and Chain Insights to an agent-safe MCP result contract where LLM-visible output is small and graph data travels only through `_meta`.

**Architecture:** GraphRAG remains the compute MCP and returns FastMCP `ToolResult` objects with `content`, compact `structured_content`, and graph data in `_meta.chainInsights.graph.data`. Chain Insights becomes the local agent-safe adapter: it persists that graph data under `~/.chain-insights/artifacts/`, serves it through Hono, and returns only a local graph pointer in `_meta`.

**Tech Stack:** Python 3.13, FastMCP 3.0, Pydantic 2, pytest, TypeScript, Node.js 22, MCP TS SDK 1.29, Hono, Vitest.

---

## File Structure

GraphRAG repo: `/home/aphex5/work/rbmk/repos/ml/graphrag`

- Modify `src/mcp_server/models.py`: add result-contract constants, output schema, and helper functions that build FastMCP `ToolResult`.
- Modify `src/query/compact.py`: replace `build_app_data_payload()` with `build_graph_payload()` using `edge_anchors`.
- Modify `src/mcp_server/tools/flow_anchors.py`: rename transfer-table helper semantics from `flow_edge_transfer_anchors()` to `flow_edge_anchor_rows()`.
- Modify `src/mcp_server/tools/intelligence.py`: return `ToolResult` for `address_risk`, with graph payload in `_meta`.
- Modify `src/mcp_server/tools/tracing.py`: return `ToolResult` for `track_funds`, `money_flows_between_exchanges`, and `address_connection_risk`.
- Modify `src/mcp_server/tools/raw_queries.py`: return `ToolResult` for `graph_query`.
- Modify `src/mcp_server/instructions.md`, `README.md`, and `CLAUDE.md`: document the new contract and remove inline `app_data` instructions.
- Modify tests under `tests/unit/` and `tests/acceptance/`: assert the new envelope, no `transfers`, no `app_data` in model-visible fields.

Chain Insights repo: `/home/aphex5/work/chain-insights`

- Create `src/mcp/artifacts.ts`: local graph artifact persistence and URL generation.
- Modify `src/mcp/proxy.ts`: normalize GraphRAG results, persist graph data from `_meta`, preserve compact result content.
- Modify `src/server/app.ts`: serve `GET /artifacts/:artifactId/graph.json`.
- Modify `src/viz/templates/graph.html`: load graph URL from `tool-result.params._meta.chainInsights.graph.url`.
- Modify `tests/mcp-proxy.test.ts`, `tests/viz-server.test.ts`, and `tests/viz-html-generator.test.ts`: cover artifact persistence and app loading path.
- Modify `README.md`: document the agent-safe MCP response flow.

## Task 1: Add GraphRAG Result Contract Helpers

**Files:**
- Modify: `/home/aphex5/work/rbmk/repos/ml/graphrag/src/mcp_server/models.py`
- Create: `/home/aphex5/work/rbmk/repos/ml/graphrag/tests/unit/test_mcp_response_contract.py`

- [ ] **Step 1: Write failing model/helper tests**

Create `/home/aphex5/work/rbmk/repos/ml/graphrag/tests/unit/test_mcp_response_contract.py`:

```python
import pytest


@pytest.mark.unit
def test_build_chain_insights_tool_result_puts_graph_in_meta_only():
    from mcp_server.models import build_chain_insights_tool_result

    result = build_chain_insights_tool_result(
        tool="address_risk",
        summary="## Risk Report\nSubject details.",
        hint="Use track_funds.",
        facts={"risk": {"score": 1, "level": "critical", "confidence": "high"}},
        graph_data={
            "schema": "chain-insights.graph.v1",
            "nodes": [{"address": "5Addr"}],
            "edges": [],
            "flows": [],
            "edge_anchors": [],
        },
    )
    mcp_result = result.to_mcp_result().model_dump(by_alias=True)

    assert mcp_result["content"] == [
        {"type": "text", "text": "## Risk Report\nSubject details."}
    ]
    assert mcp_result["structuredContent"]["schema"] == "chain-insights.result.v1"
    assert mcp_result["structuredContent"]["tool"] == "address_risk"
    assert mcp_result["structuredContent"]["hint"] == "Use track_funds."
    assert mcp_result["structuredContent"]["facts"]["risk"]["level"] == "critical"
    assert "app_data" not in mcp_result["structuredContent"]
    assert "risk_assessment" not in mcp_result["structuredContent"]
    assert mcp_result["_meta"]["chainInsights"]["graph"]["data"]["nodes"][0]["address"] == "5Addr"


@pytest.mark.unit
def test_risk_assessment_to_fact_uses_generic_risk_key():
    from mcp_server.models import RiskAssessmentDTO, RiskDriverDTO, risk_assessment_to_fact

    risk = RiskAssessmentDTO(
        score=0.8,
        level="critical",
        confidence="high",
        recommendation="Escalate.",
        drivers=[
            RiskDriverDTO(
                signal="HIGH_RISK_NODE",
                severity=0.4,
                description="High-risk node found.",
            )
        ],
    )

    assert risk_assessment_to_fact(risk) == {
        "score": 0.8,
        "level": "critical",
        "confidence": "high",
        "recommendation": "Escalate.",
        "drivers": [
            {
                "signal": "HIGH_RISK_NODE",
                "severity": 0.4,
                "description": "High-risk node found.",
                "evidence_addresses": [],
                "evidence_patterns": [],
            }
        ],
    }
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
PYTHONPATH=src uv run --extra dev pytest tests/unit/test_mcp_response_contract.py -q
```

Expected: FAIL because `build_chain_insights_tool_result` and `risk_assessment_to_fact` do not exist.

- [ ] **Step 3: Implement result helpers**

Modify `/home/aphex5/work/rbmk/repos/ml/graphrag/src/mcp_server/models.py`:

```python
from fastmcp.tools import ToolResult
from mcp.types import TextContent

CHAIN_INSIGHTS_RESULT_SCHEMA = "chain-insights.result.v1"
CHAIN_INSIGHTS_GRAPH_SCHEMA = "chain-insights.graph.v1"

CHAIN_INSIGHTS_RESULT_OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "schema": {"type": "string"},
        "tool": {"type": "string"},
        "hint": {"type": ["string", "null"]},
        "facts": {"type": "object", "additionalProperties": True},
    },
    "required": ["schema", "tool", "facts"],
    "additionalProperties": False,
}


def risk_assessment_to_fact(risk_assessment: RiskAssessmentDTO | None) -> dict[str, Any] | None:
    if risk_assessment is None:
        return None
    return risk_assessment.model_dump()


def build_chain_insights_structured_content(
    *,
    tool: str,
    hint: str | None,
    facts: dict[str, Any] | None,
) -> dict[str, Any]:
    return {
        "schema": CHAIN_INSIGHTS_RESULT_SCHEMA,
        "tool": tool,
        "hint": hint,
        "facts": facts or {},
    }


def build_chain_insights_meta(
    graph_data: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if graph_data is None:
        return None
    return {
        "chainInsights": {
            "graph": {
                "schema": CHAIN_INSIGHTS_GRAPH_SCHEMA,
                "data": graph_data,
            }
        }
    }


def build_chain_insights_tool_result(
    *,
    tool: str,
    summary: str,
    hint: str | None = None,
    facts: dict[str, Any] | None = None,
    graph_data: dict[str, Any] | None = None,
) -> ToolResult:
    return ToolResult(
        content=[TextContent(type="text", text=summary)],
        structured_content=build_chain_insights_structured_content(
            tool=tool,
            hint=hint,
            facts=facts,
        ),
        meta=build_chain_insights_meta(graph_data),
    )
```

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
PYTHONPATH=src uv run --extra dev pytest tests/unit/test_mcp_response_contract.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit GraphRAG helper work**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
git add src/mcp_server/models.py tests/unit/test_mcp_response_contract.py
git commit -m "feat(mcp): add agent-safe result contract helpers"
```

## Task 2: Replace Graph Payload `transfers` With `edge_anchors`

**Files:**
- Modify: `/home/aphex5/work/rbmk/repos/ml/graphrag/src/query/compact.py`
- Modify: `/home/aphex5/work/rbmk/repos/ml/graphrag/src/mcp_server/tools/flow_anchors.py`
- Modify: `/home/aphex5/work/rbmk/repos/ml/graphrag/tests/unit/test_mcp_tools.py`

- [ ] **Step 1: Write failing payload tests**

In `/home/aphex5/work/rbmk/repos/ml/graphrag/tests/unit/test_mcp_tools.py`, update `TestMcpSharedAppDataSchema` to assert `edge_anchors`:

```python
def test_build_graph_payload_default(self):
    """build_graph_payload returns TTL-safe graph keys with empty defaults."""
    from query.compact import build_graph_payload

    result = build_graph_payload()

    assert set(result.keys()) == {"schema", "nodes", "edges", "flows", "edge_anchors"}
    assert result["schema"] == "chain-insights.graph.v1"
    assert result["nodes"] == []
    assert result["edges"] == []
    assert result["flows"] == []
    assert result["edge_anchors"] == []
    assert "transfers" not in result
    assert "app_data" not in result


def test_build_graph_payload_with_data(self):
    """build_graph_payload carries aggregated graph data and durable anchors."""
    from query.compact import build_graph_payload

    result = build_graph_payload(
        nodes=[{"address": "5Test", "alias": "A", "patterns": ["LAYERING_HOP"]}],
        edges=[
            {"from": "5Test", "to": "5Other", "type": "FLOWS_TO"},
            {"from": "5Test", "to": "5Other", "type": "LAYERING_HOP"},
        ],
        flows=["A > A1"],
        edge_anchors=[{"transaction_id": "abc", "anchor": "first"}],
    )

    assert len(result["nodes"]) == 1
    assert len(result["edges"]) == 2
    assert len(result["flows"]) == 1
    assert result["edge_anchors"] == [{"transaction_id": "abc", "anchor": "first"}]
    assert "transfers" not in result
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
PYTHONPATH=src uv run --extra dev pytest tests/unit/test_mcp_tools.py::TestMcpSharedAppDataSchema -q
```

Expected: FAIL because `build_graph_payload` does not exist and current payload still uses `transfers`.

- [ ] **Step 3: Implement `build_graph_payload`**

In `/home/aphex5/work/rbmk/repos/ml/graphrag/src/query/compact.py`, replace `build_app_data_payload` with:

```python
def build_graph_payload(
    nodes: Optional[List] = None,
    edges: Optional[List] = None,
    flows: Optional[List] = None,
    edge_anchors: Optional[List] = None,
) -> dict[str, list | str]:
    """Assemble TTL-safe graph payload for MCP app rendering."""
    return {
        "schema": "chain-insights.graph.v1",
        "nodes": nodes or [],
        "edges": edges or [],
        "flows": flows or [],
        "edge_anchors": edge_anchors or [],
    }
```

Do not leave a `build_app_data_payload` alias behind.

- [ ] **Step 4: Rename anchor helper semantics**

In `/home/aphex5/work/rbmk/repos/ml/graphrag/src/mcp_server/tools/flow_anchors.py`, rename `flow_edge_transfer_anchors` to `flow_edge_anchor_rows` and change row keys:

```python
def flow_edge_anchor_rows(flow_edges: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Build TTL-safe anchor rows from durable FLOWS_TO edge properties."""
    anchors: list[dict[str, Any]] = []
    for edge in flow_edges or []:
        if edge.get("type") not in (None, "FLOWS_TO"):
            continue

        from_address = edge.get("from") or edge.get("from_address")
        to_address = edge.get("to") or edge.get("to_address")
        amount_usd = edge.get("amount_usd")
        if amount_usd is None:
            amount_usd = edge.get("amount_usd_sum")
        asset = edge.get("dominant_asset") or edge.get("asset") or edge.get("asset_symbol")

        seen_transaction_ids: set[str] = set()
        for anchor_name, transaction_id_field, timestamp_field in (
            ("first", "first_tx_id", "first_seen_timestamp"),
            ("last", "last_tx_id", "last_seen_timestamp"),
        ):
            transaction_id = edge.get(transaction_id_field)
            if not transaction_id or transaction_id in seen_transaction_ids:
                continue
            seen_transaction_ids.add(transaction_id)
            anchors.append(
                {
                    "transaction_id": transaction_id,
                    "from": from_address,
                    "to": to_address,
                    "amount_usd": amount_usd,
                    "asset": asset,
                    "timestamp": edge.get(timestamp_field),
                    "anchor": anchor_name,
                }
            )
    return anchors
```

- [ ] **Step 5: Update imports and call sites**

Replace imports/calls in:

- `src/mcp_server/tools/intelligence.py`
- `src/mcp_server/tools/tracing.py`

Use:

```python
from query.compact import build_graph_payload
from mcp_server.tools.flow_anchors import flow_edge_anchor_rows
```

Replace:

```python
all_txs = flow_edge_transfer_anchors(app_edges)
response_app_data = build_app_data_payload(..., transfers=all_txs if all_txs else [])
```

with:

```python
edge_anchors = flow_edge_anchor_rows(app_edges)
graph_data = build_graph_payload(
    nodes=canonical_nodes,
    edges=canonical_flow_edges + canonical_pattern_edges,
    flows=compact_flows,
    edge_anchors=edge_anchors,
)
```

- [ ] **Step 6: Run payload tests**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
PYTHONPATH=src uv run --extra dev pytest tests/unit/test_mcp_tools.py::TestMcpSharedAppDataSchema -q
```

Expected: PASS.

- [ ] **Step 7: Commit payload migration**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
git add src/query/compact.py src/mcp_server/tools/flow_anchors.py src/mcp_server/tools/intelligence.py src/mcp_server/tools/tracing.py tests/unit/test_mcp_tools.py
git commit -m "feat(mcp): use ttl-safe graph payload"
```

## Task 3: Return FastMCP `ToolResult` From Public Graph Tools

**Files:**
- Modify: `/home/aphex5/work/rbmk/repos/ml/graphrag/src/mcp_server/tools/intelligence.py`
- Modify: `/home/aphex5/work/rbmk/repos/ml/graphrag/src/mcp_server/tools/tracing.py`
- Modify: `/home/aphex5/work/rbmk/repos/ml/graphrag/tests/unit/test_mcp_tools.py`
- Modify: `/home/aphex5/work/rbmk/repos/ml/graphrag/tests/unit/test_intelligence.py`

- [ ] **Step 1: Update tests to assert MCP envelope**

In `/home/aphex5/work/rbmk/repos/ml/graphrag/tests/unit/test_mcp_tools.py`, replace the Phase 21 exact field test with:

```python
def test_chain_insights_result_schema_is_public_contract(self):
    """Public tool output schema is the compact chain-insights.result.v1 contract."""
    from mcp_server.models import CHAIN_INSIGHTS_RESULT_OUTPUT_SCHEMA

    assert CHAIN_INSIGHTS_RESULT_OUTPUT_SCHEMA["type"] == "object"
    assert set(CHAIN_INSIGHTS_RESULT_OUTPUT_SCHEMA["required"]) == {"schema", "tool", "facts"}
    assert "app_data" not in CHAIN_INSIGHTS_RESULT_OUTPUT_SCHEMA["properties"]
    assert "risk_assessment" not in CHAIN_INSIGHTS_RESULT_OUTPUT_SCHEMA["properties"]
```

Add a source-level guard:

```python
def test_public_graph_tools_do_not_return_model_visible_app_data(self):
    """Public graph tools must place graph data in _meta, not structuredContent."""
    combined = _tool_module_source("intelligence") + _tool_module_source("tracing")

    assert "build_chain_insights_tool_result" in combined
    assert "response_app_data" not in combined
    assert "risk_assessment=" not in combined
    assert "app_data=" not in combined
    assert "transfers=" not in combined
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
PYTHONPATH=src uv run --extra dev pytest tests/unit/test_mcp_tools.py -q
```

Expected: FAIL until tools return `ToolResult` and no longer instantiate `TraceResult`.

- [ ] **Step 3: Update `address_risk`**

In `/home/aphex5/work/rbmk/repos/ml/graphrag/src/mcp_server/tools/intelligence.py`:

Import:

```python
from fastmcp.tools import ToolResult
from mcp_server.models import (
    CHAIN_INSIGHTS_RESULT_OUTPUT_SCHEMA,
    RiskAssessmentDTO,
    RiskDriverDTO,
    build_chain_insights_tool_result,
    risk_assessment_to_fact,
)
```

Add `output_schema=CHAIN_INSIGHTS_RESULT_OUTPUT_SCHEMA` to the `@mcp.tool(...)` decorator.

Change the function annotation:

```python
) -> ToolResult:
```

Replace the final return:

```python
facts = {
    "subject": {
        "network": network,
        "addresses": [normalized_address],
    }
}
risk_fact = risk_assessment_to_fact(risk_assessment_dto)
if risk_fact is not None:
    facts["risk"] = risk_fact

return build_chain_insights_tool_result(
    tool="address_risk",
    summary=summary,
    hint=hint,
    facts=facts,
    graph_data=graph_data if include_attachments else None,
)
```

For the address-not-found path, return:

```python
return build_chain_insights_tool_result(
    tool="address_risk",
    summary="Address not found in the graph.",
    hint=_ERROR_HINTS["address_not_found"],
    facts={"subject": {"network": network, "addresses": [normalized_address]}},
)
```

- [ ] **Step 4: Update tracing tools**

In `/home/aphex5/work/rbmk/repos/ml/graphrag/src/mcp_server/tools/tracing.py`:

Import:

```python
from fastmcp.tools import ToolResult
from mcp_server.models import (
    CHAIN_INSIGHTS_RESULT_OUTPUT_SCHEMA,
    RiskAssessmentDTO,
    RiskDriverDTO,
    build_chain_insights_tool_result,
    risk_assessment_to_fact,
)
```

For `trace_stolen_funds`, add `output_schema=CHAIN_INSIGHTS_RESULT_OUTPUT_SCHEMA`, change return type to `ToolResult`, and return:

```python
facts = {
    "subject": {
        "network": network,
        "trusted_addresses": trusted_list,
        "untrusted_addresses": untrusted_list,
    },
    "flows": {
        "path_count": len(compact_flows),
    },
}

return build_chain_insights_tool_result(
    tool="track_funds",
    summary=summary,
    hint=hint,
    facts=facts,
    graph_data=graph_data if include_attachments else None,
)
```

For `money_flows_between_exchanges`, use:

```python
facts = {
    "subject": {
        "network": network,
        "addresses": address_list,
    },
    "exchange_flows": {
        "path_count": len(compact_flows),
    },
}
```

For `check_connection_risk`, use:

```python
facts = {
    "subject": {
        "network": network,
        "from_address": normalized_from,
        "to_address": normalized_to,
    }
}
risk_fact = risk_assessment_to_fact(risk_assessment_dto)
if risk_fact is not None:
    facts["risk"] = risk_fact
```

- [ ] **Step 5: Run focused GraphRAG tests**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
PYTHONPATH=src uv run --extra dev pytest \
  tests/unit/test_mcp_response_contract.py \
  tests/unit/test_mcp_tools.py \
  tests/unit/test_intelligence.py \
  -q
```

Expected: PASS.

- [ ] **Step 6: Commit graph tool envelope migration**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
git add src/mcp_server/tools/intelligence.py src/mcp_server/tools/tracing.py tests/unit/test_mcp_tools.py tests/unit/test_intelligence.py
git commit -m "feat(mcp): return agent-safe graph tool results"
```

## Task 4: Wrap `graph_query` In The Result Contract

**Files:**
- Modify: `/home/aphex5/work/rbmk/repos/ml/graphrag/src/mcp_server/tools/raw_queries.py`
- Modify: `/home/aphex5/work/rbmk/repos/ml/graphrag/tests/unit/test_mcp_tools.py`

- [ ] **Step 1: Add graph_query contract test**

Add to `/home/aphex5/work/rbmk/repos/ml/graphrag/tests/unit/test_mcp_tools.py`:

```python
def test_graph_query_uses_chain_insights_result_contract():
    """graph_query should expose rows as facts.query, with no graph app payload."""
    src = _tool_module_source("raw_queries")

    assert "build_chain_insights_tool_result" in src
    assert '"query"' in src
    assert "graph_data=" not in src
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
PYTHONPATH=src uv run --extra dev pytest tests/unit/test_mcp_tools.py::test_graph_query_uses_chain_insights_result_contract -q
```

Expected: FAIL because `graph_query` still returns a plain dict.

- [ ] **Step 3: Update raw query handler**

In `/home/aphex5/work/rbmk/repos/ml/graphrag/src/mcp_server/tools/raw_queries.py`, import:

```python
import json

from fastmcp.tools import ToolResult
from mcp_server.models import (
    CHAIN_INSIGHTS_RESULT_OUTPUT_SCHEMA,
    build_chain_insights_tool_result,
)
```

Change `_graph_query_handler` return annotation:

```python
) -> ToolResult:
```

Replace the final return:

```python
payload = {"results": serialized, "count": len(serialized)}
return build_chain_insights_tool_result(
    tool="graph_query",
    summary=json.dumps(payload, ensure_ascii=False),
    facts={
        "subject": {
            "network": network,
        },
        "query": payload,
    },
)
```

Add `output_schema=CHAIN_INSIGHTS_RESULT_OUTPUT_SCHEMA` in `mcp.tool(...)`.

- [ ] **Step 4: Run raw query tests**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
PYTHONPATH=src uv run --extra dev pytest tests/unit/test_mcp_tools.py tests/unit/test_mcp_validators.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit raw query migration**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
git add src/mcp_server/tools/raw_queries.py tests/unit/test_mcp_tools.py
git commit -m "feat(mcp): wrap graph query response"
```

## Task 5: Update GraphRAG Docs And Acceptance Checks

**Files:**
- Modify: `/home/aphex5/work/rbmk/repos/ml/graphrag/README.md`
- Modify: `/home/aphex5/work/rbmk/repos/ml/graphrag/CLAUDE.md`
- Modify: `/home/aphex5/work/rbmk/repos/ml/graphrag/src/mcp_server/instructions.md`
- Modify: `/home/aphex5/work/rbmk/repos/ml/graphrag/tests/acceptance/test_mcp_tools.py`

- [ ] **Step 1: Update docs to describe `_meta` graph payloads**

Replace inline `app_data` language with:

```markdown
## Output Format

Public tools return MCP `CallToolResult` envelopes:

- `content`: markdown/text intended for the LLM and operator.
- `structuredContent.schema`: `chain-insights.result.v1`.
- `structuredContent.facts`: compact model-readable facts.
- `_meta.chainInsights.graph.data`: graph widget payload when `include_attachments=true`.

Agents must not parse `_meta.chainInsights.graph.data`; it is for host apps and local proxies.
Graph payloads use `chain-insights.graph.v1` with `nodes`, `edges`, `flows`, and `edge_anchors`.
```

In `CLAUDE.md`, replace the inline-app-data hard rule with:

```markdown
- MCP visualization payloads are returned in tool-result `_meta`; do not reintroduce server-side result caches.
```

- [ ] **Step 2: Update acceptance validation**

In `/home/aphex5/work/rbmk/repos/ml/graphrag/tests/acceptance/test_mcp_tools.py`, replace `TraceResult.model_validate(data)` checks for public tools with assertions on the MCP call result shape:

```python
assert result["structuredContent"]["schema"] == "chain-insights.result.v1"
assert "facts" in result["structuredContent"]
assert "app_data" not in result["structuredContent"]
assert "risk_assessment" not in result["structuredContent"]
assert "_meta" in result
```

For `include_attachments=false`, assert:

```python
assert "chainInsights" not in result.get("_meta", {})
```

- [ ] **Step 3: Run acceptance/unit checks**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
PYTHONPATH=src uv run --extra dev pytest -m unit -q
PYTHONPATH=src uv run --extra dev pytest -m acceptance -q
uv run --extra dev ruff check .
```

Expected: PASS.

- [ ] **Step 4: Rebuild local GraphRAG MCP image**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml
docker compose --env-file .env -f compose/shared.yml -f compose/bittensor.yml build graphrag-mcp
docker compose --env-file .env -f compose/shared.yml -f compose/bittensor.yml up -d graphrag-mcp
```

Expected: `dev-graphrag-mcp` restarts with the new image.

- [ ] **Step 5: Commit docs and acceptance updates**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
git add README.md CLAUDE.md src/mcp_server/instructions.md tests/acceptance/test_mcp_tools.py
git commit -m "docs(mcp): document agent-safe response contract"
```

## Task 6: Add Chain Insights Local Graph Artifact Store

**Files:**
- Create: `/home/aphex5/work/chain-insights/src/mcp/artifacts.ts`
- Create: `/home/aphex5/work/chain-insights/tests/mcp-artifacts.test.ts`

- [ ] **Step 1: Write failing artifact tests**

Create `/home/aphex5/work/chain-insights/tests/mcp-artifacts.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('MCP graph artifact store', () => {
  let fakeHome: string
  let previousHome: string | undefined

  beforeEach(async () => {
    fakeHome = join(tmpdir(), `ci-artifacts-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(fakeHome, { recursive: true })
    previousHome = process.env['HOME']
    process.env['HOME'] = fakeHome
  })

  afterEach(async () => {
    process.env['HOME'] = previousHome
    await rm(fakeHome, { recursive: true, force: true })
  })

  it('writes graph JSON under the configured data directory', async () => {
    const { writeGraphArtifact } = await import('../src/mcp/artifacts.js')
    const graphData = {
      schema: 'chain-insights.graph.v1',
      nodes: [{ address: '5Addr' }],
      edges: [],
      flows: [],
      edge_anchors: [],
    }

    const artifact = await writeGraphArtifact(graphData, {
      dataDir: join(fakeHome, '.chain-insights'),
      serverPort: 4567,
    })

    expect(artifact.id).toMatch(/^[a-f0-9-]+$/)
    expect(artifact.url).toBe(`http://127.0.0.1:4567/artifacts/${artifact.id}/graph.json`)

    const raw = await readFile(join(fakeHome, '.chain-insights', 'artifacts', artifact.id, 'graph.json'), 'utf8')
    expect(JSON.parse(raw)).toEqual(graphData)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd /home/aphex5/work/chain-insights
npx vitest run tests/mcp-artifacts.test.ts
```

Expected: FAIL because `src/mcp/artifacts.ts` does not exist.

- [ ] **Step 3: Implement artifact store**

Create `/home/aphex5/work/chain-insights/src/mcp/artifacts.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { InvestigatorConfig } from '../config/schema.js'

export type GraphArtifactInput = {
  schema: string
  nodes: unknown[]
  edges: unknown[]
  flows: unknown[]
  edge_anchors: unknown[]
}

export type GraphArtifactRef = {
  schema: string
  id: string
  url: string
  path: string
}

export async function writeGraphArtifact(
  graphData: GraphArtifactInput,
  config: Pick<InvestigatorConfig, 'dataDir' | 'serverPort'>,
): Promise<GraphArtifactRef> {
  if (graphData.schema !== 'chain-insights.graph.v1') {
    throw new Error(`Unsupported graph payload schema: ${graphData.schema}`)
  }

  const id = randomUUID()
  const artifactDir = path.join(config.dataDir, 'artifacts', id)
  const filePath = path.join(artifactDir, 'graph.json')
  await mkdir(artifactDir, { recursive: true })
  await writeFile(filePath, JSON.stringify(graphData, null, 2) + '\n', { mode: 0o600 })

  return {
    schema: graphData.schema,
    id,
    path: filePath,
    url: `http://127.0.0.1:${config.serverPort}/artifacts/${id}/graph.json`,
  }
}
```

- [ ] **Step 4: Run artifact tests**

Run:

```bash
cd /home/aphex5/work/chain-insights
npx vitest run tests/mcp-artifacts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit artifact store**

Run:

```bash
cd /home/aphex5/work/chain-insights
git add src/mcp/artifacts.ts tests/mcp-artifacts.test.ts
git commit -m "feat(mcp): add local graph artifact store"
```

## Task 7: Normalize Proxied GraphRAG Results In Chain Insights

**Files:**
- Modify: `/home/aphex5/work/chain-insights/src/mcp/proxy.ts`
- Modify: `/home/aphex5/work/chain-insights/tests/mcp-proxy.test.ts`

- [ ] **Step 1: Write failing proxy normalization test**

Add to `/home/aphex5/work/chain-insights/tests/mcp-proxy.test.ts`:

```ts
it('persists remote graph _meta and returns only local artifact pointer', async () => {
  const { loadSchema } = await import('../src/mcp/schema-cache.js')
  vi.mocked(loadSchema).mockResolvedValueOnce([
    {
      name: 'address_risk',
      title: 'Address Risk',
      description: 'Risk report',
      outputSchema: {
        type: 'object',
        properties: { schema: { type: 'string' }, facts: { type: 'object' } },
      },
      _meta: { ui: { resourceUri: 'ui://chain-insights/graph' } },
    },
  ])

  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { createProxy } = await import('../src/mcp/proxy.js')
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

  await createProxy()

  const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
    callTool: ReturnType<typeof vi.fn>
  }
  clientInstance.callTool.mockResolvedValueOnce({
    content: [{ type: 'text', text: '## Risk Report' }],
    structuredContent: {
      schema: 'chain-insights.result.v1',
      tool: 'address_risk',
      facts: { risk: { level: 'critical' } },
    },
    _meta: {
      chainInsights: {
        graph: {
          schema: 'chain-insights.graph.v1',
          data: { schema: 'chain-insights.graph.v1', nodes: [], edges: [], flows: [], edge_anchors: [] },
        },
      },
    },
    isError: false,
  })

  const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
    registerTool: ReturnType<typeof vi.fn>
  }
  const handler = findToolHandler(serverInstance, 'address_risk')
  const result = await handler({ address: '5Addr', network: 'bittensor' })

  expect(result.content).toEqual([{ type: 'text', text: '## Risk Report' }])
  expect(result.structuredContent.facts.risk.level).toBe('critical')
  expect(result.structuredContent).not.toHaveProperty('app_data')
  expect(result._meta.chainInsights.graph.data).toBeUndefined()
  expect(result._meta.chainInsights.graph.url).toMatch(/^http:\/\/127\.0\.0\.1:4321\/artifacts\/.+\/graph\.json$/)
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd /home/aphex5/work/chain-insights
npx vitest run tests/mcp-proxy.test.ts
```

Expected: FAIL because the proxy currently returns only `content` and `isError`.

- [ ] **Step 3: Implement proxy normalization helper**

In `/home/aphex5/work/chain-insights/src/mcp/proxy.ts`, import:

```ts
import type { InvestigatorConfig } from '../config/schema.js'
```

Add helper types/functions above `createProxy()`:

```ts
type RemoteToolResult = {
  content?: Array<{ type: string; text?: string }>
  structuredContent?: Record<string, unknown>
  _meta?: Record<string, unknown>
  isError?: boolean
}

function getRemoteGraphPayload(result: RemoteToolResult): Record<string, unknown> | null {
  const chainInsights = result._meta?.chainInsights
  if (!chainInsights || typeof chainInsights !== 'object' || Array.isArray(chainInsights)) return null
  const graph = (chainInsights as Record<string, unknown>).graph
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) return null
  const data = (graph as Record<string, unknown>).data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  return data as Record<string, unknown>
}

async function normalizeRemoteToolResult(
  result: RemoteToolResult,
  config: Pick<InvestigatorConfig, 'dataDir' | 'serverPort'>,
) {
  const graphPayload = getRemoteGraphPayload(result)
  const meta = { ...(result._meta ?? {}) }

  if (graphPayload) {
    const { writeGraphArtifact } = await import('./artifacts.js')
    const artifact = await writeGraphArtifact(graphPayload as never, config)
    meta.chainInsights = {
      ...((meta.chainInsights as Record<string, unknown>) ?? {}),
      graph: {
        schema: artifact.schema,
        id: artifact.id,
        url: artifact.url,
      },
    }
  }

  return {
    content: result.content ?? [],
    structuredContent: result.structuredContent,
    _meta: Object.keys(meta).length > 0 ? meta : undefined,
    isError: result.isError,
  }
}
```

Then replace the remote handler return with:

```ts
return await normalizeRemoteToolResult(result as RemoteToolResult, config)
```

- [ ] **Step 4: Run proxy tests**

Run:

```bash
cd /home/aphex5/work/chain-insights
npx vitest run tests/mcp-proxy.test.ts tests/mcp-artifacts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit proxy normalization**

Run:

```bash
cd /home/aphex5/work/chain-insights
git add src/mcp/proxy.ts tests/mcp-proxy.test.ts
git commit -m "feat(mcp): normalize graph results into local artifacts"
```

## Task 8: Serve Local Graph Artifacts

**Files:**
- Modify: `/home/aphex5/work/chain-insights/src/server/app.ts`
- Modify: `/home/aphex5/work/chain-insights/tests/viz-server.test.ts`

- [ ] **Step 1: Write failing server route test**

Add to `/home/aphex5/work/chain-insights/tests/viz-server.test.ts`:

```ts
it('GET /artifacts/:artifactId/graph.json serves local graph JSON', async () => {
  const artifactDir = join(fakeHome, '.chain-insights', 'artifacts', 'artifact-1')
  await mkdir(artifactDir, { recursive: true })
  await writeFile(
    join(artifactDir, 'graph.json'),
    JSON.stringify({ schema: 'chain-insights.graph.v1', nodes: [], edges: [], flows: [], edge_anchors: [] }),
  )

  stop = await startTestServer(14405)
  const res = await fetch('http://127.0.0.1:14405/artifacts/artifact-1/graph.json')
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('application/json')
  expect(await res.json()).toEqual({
    schema: 'chain-insights.graph.v1',
    nodes: [],
    edges: [],
    flows: [],
    edge_anchors: [],
  })
})
```

- [ ] **Step 2: Run server test and verify it fails**

Run:

```bash
cd /home/aphex5/work/chain-insights
npx vitest run tests/viz-server.test.ts
```

Expected: FAIL because `/artifacts/:artifactId/graph.json` is not registered.

- [ ] **Step 3: Implement route**

In `/home/aphex5/work/chain-insights/src/server/app.ts`, add:

```ts
import { loadConfig } from '../config/index.js'

async function findGraphArtifact(artifactId: string): Promise<string | null> {
  const config = await loadConfig()
  const filePath = path.join(config.dataDir, 'artifacts', artifactId, 'graph.json')
  try {
    return await readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}
```

Inside `createApp()`:

```ts
app.get('/artifacts/:artifactId/graph.json', async (c) => {
  const artifactId = c.req.param('artifactId')
  if (!/^[a-zA-Z0-9_-]+$/.test(artifactId)) {
    return c.json({ error: 'Invalid artifact ID' }, 400)
  }
  const graphJson = await findGraphArtifact(artifactId)
  if (!graphJson) {
    return c.json({ error: 'Graph artifact not found' }, 404)
  }
  return c.text(graphJson, 200, { 'content-type': 'application/json; charset=utf-8' })
})
```

- [ ] **Step 4: Run server tests**

Run:

```bash
cd /home/aphex5/work/chain-insights
npx vitest run tests/viz-server.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit artifact route**

Run:

```bash
cd /home/aphex5/work/chain-insights
git add src/server/app.ts tests/viz-server.test.ts
git commit -m "feat(server): serve graph artifacts"
```

## Task 9: Load Graph App Data From Tool Result `_meta`

**Files:**
- Modify: `/home/aphex5/work/chain-insights/src/viz/templates/graph.html`
- Modify: `/home/aphex5/work/chain-insights/tests/viz-html-generator.test.ts`

- [ ] **Step 1: Write failing graph HTML assertions**

Add to `/home/aphex5/work/chain-insights/tests/viz-html-generator.test.ts`:

```ts
it('graph app reads local graph artifact URL from tool result _meta', async () => {
  const { generateHtml } = await import('../src/viz/html-generator.js')
  const { GraphData } = await import('../src/viz/graph-model.js')
  const html = generateHtml(new GraphData())

  expect(html).toContain('chainInsights')
  expect(html).toContain('graph.url')
  expect(html).toContain('fetch(graphUrl)')
  expect(html).not.toContain('toolResult.app_data')
})
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
cd /home/aphex5/work/chain-insights
npx vitest run tests/viz-html-generator.test.ts
```

Expected: FAIL because graph.html still prefers `toolResult.app_data`.

- [ ] **Step 3: Update graph app message handling**

In `/home/aphex5/work/chain-insights/src/viz/templates/graph.html`, update `loadDataFromToolResult` and the `ui/notifications/tool-result` branch:

```js
async function loadFromToolResultParams(params) {
  var graphUrl = params &&
    params._meta &&
    params._meta.chainInsights &&
    params._meta.chainInsights.graph &&
    params._meta.chainInsights.graph.url;

  if (graphUrl) {
    var resp = await fetch(graphUrl);
    if (!resp.ok) throw new Error('Graph artifact fetch failed: ' + resp.status);
    var graphData = await resp.json();
    window.loadData(graphData);
    return true;
  }

  return false;
}
```

Use it in the message listener:

```js
if (data.method === 'ui/notifications/tool-result' && data.params) {
  loadFromToolResultParams(data.params).catch(function(error) {
    console.error(error);
  });
}
```

Remove `toolResult.app_data` handling from the MCP Apps path.

- [ ] **Step 4: Run graph HTML tests**

Run:

```bash
cd /home/aphex5/work/chain-insights
npx vitest run tests/viz-html-generator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit graph app loader update**

Run:

```bash
cd /home/aphex5/work/chain-insights
git add src/viz/templates/graph.html tests/viz-html-generator.test.ts
git commit -m "feat(viz): load mcp graph artifacts from meta"
```

## Task 10: Update Chain Insights Docs And CLI Expectations

**Files:**
- Modify: `/home/aphex5/work/chain-insights/README.md`
- Modify: `/home/aphex5/work/chain-insights/tests/cli-mcp.test.ts`

- [ ] **Step 1: Update README response-flow docs**

In `/home/aphex5/work/chain-insights/README.md`, update the Agent MCP Proxy section:

```markdown
The proxy also normalizes GraphRAG tool results:

- LLM-visible `content` remains markdown/text only.
- `structuredContent` carries compact `chain-insights.result.v1` facts.
- Graph widget data is extracted from remote `_meta.chainInsights.graph.data`.
- Graph data is written to `~/.chain-insights/artifacts/<id>/graph.json`.
- The returned tool result contains only `_meta.chainInsights.graph.url` for the local graph app.
```

- [ ] **Step 2: Keep CLI debug output text-only**

In `/home/aphex5/work/chain-insights/tests/cli-mcp.test.ts`, add a test proving `mcp call` still prints text content only:

```ts
it('mcp call prints model-visible content only', async () => {
  mockLoadConfig.mockResolvedValue({ mcpEndpoint: 'http://localhost:4000' })
  mockCreateConfiguredMcpFetch.mockResolvedValue(fetch)
  mockClientConnect.mockResolvedValue(undefined)
  mockClientClose.mockResolvedValue(undefined)
  mockClientCallTool.mockResolvedValueOnce({
    content: [{ type: 'text', text: '## Risk Report' }],
    structuredContent: { facts: { risk: { level: 'critical' } } },
    _meta: { chainInsights: { graph: { url: 'http://127.0.0.1:4321/artifacts/a/graph.json' } } },
  })

  await runMcpCallAction('address_risk', ['network=bittensor', 'address=5Addr'])

  expect(consoleLogSpy).toHaveBeenCalledWith('## Risk Report')
  expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toContain('graph.json')
  expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toContain('critical')
})
```

- [ ] **Step 3: Run docs-adjacent tests**

Run:

```bash
cd /home/aphex5/work/chain-insights
npx vitest run tests/cli-mcp.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit docs and CLI expectation update**

Run:

```bash
cd /home/aphex5/work/chain-insights
git add README.md tests/cli-mcp.test.ts
git commit -m "docs(mcp): document agent-safe graph artifacts"
```

## Task 11: End-to-End Verification

**Files:**
- No planned source edits.

- [ ] **Step 1: Run GraphRAG verification**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
PYTHONPATH=src uv run --extra dev pytest -m unit -q
PYTHONPATH=src uv run --extra dev pytest -m acceptance -q
uv run --extra dev ruff check .
```

Expected: PASS.

- [ ] **Step 2: Run Chain Insights verification**

Run:

```bash
cd /home/aphex5/work/chain-insights
npm run typecheck
npm test
npm run build
```

Expected: PASS.

- [ ] **Step 3: Rebuild and restart local GraphRAG MCP**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml
docker compose --env-file .env -f compose/shared.yml -f compose/bittensor.yml build graphrag-mcp
docker compose --env-file .env -f compose/shared.yml -f compose/bittensor.yml up -d graphrag-mcp
```

Expected: `dev-graphrag-mcp` is running with the new image.

- [ ] **Step 4: Inspect real MCP shape**

Run:

```bash
cd /home/aphex5/work/chain-insights
npx @modelcontextprotocol/inspector --cli http://localhost:8011/mcp \
  --transport http \
  --header 'Authorization: Bearer chain-insights-dev-debug' \
  --header 'X-MCP-Debug-Token: chain-insights-dev-debug' \
  --method tools/call \
  --tool-name address_risk \
  --tool-arg network=bittensor \
  --tool-arg address=5Ccmf1dJKzGtXX7h17eN72MVMRsFwvYjPVmkXPUaapczECf6 \
  --tool-arg include_attachments=true
```

Expected:

- `content[0].text` contains markdown only.
- `structuredContent.schema` is `chain-insights.result.v1`.
- `structuredContent.facts` exists.
- `structuredContent.app_data` is absent.
- `_meta.chainInsights.graph.data.schema` is `chain-insights.graph.v1`.
- `_meta.chainInsights.graph.data.transfers` is absent.

- [ ] **Step 5: Inspect Chain Insights proxy shape**

Run MCP Inspector in stdio mode:

```text
Transport: STDIO
Command: chain-insights-mcp-proxy
Args: empty
```

Call `address_risk` with address `5Ccmf1dJKzGtXX7h17eN72MVMRsFwvYjPVmkXPUaapczECf6`, network `bittensor`, and `include_attachments=true`.

Expected:

- `content[0].text` contains markdown only.
- `structuredContent.facts` exists.
- `_meta.chainInsights.graph.url` points to `http://127.0.0.1:<port>/artifacts/<id>/graph.json`.
- `_meta.chainInsights.graph.data` is absent.
- Fetching the graph URL returns `chain-insights.graph.v1` JSON.

- [ ] **Step 6: Final commits and status**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
git status --short

cd /home/aphex5/work/chain-insights
git status --short
git log --oneline -8
```

Expected: only intentional untracked local scratch files remain. Commit any missed intentional docs/tests/source changes with concise messages.
