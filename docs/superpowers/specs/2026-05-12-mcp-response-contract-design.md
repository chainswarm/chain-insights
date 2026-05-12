# MCP Response Contract Design

## Context

Chain Insights consumes the live GraphRAG MCP and re-exposes it to AI agents through `chain-insights-mcp-proxy`. Current GraphRAG tool results are useful, but the payload is shaped for FastMCP widgets rather than agent-safe reasoning:

- The domain result is currently `summary`, `hint`, `app_data`, and `risk_assessment`.
- `app_data` contains large graph arrays: `nodes`, `edges`, `flows`, and `transfers`.
- FastMCP/Inspector currently exposes that data through model-visible result content, which can burn tokens and preserve old individual-transfer semantics.
- GraphRAG recently removed server-side result caches, and this design must not reintroduce them.

The new contract must keep GraphRAG as the compute server and make Chain Insights the local agent-safe adapter.

## Goals

- Keep the LLM-readable result small and useful.
- Keep heavy graph visualization data out of `content` and `structuredContent`.
- Preserve graph visualization by moving heavy graph payloads through MCP `_meta`.
- Avoid GraphRAG-side result caches or resource stores.
- Persist visualization artifacts only on the local Chain Insights machine.
- Replace old `transfers` widget semantics with TTL-safe aggregated graph data and optional edge anchors.

## Non-Goals

- Do not add a GraphRAG `resourceUri` result cache for computed graph payloads.
- Do not keep duplicate graph descriptors in multiple result locations.
- Do not expose StarRocks SQL through Chain Insights or GraphRAG MCP.
- Do not add backward-compatible legacy result modes.

## MCP Envelope

MCP tool results use the standard envelope:

```json
{
  "content": [],
  "structuredContent": {},
  "_meta": {},
  "isError": false
}
```

This design assigns strict meaning to each part:

| Field | Meaning |
| --- | --- |
| `content` | Markdown/text intended for the LLM and operator. |
| `structuredContent` | Small structured facts intended for model reasoning. |
| `_meta` | Host/app/proxy metadata and heavy payloads that should not be read by the LLM. |
| `isError` | MCP tool error flag. |

## GraphRAG Output Contract

GraphRAG should return one agent-readable summary and one compact facts object. Heavy app data stays in `_meta`.

```json
{
  "content": [
    {
      "type": "text",
      "text": "## Risk Report\n..."
    }
  ],
  "structuredContent": {
    "schema": "chain-insights.result.v1",
    "tool": "address_risk",
    "hint": "Use track_funds to trace fund paths.",
    "facts": {
      "subject": {
        "network": "bittensor",
        "addresses": [
          "5Ccmf1dJKzGtXX7h17eN72MVMRsFwvYjPVmkXPUaapczECf6"
        ]
      },
      "risk": {
        "score": 1,
        "level": "critical",
        "confidence": "high",
        "recommendation": "Escalate for review.",
        "drivers": [
          {
            "signal": "HIGH_RISK_NODE",
            "severity": 0.4,
            "description": "High-risk intermediaries detected."
          }
        ]
      }
    }
  },
  "_meta": {
    "chainInsights": {
      "graph": {
        "schema": "chain-insights.graph.v1",
        "data": {
          "nodes": [],
          "edges": [],
          "flows": [],
          "edge_anchors": []
        }
      }
    }
  }
}
```

Rules:

- `summary` becomes `content[0].text`; it is not duplicated inside `structuredContent`.
- `hint` remains model-readable inside `structuredContent`.
- `risk_assessment` becomes `facts.risk`.
- Other tool-specific structured data goes under `facts.<domain>`, for example `facts.connection`, `facts.exchange_flows`, or `facts.query`.
- `app_data` is removed from model-visible fields.
- `_meta.chainInsights.graph.data` carries graph arrays for the proxy/app.
- Graph data uses `edge_anchors`, not `transfers`, when anchor rows are needed.
- GraphRAG does not store computed graph payloads after the response.

## Chain Insights Proxy Contract

The Chain Insights MCP proxy calls GraphRAG, extracts `_meta.chainInsights.graph.data`, persists it locally, and returns an agent-safe result.

```json
{
  "content": [
    {
      "type": "text",
      "text": "## Risk Report\n..."
    }
  ],
  "structuredContent": {
    "schema": "chain-insights.result.v1",
    "tool": "address_risk",
    "hint": "Use track_funds to trace fund paths.",
    "facts": {
      "subject": {
        "network": "bittensor",
        "addresses": [
          "5Ccmf1dJKzGtXX7h17eN72MVMRsFwvYjPVmkXPUaapczECf6"
        ]
      },
      "risk": {
        "score": 1,
        "level": "critical",
        "confidence": "high",
        "recommendation": "Escalate for review.",
        "drivers": []
      }
    }
  },
  "_meta": {
    "chainInsights": {
      "graph": {
        "schema": "chain-insights.graph.v1",
        "id": "local-artifact-id",
        "url": "http://127.0.0.1:4321/artifacts/local-artifact-id/graph.json"
      }
    }
  }
}
```

Rules:

- The proxy preserves `content`, `structuredContent`, `isError`, and relevant `_meta`.
- The proxy writes graph JSON under the local Chain Insights data directory.
- The proxy returns only a local artifact pointer in `_meta`.
- The proxy does not put graph arrays in `structuredContent`.
- The graph app fetches the local URL from `_meta.chainInsights.graph.url`.

## Local Artifact Storage

Local graph artifacts belong to Chain Insights because investigation data is local-first.

Default path:

```text
~/.chain-insights/artifacts/<artifact-id>/graph.json
```

The local Hono server serves:

```text
GET /artifacts/:artifactId/graph.json
```

Artifact IDs should be opaque and generated by Chain Insights. The graph JSON file should contain the `chain-insights.graph.v1` payload:

```json
{
  "schema": "chain-insights.graph.v1",
  "nodes": [],
  "edges": [],
  "flows": [],
  "edge_anchors": []
}
```

## TTL Safety

The graph contract is aggregated by default:

- `edges` represent durable `FLOWS_TO` relationships and pattern edges.
- `flows` provide compact path context.
- `edge_anchors` may include `first_tx_id`, `last_tx_id`, and first/last timestamps from durable graph edge properties.
- The widget must not depend on raw `core_transfers` rows.
- The old `transfers` field should be removed from new graph payloads.

## Compatibility

No legacy output mode is required. The target public contract is `chain-insights.result.v1` for tool results and `chain-insights.graph.v1` for graph payloads.

GraphRAG may keep `TraceResult` as an internal Python DTO name if that keeps the implementation small, but the public MCP response must follow this envelope. The DTO name is not part of the public contract.

## Testing

Required verification:

- GraphRAG unit tests prove public tools return `content`, compact `structuredContent`, and graph data only in `_meta`.
- GraphRAG unit tests prove `transfers` is absent from graph payloads.
- Chain Insights proxy tests prove heavy graph data is persisted locally and removed from the returned model-visible result.
- Chain Insights graph app tests prove it can load graph JSON from the local artifact URL.
- MCP Inspector manual check proves direct GraphRAG and Chain Insights proxy responses have the intended shape.
