# Spike 001: Graph MCP Runtime Comparison

## Question

Should the graph-query MCP runtime move from Python/FastMCP to TypeScript/Hono or Go while GraphRAG sync stays Python?

## Current Ground Truth

- Chain Insights is already TypeScript, Node 24, Hono, MCP TypeScript SDK, and `@x402/*`.
- GraphRAG sync and query reference code are Python. The current checked-out GraphRAG source registers only `graph_query` in MCP.
- The local `dev-graphrag-mcp` container started during this spike still exposed old high-level tools in `tools/list`; that image should be rebuilt before production-level UAT.
- Local Memgraph/StarRocks were started through the real RBMK compose stack:

```bash
cd /home/aphex5/work/rbmk
docker compose up -d starrocks memgraph-bittensor

cd /home/aphex5/work/rbmk/repos/ml
set -a; . ../../.env; . ./.env; set +a
docker compose -f compose/shared.yml up -d graphrag-mcp
```

## Prototype

This directory contains two minimal MCP servers that expose only `graph_query`:

### TypeScript/Hono

- MCP SDK: `@modelcontextprotocol/sdk`
- HTTP shell: Hono + `WebStandardStreamableHTTPServerTransport`
- Memgraph driver: `neo4j-driver`
- Result shape: Chain Insights `chain-insights.result.v1`
- Guardrails: empty query rejection, write keyword rejection, automatic `LIMIT 1000`

Run the prototype:

```bash
cd .planning/spikes/001-graph-mcp-runtime-comparison
npm install
npm run server
```

Then inspect it:

```bash
npx @modelcontextprotocol/inspector \
  --cli http://127.0.0.1:8911/mcp \
  --transport http \
  --method tools/list
```

Run the benchmark:

```bash
BENCH_ITERATIONS=20 npm run bench
```

Results are written to `results/latest.json`.

### Go/net-http

- MCP SDK: `github.com/modelcontextprotocol/go-sdk/mcp`
- HTTP shell: Go `net/http` + `mcp.NewStreamableHTTPHandler`
- Memgraph driver: `github.com/neo4j/neo4j-go-driver/v5`
- Result shape: Chain Insights `chain-insights.result.v1`
- Guardrails: empty query rejection, write keyword rejection, automatic `LIMIT 1000`
- Build path: Docker-based Go build because Go is not installed on the host.

Build and run the Go prototype:

```bash
cd .planning/spikes/001-graph-mcp-runtime-comparison/go-mcp
docker run --rm -v "$PWD":/work -w /work -e CGO_ENABLED=0 golang:1.25-alpine \
  sh -lc '/usr/local/go/bin/go test ./... && /usr/local/go/bin/go build -o bin/graph-query-go-mcp .'

./bin/graph-query-go-mcp
```

Inspect it:

```bash
npx @modelcontextprotocol/inspector \
  --cli http://127.0.0.1:8921/mcp \
  --transport http \
  --method tools/list
```

## Verification

Commands run:

```bash
npm run typecheck

npx @modelcontextprotocol/inspector \
  --cli http://127.0.0.1:8911/mcp \
  --transport http \
  --method tools/list

npx @modelcontextprotocol/inspector \
  --cli http://localhost:8011/mcp \
  --transport http \
  --method tools/list \
  --header "X-MCP-Debug-Token: chain-insights-dev-debug"

npx @modelcontextprotocol/inspector \
  --cli http://127.0.0.1:8921/mcp \
  --transport http \
  --method tools/list

npx @modelcontextprotocol/inspector \
  --cli http://127.0.0.1:8921/mcp \
  --transport http \
  --method tools/call \
  --tool-name graph_query \
  --tool-arg network=bittensor \
  --tool-arg 'query=MATCH (n) WHERE n.address IS NOT NULL RETURN labels(n) AS labels, n.address AS address LIMIT 3'

BENCH_ITERATIONS=50 npm run bench
```

After rebuilding `dev-graphrag-mcp` from the checked-out GraphRAG source, the Python MCP tool surface exposed only `graph_query`.

Benchmark run:

- Generated: `2026-05-14T16:04:33.582Z`
- Network: `bittensor`
- Sample address: `5Gj4RmnTz6BjH1JV3pbQmo61EfGQxUGxNBVbfkn6Pf2FTqKC`
- Iterations per target/query: `50`
- MCP clients and Memgraph drivers were kept warm across calls.

| Target | Query | p50 ms | p95 ms | Notes |
|---|---:|---:|---:|---|
| Python/FastMCP | address sample 10 | 4.52 | 5.34 | Current rebuilt GraphRAG MCP |
| TS/Hono MCP | address sample 10 | 2.84 | 3.39 | Faster than Python on tiny reads |
| Go MCP | address sample 10 | 1.29 | 2.00 | Close to direct Bolt |
| Direct Memgraph | address sample 10 | 0.54 | 1.62 | Bolt query floor |
| Python/FastMCP | node count | 21.14 | 31.57 | Memgraph dominates |
| TS/Hono MCP | node count | 19.11 | 25.31 | Faster than Python in this run |
| Go MCP | node count | 17.46 | 26.94 | Close to direct Bolt |
| Direct Memgraph | node count | 16.38 | 28.33 | Bolt query floor |
| Python/FastMCP | one-hop expand 50 | 52.09 | 76.00 | Memgraph dominates |
| TS/Hono MCP | one-hop expand 50 | 51.02 | 79.49 | Similar p50, noisy p95 |
| Go MCP | one-hop expand 50 | 49.13 | 56.97 | Best MCP p95 in this run |
| Direct Memgraph | one-hop expand 50 | 48.16 | 48.63 | Bolt query floor |

## x402 Notes

Current x402 docs list Go support for the pieces this direction needs:

- MCP server payment wrapper: TypeScript, Go, Python.
- `upto` on EVM permit2: TypeScript, Go, Python.
- `batch-settlement` on EVM EIP-3009 and permit2: TypeScript and Go, not Python.
- HTTP server dynamic price/pay-to: TypeScript, Go, Python.

References:

- `https://docs.x402.org/sdk-features`
- `https://pkg.go.dev/github.com/x402-foundation/x402/go/mcp`

## Decision Rule

TypeScript/Hono should replace the Python MCP runtime only if it:

- matches the `graph_query` MCP envelope and validation behavior;
- passes MCP Inspector and Chain Insights CLI calls;
- materially improves p95 latency or operational simplicity;
- makes x402 dynamic pricing simpler enough to justify the port.

Go should proceed only if it also passes x402 integration. The raw MCP/runtime numbers now justify taking that next step.

## Verdict

VALIDATED for a Go graph-query-only MCP runtime spike, not yet validated as a paid production server.

TypeScript/Hono is viable and MCP-compatible. Go is also viable and materially closer to direct Memgraph for small reads, while matching or beating the other MCP runtimes for the tested query classes.

Recommendation:

- Keep GraphRAG sync in Python.
- Port the paid `graph_query` runtime candidate to Go next, specifically testing the official x402 Go MCP wrapper.
- Keep high-level Chain Insights framework tools in TypeScript unless Go proves useful beyond the graph primitive.
- Treat Go as the hard graph-access boundary: one tool, read-only Cypher, x402 paid surface, no framework/case logic.
