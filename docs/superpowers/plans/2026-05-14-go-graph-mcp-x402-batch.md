# Go Graph MCP x402 Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production Go Graph MCP server that exposes paid read-only `graph_query` and `graph_query_batch`, then adapt Chain Insights to use it as the trusted paid graph primitive.

**Architecture:** GraphRAG keeps Python sync and Memgraph ownership, but its paid public MCP runtime becomes a small Go service with direct Bolt access, read-only Cypher guardrails, x402 enforcement, and debug bearer bypass for local testing. Chain Insights remains the local user-side MCP/framework layer: wallet, balance, prompts, cases, claims, artifacts, and high-level AML recipes call the paid Go graph primitive instead of owning the billing boundary.

**Tech Stack:** Go 1.25, `github.com/modelcontextprotocol/go-sdk/mcp`, `github.com/neo4j/neo4j-go-driver/v5`, `github.com/x402-foundation/x402/go`, Docker, Memgraph, TypeScript, Node 22+, MCP TypeScript SDK, Hono, Vitest.

---

## Non-Negotiable Decisions

- The trusted billing boundary is the server-side Go Graph MCP service, not local Chain Insights Hono. Local Chain Insights can be modified by users and must not be trusted for payment enforcement.
- `graph_query` stays a single-query tool.
- `graph_query_batch` is a separate tool. Do not overload `graph_query` with `query: string | string[]`.
- One `graph_query_batch` call means one x402 payment challenge and one settlement path.
- Batch execution is sequential for v1. Parallelism can be considered after pricing and observability are stable.
- `per_query_timeout_seconds` is per query, not total batch time.
- Default and maximum `per_query_timeout_seconds` is `10`.
- Compute pricing is `0.01 USDC` per started query-second, equivalent to `0.10 USDC` per 10 seconds.
- Minimum charge for a successful paid call is `0.01 USDC`.
- Batch billable seconds are `max(1, ceil(sum(per_query_elapsed_ms) / 1000))`.
- A batch with 20 queries that each consume 10 seconds has a maximum compute charge of `2.00 USDC`.
- Read-only Cypher only. Block `MERGE`, `DELETE`, `CREATE`, `SET`, `REMOVE`, `DROP`, and `DETACH`.
- If a query omits `LIMIT`, append `LIMIT 1000`.
- High-level AML tools (`address_risk`, `track_funds`, `money_flows_between_exchanges`, `address_connection_risk`, probes) move into Chain Insights as local recipes over `graph_query_batch`.
- GraphRAG Python high-level tool code can remain as reference code, but it must not be registered on the paid public GraphRAG MCP surface once the Go service is promoted.
- GraphRAG sync remains Python.
- Chain Insights `topup` is not advertised as a working happy path. `balance` remains the local wallet surface.

## Current Evidence

Spike artifact:

```text
/home/aphex5/work/chain-insights/.planning/spikes/001-graph-mcp-runtime-comparison/
```

Latest benchmark evidence:

| Target | Query | p95 ms |
|---|---:|---:|
| Python/FastMCP | address sample 10 | 5.34 |
| TS/Hono MCP | address sample 10 | 3.39 |
| Go MCP | address sample 10 | 2.00 |
| Direct Memgraph | address sample 10 | 1.62 |
| Python/FastMCP | one-hop expand 50 | 76.00 |
| TS/Hono MCP | one-hop expand 50 | 79.49 |
| Go MCP | one-hop expand 50 | 56.97 |
| Direct Memgraph | one-hop expand 50 | 48.63 |

The Go runtime is close enough to direct Bolt to justify the production spike. The remaining gate is x402 in Go with one paid batch call.

## Target Runtime Topology

```text
Codex / Claude Code / Claude Desktop / MCP client
  -> local Chain Insights MCP
       - wallet and balance
       - prompts and help
       - cases, claims, evidence, dossiers, artifacts
       - high-level AML recipes
       - local localhost visualization server
       - calls graph_query or graph_query_batch
  -> paid Go Graph MCP
       - x402 payment enforcement
       - debug bearer bypass for UAT
       - read-only Cypher validation
       - direct Memgraph Bolt query execution
  -> Memgraph
```

## File Structure

GraphRAG repo: `/home/aphex5/work/rbmk/repos/ml/graphrag`

- Create `go.mod`: Go module for the paid Graph MCP runtime.
- Create `cmd/graphrag-mcp-go/main.go`: process entrypoint and HTTP listener.
- Create `internal/graphmcp/config.go`: environment parsing and defaults.
- Create `internal/graphmcp/cypher.go`: read-only Cypher validation and limit injection.
- Create `internal/graphmcp/result.go`: Chain Insights MCP result envelope builders.
- Create `internal/graphmcp/memgraph.go`: Bolt driver pool, row serialization, query runner.
- Create `internal/graphmcp/batch.go`: sequential batch execution, per-query timeout, billing meter.
- Create `internal/graphmcp/tools.go`: MCP tool schemas and handlers.
- Create `internal/graphmcp/x402.go`: x402 mode selection, debug bearer bypass, paid wrapper.
- Create `internal/graphmcp/server.go`: MCP server and HTTP route assembly.
- Create `internal/graphmcp/*_test.go`: focused Go unit tests.
- Create `ops/Dockerfile.mcp-go`: production Go build image.
- Modify `README.md`: document the Go Graph MCP runtime.
- Modify `CLAUDE.md` and `AGENTS.md`: update repo-local agent instructions.
- Modify compose config under `/home/aphex5/work/rbmk/repos/ml/compose/`: add side-by-side `graphrag-mcp-go` service first.

Chain Insights repo: `/home/aphex5/work/chain-insights`

- Modify `src/config/schema.ts`: add `graphMcpEndpoint`, `graphMcpAuthToken`, and pricing/client hints if missing.
- Create `src/mcp/graph-client.ts`: typed MCP client for `graph_query` and `graph_query_batch`.
- Modify `src/mcp/proxy.ts`: expose or forward `graph_query_batch`, keep `graph_query` schema strict, do not advertise `topup`.
- Modify `src/mcp/client.ts`: keep x402/debug fetch behavior compatible with the Go endpoint.
- Modify `tests/mcp-graph-client.test.ts`: unit tests for batch client behavior.
- Modify `tests/cli-mcp.test.ts` and `tests/mcp-proxy.test.ts`: tool schema and proxy regression tests.
- Modify `README.md`: operator docs for local Chain Insights MCP plus Go Graph MCP.

Follow-up plan, not part of this implementation file:

- Port each high-level AML recipe from GraphRAG reference code into Chain Insights over `graph_query_batch`.
- Build framework case workflows around claims/evidence/dossiers after the paid primitive is stable.

## Result Contract

`graph_query` returns:

```json
{
  "schema": "chain-insights.result.v1",
  "tool": "graph_query",
  "hint": null,
  "facts": {
    "subject": { "network": "bittensor" },
    "query": {
      "results": [{ "address": "5..." }],
      "count": 1,
      "elapsed_ms": 3
    }
  }
}
```

`graph_query_batch` returns:

```json
{
  "schema": "chain-insights.result.v1",
  "tool": "graph_query_batch",
  "hint": null,
  "facts": {
    "subject": { "network": "bittensor" },
    "batch": {
      "count": 2,
      "completed": 1,
      "failed": 1,
      "per_query_timeout_seconds": 10,
      "total_query_elapsed_ms": 1345,
      "billable_seconds": 2,
      "estimated_usdc": "0.02"
    },
    "queries": [
      {
        "id": "q1",
        "ok": true,
        "query": "MATCH (n) RETURN count(n) AS count LIMIT 1",
        "elapsed_ms": 1200,
        "count": 1,
        "results": [{ "count": 123 }]
      },
      {
        "id": "q2",
        "ok": false,
        "query": "CREATE (n)",
        "elapsed_ms": 0,
        "error": "Write operations are not permitted",
        "count": 0,
        "results": []
      }
    ]
  }
}
```

The model-visible contract intentionally contains results. This is the graph primitive. Chain Insights high-level tools decide what to persist as artifacts and what to keep out of LLM-visible output.

## Task 1: Create Go Module and Config Boundary

**Files:**
- Create: `/home/aphex5/work/rbmk/repos/ml/graphrag/go.mod`
- Create: `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/config.go`
- Create: `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/config_test.go`

- [ ] **Step 1: Write failing config tests**

Create `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/config_test.go`:

```go
package graphmcp

import "testing"

func TestLoadConfigDefaults(t *testing.T) {
	t.Setenv("PORT", "")
	t.Setenv("MEMGRAPH_URI", "")
	t.Setenv("GRAPH_MCP_DEBUG_TOKEN", "")

	cfg := LoadConfig()

	if cfg.Port != 8012 {
		t.Fatalf("Port = %d, want 8012", cfg.Port)
	}
	if cfg.DefaultMemgraphURI != "bolt://127.0.0.1:7687" {
		t.Fatalf("DefaultMemgraphURI = %q", cfg.DefaultMemgraphURI)
	}
	if cfg.PerQueryTimeoutSeconds != 10 {
		t.Fatalf("PerQueryTimeoutSeconds = %d, want 10", cfg.PerQueryTimeoutSeconds)
	}
	if cfg.MaxBatchQueries != 20 {
		t.Fatalf("MaxBatchQueries = %d, want 20", cfg.MaxBatchQueries)
	}
	if cfg.PricePerSecondUSDC != "0.01" {
		t.Fatalf("PricePerSecondUSDC = %q, want 0.01", cfg.PricePerSecondUSDC)
	}
}

func TestLoadConfigNetworkSpecificMemgraphURI(t *testing.T) {
	t.Setenv("MEMGRAPH_URI_BITTENSOR", "bolt://memgraph-bittensor:7687")
	t.Setenv("MEMGRAPH_URI_BASE", "bolt://memgraph-base:7687")

	cfg := LoadConfig()

	if got := cfg.MemgraphURIFor("bittensor"); got != "bolt://memgraph-bittensor:7687" {
		t.Fatalf("bittensor URI = %q", got)
	}
	if got := cfg.MemgraphURIFor("base"); got != "bolt://memgraph-base:7687" {
		t.Fatalf("base URI = %q", got)
	}
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
docker run --rm -v "$PWD":/work -w /work golang:1.25-alpine sh -lc '/usr/local/go/bin/go test ./internal/graphmcp'
```

Expected: FAIL because the module and package do not exist.

- [ ] **Step 3: Add module and config implementation**

Create `/home/aphex5/work/rbmk/repos/ml/graphrag/go.mod`:

```go
module github.com/chainswarm/graphrag

go 1.25

require (
	github.com/modelcontextprotocol/go-sdk v0.4.0
	github.com/neo4j/neo4j-go-driver/v5 v5.28.4
	github.com/x402-foundation/x402/go v0.0.0-20260513203758-9a718b002deb
)
```

Create `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/config.go`:

```go
package graphmcp

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port                   int
	DefaultMemgraphURI      string
	MemgraphURIs           map[string]string
	MemgraphUser           string
	MemgraphPassword       string
	PoolSize               int
	PerQueryTimeoutSeconds int
	MaxBatchQueries        int
	PricePerSecondUSDC     string
	DebugToken             string
	X402Enabled            bool
	X402Network            string
	X402Asset              string
	X402PayTo              string
	X402FacilitatorURL     string
}

func LoadConfig() Config {
	return Config{
		Port:                   envInt("PORT", 8012),
		DefaultMemgraphURI:      envString("MEMGRAPH_URI", "bolt://127.0.0.1:7687"),
		MemgraphURIs:           loadNetworkURIs(),
		MemgraphUser:           os.Getenv("MEMGRAPH_USER"),
		MemgraphPassword:       os.Getenv("MEMGRAPH_PASSWORD"),
		PoolSize:               envInt("MEMGRAPH_POOL_SIZE", 32),
		PerQueryTimeoutSeconds: envInt("GRAPH_MCP_PER_QUERY_TIMEOUT_SECONDS", 10),
		MaxBatchQueries:        envInt("GRAPH_MCP_MAX_BATCH_QUERIES", 20),
		PricePerSecondUSDC:     envString("GRAPH_MCP_PRICE_PER_SECOND_USDC", "0.01"),
		DebugToken:             os.Getenv("GRAPH_MCP_DEBUG_TOKEN"),
		X402Enabled:            envBool("X402_ENABLED", false),
		X402Network:            envString("X402_NETWORK", "eip155:8453"),
		X402Asset:              os.Getenv("X402_ASSET"),
		X402PayTo:              os.Getenv("X402_PAY_TO"),
		X402FacilitatorURL:     os.Getenv("X402_FACILITATOR_URL"),
	}
}

func (c Config) MemgraphURIFor(network string) string {
	key := strings.ToLower(strings.TrimSpace(network))
	if uri, ok := c.MemgraphURIs[key]; ok && uri != "" {
		return uri
	}
	return c.DefaultMemgraphURI
}

func loadNetworkURIs() map[string]string {
	return map[string]string{
		"bittensor":     os.Getenv("MEMGRAPH_URI_BITTENSOR"),
		"bittensor_evm": os.Getenv("MEMGRAPH_URI_BITTENSOR"),
		"base":          os.Getenv("MEMGRAPH_URI_BASE"),
		"ethereum":      os.Getenv("MEMGRAPH_URI_ETHEREUM"),
	}
}

func envString(name string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	return value
}

func envInt(name string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envBool(name string, fallback bool) bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(name)))
	switch value {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
docker run --rm -v "$PWD":/work -w /work golang:1.25-alpine sh -lc '/usr/local/go/bin/gofmt -w internal/graphmcp && /usr/local/go/bin/go test ./internal/graphmcp'
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
git add go.mod internal/graphmcp/config.go internal/graphmcp/config_test.go
git commit -m "feat: add Go graph MCP config"
```

## Task 2: Implement Read-Only Cypher Guardrails

**Files:**
- Create: `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/cypher.go`
- Create: `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/cypher_test.go`

- [ ] **Step 1: Write failing Cypher tests**

Create `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/cypher_test.go`:

```go
package graphmcp

import "testing"

func TestValidateReadOnlyCypherRejectsEmpty(t *testing.T) {
	_, err := ValidateReadOnlyCypher("   ")
	if err == nil || err.Error() != "Query cannot be empty" {
		t.Fatalf("err = %v, want Query cannot be empty", err)
	}
}

func TestValidateReadOnlyCypherRejectsWriteKeywords(t *testing.T) {
	for _, query := range []string{
		"MATCH (n) SET n.flag = true RETURN n",
		"CREATE (n)",
		"MATCH (n) DETACH DELETE n",
		"MERGE (n:Address {address: 'x'})",
		"MATCH (n) REMOVE n.flag",
		"DROP INDEX ON :Address(address)",
	} {
		_, err := ValidateReadOnlyCypher(query)
		if err == nil || err.Error() != "Write operations are not permitted" {
			t.Fatalf("query %q err = %v", query, err)
		}
	}
}

func TestValidateReadOnlyCypherAppendsLimit(t *testing.T) {
	got, err := ValidateReadOnlyCypher("MATCH (n) RETURN n;")
	if err != nil {
		t.Fatal(err)
	}
	if got != "MATCH (n) RETURN n LIMIT 1000" {
		t.Fatalf("got %q", got)
	}
}

func TestValidateReadOnlyCypherKeepsExistingLimit(t *testing.T) {
	got, err := ValidateReadOnlyCypher("MATCH (n) RETURN n LIMIT 5")
	if err != nil {
		t.Fatal(err)
	}
	if got != "MATCH (n) RETURN n LIMIT 5" {
		t.Fatalf("got %q", got)
	}
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
docker run --rm -v "$PWD":/work -w /work golang:1.25-alpine sh -lc '/usr/local/go/bin/go test ./internal/graphmcp -run Cypher'
```

Expected: FAIL because `ValidateReadOnlyCypher` does not exist.

- [ ] **Step 3: Implement Cypher validation**

Create `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/cypher.go`:

```go
package graphmcp

import (
	"errors"
	"regexp"
	"strings"
)

var (
	writeKeywordPattern = regexp.MustCompile(`(?i)\b(MERGE|DELETE|CREATE|SET|REMOVE|DROP|DETACH)\b`)
	limitPattern        = regexp.MustCompile(`(?i)\bLIMIT\b`)
)

func ValidateReadOnlyCypher(query string) (string, error) {
	trimmed := strings.TrimSpace(query)
	if trimmed == "" {
		return "", errors.New("Query cannot be empty")
	}
	if writeKeywordPattern.MatchString(trimmed) {
		return "", errors.New("Write operations are not permitted")
	}
	if limitPattern.MatchString(trimmed) {
		return trimmed, nil
	}
	withoutSemicolon := strings.TrimSpace(strings.TrimRight(trimmed, ";"))
	return withoutSemicolon + " LIMIT 1000", nil
}
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
docker run --rm -v "$PWD":/work -w /work golang:1.25-alpine sh -lc '/usr/local/go/bin/gofmt -w internal/graphmcp && /usr/local/go/bin/go test ./internal/graphmcp -run Cypher'
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
git add internal/graphmcp/cypher.go internal/graphmcp/cypher_test.go
git commit -m "feat: guard read-only graph cypher"
```

## Task 3: Build Result Envelopes and Pricing Math

**Files:**
- Create: `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/result.go`
- Create: `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/result_test.go`

- [ ] **Step 1: Write failing result tests**

Create `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/result_test.go`:

```go
package graphmcp

import "testing"

func TestBuildGraphQueryStructuredContent(t *testing.T) {
	content := BuildGraphQueryStructuredContent("bittensor", []map[string]any{
		{"address": "5abc"},
	}, 12)

	if content.Schema != "chain-insights.result.v1" {
		t.Fatalf("schema = %q", content.Schema)
	}
	if content.Tool != "graph_query" {
		t.Fatalf("tool = %q", content.Tool)
	}
	query := content.Facts["query"].(map[string]any)
	if query["count"] != 1 {
		t.Fatalf("count = %#v", query["count"])
	}
	if query["elapsed_ms"] != int64(12) {
		t.Fatalf("elapsed_ms = %#v", query["elapsed_ms"])
	}
}

func TestBillableSecondsRoundsUpWithMinimum(t *testing.T) {
	if got := BillableSeconds(0); got != 1 {
		t.Fatalf("0ms billable = %d, want 1", got)
	}
	if got := BillableSeconds(1); got != 1 {
		t.Fatalf("1ms billable = %d, want 1", got)
	}
	if got := BillableSeconds(1001); got != 2 {
		t.Fatalf("1001ms billable = %d, want 2", got)
	}
}

func TestEstimatedUSDC(t *testing.T) {
	got := EstimatedUSDC(12, "0.01")
	if got != "0.12" {
		t.Fatalf("EstimatedUSDC = %q, want 0.12", got)
	}
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
docker run --rm -v "$PWD":/work -w /work golang:1.25-alpine sh -lc '/usr/local/go/bin/go test ./internal/graphmcp -run "Result|Billable|Estimated"'
```

Expected: FAIL because result helpers do not exist.

- [ ] **Step 3: Implement result helpers**

Create `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/result.go`:

```go
package graphmcp

import (
	"fmt"
	"math"
	"strconv"
)

const ChainInsightsResultSchema = "chain-insights.result.v1"

type ChainInsightsResult struct {
	Schema string         `json:"schema"`
	Tool   string         `json:"tool"`
	Hint   *string        `json:"hint"`
	Facts  map[string]any `json:"facts"`
}

func BuildGraphQueryStructuredContent(network string, rows []map[string]any, elapsedMS int64) ChainInsightsResult {
	return ChainInsightsResult{
		Schema: ChainInsightsResultSchema,
		Tool:   "graph_query",
		Hint:   nil,
		Facts: map[string]any{
			"subject": map[string]any{"network": network},
			"query": map[string]any{
				"results":    rows,
				"count":      len(rows),
				"elapsed_ms": elapsedMS,
			},
		},
	}
}

func BillableSeconds(totalElapsedMS int64) int {
	if totalElapsedMS <= 0 {
		return 1
	}
	return int(math.Max(1, math.Ceil(float64(totalElapsedMS)/1000)))
}

func EstimatedUSDC(seconds int, pricePerSecond string) string {
	price, err := strconv.ParseFloat(pricePerSecond, 64)
	if err != nil {
		price = 0.01
	}
	return fmt.Sprintf("%.2f", float64(seconds)*price)
}
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
docker run --rm -v "$PWD":/work -w /work golang:1.25-alpine sh -lc '/usr/local/go/bin/gofmt -w internal/graphmcp && /usr/local/go/bin/go test ./internal/graphmcp -run "Result|Billable|Estimated"'
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
git add internal/graphmcp/result.go internal/graphmcp/result_test.go
git commit -m "feat: add graph MCP result helpers"
```

## Task 4: Implement Sequential Batch Executor

**Files:**
- Create: `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/batch.go`
- Create: `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/batch_test.go`

- [ ] **Step 1: Write failing batch tests**

Create `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/batch_test.go`:

```go
package graphmcp

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeRunner struct {
	rows []map[string]any
	err  error
}

func (r fakeRunner) RunReadQuery(ctx context.Context, network string, query string) ([]map[string]any, error) {
	if r.err != nil {
		return nil, r.err
	}
	return r.rows, nil
}

func TestExecuteBatchRejectsTooManyQueries(t *testing.T) {
	queries := make([]BatchQuery, 3)
	_, err := ExecuteBatch(context.Background(), fakeRunner{}, "bittensor", queries, BatchOptions{
		MaxQueries:              2,
		PerQueryTimeoutSeconds: 10,
	})
	if err == nil || err.Error() != "Too many queries: max 2" {
		t.Fatalf("err = %v", err)
	}
}

func TestExecuteBatchCapturesValidationFailurePerQuery(t *testing.T) {
	results, err := ExecuteBatch(context.Background(), fakeRunner{}, "bittensor", []BatchQuery{
		{ID: "bad", Query: "CREATE (n)"},
	}, BatchOptions{MaxQueries: 20, PerQueryTimeoutSeconds: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 {
		t.Fatalf("len = %d", len(results))
	}
	if results[0].OK {
		t.Fatal("expected validation failure")
	}
	if results[0].Error != "Write operations are not permitted" {
		t.Fatalf("error = %q", results[0].Error)
	}
}

func TestExecuteBatchReturnsRows(t *testing.T) {
	results, err := ExecuteBatch(context.Background(), fakeRunner{
		rows: []map[string]any{{"count": 3}},
	}, "bittensor", []BatchQuery{
		{ID: "count", Query: "MATCH (n) RETURN count(n) AS count"},
	}, BatchOptions{MaxQueries: 20, PerQueryTimeoutSeconds: 10})
	if err != nil {
		t.Fatal(err)
	}
	if !results[0].OK {
		t.Fatalf("result error = %q", results[0].Error)
	}
	if results[0].Count != 1 {
		t.Fatalf("count = %d", results[0].Count)
	}
	if results[0].Query != "MATCH (n) RETURN count(n) AS count LIMIT 1000" {
		t.Fatalf("query = %q", results[0].Query)
	}
}

func TestExecuteBatchCapturesRunnerError(t *testing.T) {
	results, err := ExecuteBatch(context.Background(), fakeRunner{err: errors.New("bolt failed")}, "bittensor", []BatchQuery{
		{ID: "q1", Query: "MATCH (n) RETURN n LIMIT 1"},
	}, BatchOptions{MaxQueries: 20, PerQueryTimeoutSeconds: 10})
	if err != nil {
		t.Fatal(err)
	}
	if results[0].OK {
		t.Fatal("expected runner error")
	}
	if results[0].Error != "An unexpected error occurred executing the query" {
		t.Fatalf("error = %q", results[0].Error)
	}
}

func TestBatchTimeoutDuration(t *testing.T) {
	if got := batchTimeout(7); got != 7*time.Second {
		t.Fatalf("timeout = %v", got)
	}
	if got := batchTimeout(0); got != 10*time.Second {
		t.Fatalf("default timeout = %v", got)
	}
}

func TestBuildGraphQueryBatchStructuredContent(t *testing.T) {
	content := BuildGraphQueryBatchStructuredContent("bittensor", 10, "0.01", []BatchQueryResult{
		{ID: "q1", OK: true, Query: "MATCH (n) RETURN n LIMIT 1", ElapsedMS: 1200, Count: 1, Rows: []map[string]any{{"address": "5abc"}}},
		{ID: "q2", OK: false, Query: "CREATE (n)", Error: "Write operations are not permitted", Rows: []map[string]any{}},
	})

	if content.Tool != "graph_query_batch" {
		t.Fatalf("tool = %q", content.Tool)
	}
	batch := content.Facts["batch"].(map[string]any)
	if batch["count"] != 2 {
		t.Fatalf("count = %#v", batch["count"])
	}
	if batch["completed"] != 1 {
		t.Fatalf("completed = %#v", batch["completed"])
	}
	if batch["failed"] != 1 {
		t.Fatalf("failed = %#v", batch["failed"])
	}
	if batch["billable_seconds"] != 2 {
		t.Fatalf("billable_seconds = %#v", batch["billable_seconds"])
	}
	if batch["estimated_usdc"] != "0.02" {
		t.Fatalf("estimated_usdc = %#v", batch["estimated_usdc"])
	}
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
docker run --rm -v "$PWD":/work -w /work golang:1.25-alpine sh -lc '/usr/local/go/bin/go test ./internal/graphmcp -run Batch'
```

Expected: FAIL because batch types do not exist.

- [ ] **Step 3: Implement batch executor**

Create `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/batch.go`:

```go
package graphmcp

import (
	"context"
	"errors"
	"fmt"
	"time"
)

type QueryRunner interface {
	RunReadQuery(ctx context.Context, network string, query string) ([]map[string]any, error)
}

type BatchQuery struct {
	ID    string `json:"id"`
	Query string `json:"query"`
}

type BatchOptions struct {
	MaxQueries              int
	PerQueryTimeoutSeconds int
}

type BatchQueryResult struct {
	ID        string
	OK        bool
	Query     string
	ElapsedMS int64
	Count     int
	Rows      []map[string]any
	Error     string
}

func (r BatchQueryResult) ToFact() map[string]any {
	fact := map[string]any{
		"id":         r.ID,
		"ok":         r.OK,
		"query":      r.Query,
		"elapsed_ms": r.ElapsedMS,
		"count":      r.Count,
		"results":    r.Rows,
	}
	if !r.OK {
		fact["error"] = r.Error
	}
	return fact
}

func ExecuteBatch(ctx context.Context, runner QueryRunner, network string, queries []BatchQuery, opts BatchOptions) ([]BatchQueryResult, error) {
	maxQueries := opts.MaxQueries
	if maxQueries <= 0 {
		maxQueries = 20
	}
	if len(queries) > maxQueries {
		return nil, fmt.Errorf("Too many queries: max %d", maxQueries)
	}
	results := make([]BatchQueryResult, 0, len(queries))
	for index, query := range queries {
		queryID := query.ID
		if queryID == "" {
			queryID = fmt.Sprintf("q%d", index+1)
		}
		validated, err := ValidateReadOnlyCypher(query.Query)
		if err != nil {
			results = append(results, BatchQueryResult{
				ID:    queryID,
				OK:    false,
				Query: query.Query,
				Rows:  []map[string]any{},
				Error: err.Error(),
			})
			continue
		}
		queryCtx, cancel := context.WithTimeout(ctx, batchTimeout(opts.PerQueryTimeoutSeconds))
		start := time.Now()
		rows, runErr := runner.RunReadQuery(queryCtx, network, validated)
		elapsed := time.Since(start).Milliseconds()
		cancel()
		if runErr != nil {
			results = append(results, BatchQueryResult{
				ID:        queryID,
				OK:        false,
				Query:     validated,
				ElapsedMS: elapsed,
				Rows:      []map[string]any{},
				Error:     normalizeQueryError(runErr),
			})
			continue
		}
		results = append(results, BatchQueryResult{
			ID:        queryID,
			OK:        true,
			Query:     validated,
			ElapsedMS: elapsed,
			Count:     len(rows),
			Rows:      rows,
		})
	}
	return results, nil
}

func batchTimeout(seconds int) time.Duration {
	if seconds <= 0 {
		seconds = 10
	}
	return time.Duration(seconds) * time.Second
}

func normalizeQueryError(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "Query timed out"
	}
	return "An unexpected error occurred executing the query"
}
```

- [ ] **Step 4: Add batch envelope builder**

Append this function to `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/result.go`:

```go
func BuildGraphQueryBatchStructuredContent(
	network string,
	perQueryTimeoutSeconds int,
	pricePerSecondUSDC string,
	items []BatchQueryResult,
) ChainInsightsResult {
	var completed int
	var failed int
	var totalElapsed int64
	queryFacts := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if item.OK {
			completed++
		} else {
			failed++
		}
		totalElapsed += item.ElapsedMS
		queryFacts = append(queryFacts, item.ToFact())
	}
	billable := BillableSeconds(totalElapsed)
	return ChainInsightsResult{
		Schema: ChainInsightsResultSchema,
		Tool:   "graph_query_batch",
		Hint:   nil,
		Facts: map[string]any{
			"subject": map[string]any{"network": network},
			"batch": map[string]any{
				"count":                     len(items),
				"completed":                 completed,
				"failed":                    failed,
				"per_query_timeout_seconds": perQueryTimeoutSeconds,
				"total_query_elapsed_ms":    totalElapsed,
				"billable_seconds":          billable,
				"estimated_usdc":            EstimatedUSDC(billable, pricePerSecondUSDC),
			},
			"queries": queryFacts,
		},
	}
}
```

- [ ] **Step 5: Run tests and verify pass**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
docker run --rm -v "$PWD":/work -w /work golang:1.25-alpine sh -lc '/usr/local/go/bin/gofmt -w internal/graphmcp && /usr/local/go/bin/go test ./internal/graphmcp -run "Batch|Result|Billable|Estimated"'
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
git add internal/graphmcp/result.go internal/graphmcp/batch.go internal/graphmcp/batch_test.go
git commit -m "feat: add graph query batch metering"
```

## Task 5: Add Memgraph Bolt Runner

**Status:** Completed in GraphRAG worktree commits `6278fe0` and `930852a`.

**Files:**
- Create: `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/memgraph.go`
- Create: `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/memgraph_test.go`

- [ ] **Step 1: Write serialization tests**

Create `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/memgraph_test.go`:

```go
package graphmcp

import "testing"

func TestSerializeValueKeepsPrimitiveValues(t *testing.T) {
	cases := []any{"5abc", int64(12), float64(1.5), true, nil}
	for _, input := range cases {
		if got := serializeValue(input); got != input {
			t.Fatalf("serializeValue(%#v) = %#v", input, got)
		}
	}
}

func TestSerializeValueConvertsNestedSlice(t *testing.T) {
	got := serializeValue([]any{"a", int64(1)}).([]any)
	if got[0] != "a" || got[1] != int64(1) {
		t.Fatalf("got %#v", got)
	}
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
docker run --rm -v "$PWD":/work -w /work golang:1.25-alpine sh -lc '/usr/local/go/bin/go test ./internal/graphmcp -run Serialize'
```

Expected: FAIL because `serializeValue` does not exist.

- [ ] **Step 3: Implement Memgraph pool and runner**

Create `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/memgraph.go` using the working spike as the source. Keep these public methods and names:

```go
package graphmcp

import (
	"context"
	"sync"
	"time"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
	"github.com/neo4j/neo4j-go-driver/v5/neo4j/dbtype"
)

type MemgraphPool struct {
	cfg     Config
	mu      sync.Mutex
	drivers map[string]neo4j.DriverWithContext
}

func NewMemgraphPool(cfg Config) *MemgraphPool {
	return &MemgraphPool{cfg: cfg, drivers: map[string]neo4j.DriverWithContext{}}
}

func (p *MemgraphPool) RunReadQuery(ctx context.Context, network string, query string) ([]map[string]any, error) {
	driver, err := p.driverFor(network)
	if err != nil {
		return nil, err
	}
	session := driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer func() { _ = session.Close(context.Background()) }()
	result, err := session.Run(ctx, query, nil)
	if err != nil {
		return nil, err
	}
	rows := make([]map[string]any, 0)
	for result.Next(ctx) {
		record := result.Record()
		row := map[string]any{}
		for _, key := range record.Keys {
			value, _ := record.Get(key)
			row[key] = serializeValue(value)
		}
		rows = append(rows, row)
	}
	if err := result.Err(); err != nil {
		return nil, err
	}
	return rows, nil
}

func (p *MemgraphPool) Close(ctx context.Context) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, driver := range p.drivers {
		_ = driver.Close(ctx)
	}
	p.drivers = map[string]neo4j.DriverWithContext{}
}

func (p *MemgraphPool) driverFor(network string) (neo4j.DriverWithContext, error) {
	uri := p.cfg.MemgraphURIFor(network)
	p.mu.Lock()
	defer p.mu.Unlock()
	if driver, ok := p.drivers[uri]; ok {
		return driver, nil
	}
	auth := neo4j.NoAuth()
	if p.cfg.MemgraphUser != "" {
		auth = neo4j.BasicAuth(p.cfg.MemgraphUser, p.cfg.MemgraphPassword, "")
	}
	driver, err := neo4j.NewDriverWithContext(uri, auth, func(config *neo4j.Config) {
		config.MaxConnectionPoolSize = p.cfg.PoolSize
		config.ConnectionAcquisitionTimeout = 5 * time.Second
		config.SocketConnectTimeout = 5 * time.Second
	})
	if err != nil {
		return nil, err
	}
	p.drivers[uri] = driver
	return driver, nil
}

func serializeValue(value any) any {
	switch typed := value.(type) {
	case dbtype.Node:
		return map[string]any{
			"id":         typed.ElementId,
			"labels":     typed.Labels,
			"properties": serializeMap(typed.Props),
		}
	case dbtype.Relationship:
		return map[string]any{
			"id":         typed.ElementId,
			"type":       typed.Type,
			"start":      typed.StartElementId,
			"end":        typed.EndElementId,
			"properties": serializeMap(typed.Props),
		}
	case dbtype.Path:
		return map[string]any{
			"nodes":         serializeSlice(nodesToAny(typed.Nodes)),
			"relationships": serializeSlice(relationshipsToAny(typed.Relationships)),
		}
	case map[string]any:
		return serializeMap(typed)
	case []any:
		return serializeSlice(typed)
	default:
		return value
	}
}

func serializeMap(input map[string]any) map[string]any {
	output := map[string]any{}
	for key, value := range input {
		output[key] = serializeValue(value)
	}
	return output
}

func serializeSlice(input []any) []any {
	output := make([]any, 0, len(input))
	for _, value := range input {
		output = append(output, serializeValue(value))
	}
	return output
}

func nodesToAny(nodes []dbtype.Node) []any {
	values := make([]any, 0, len(nodes))
	for _, node := range nodes {
		values = append(values, node)
	}
	return values
}

func relationshipsToAny(rels []dbtype.Relationship) []any {
	values := make([]any, 0, len(rels))
	for _, rel := range rels {
		values = append(values, rel)
	}
	return values
}
```

- [ ] **Step 4: Run unit tests**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
docker run --rm -v "$PWD":/work -w /work golang:1.25-alpine sh -lc '/usr/local/go/bin/gofmt -w internal/graphmcp && /usr/local/go/bin/go test ./internal/graphmcp'
```

Expected: PASS.

- [ ] **Step 5: Add optional live Memgraph smoke command**

Run only when Memgraph is up:

```bash
cd /home/aphex5/work/rbmk
docker compose up -d memgraph-bittensor
cd /home/aphex5/work/rbmk/repos/ml/graphrag
MEMGRAPH_URI_BITTENSOR=bolt://host.docker.internal:7687 docker run --rm --add-host=host.docker.internal:host-gateway -v "$PWD":/work -w /work golang:1.25-alpine sh -lc '/usr/local/go/bin/go test ./internal/graphmcp'
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
git add internal/graphmcp/memgraph.go internal/graphmcp/memgraph_test.go
git commit -m "feat: add Memgraph runner for Go MCP"
```

## Task 6: Register MCP Tools

**Status:** Completed in GraphRAG worktree commits `06bfc5a`, `bd006a3`, and `014a8f3`.

**Files:**
- Create: `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/tools.go`
- Create: `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/server.go`
- Create: `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/tools_test.go`
- Create: `/home/aphex5/work/rbmk/repos/ml/graphrag/cmd/graphrag-mcp-go/main.go`

- [ ] **Step 1: Write tool schema tests**

Create `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/tools_test.go`:

```go
package graphmcp

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestGraphQueryBatchSchemaRequiresNetworkAndQueries(t *testing.T) {
	var schema map[string]any
	if err := json.Unmarshal(GraphQueryBatchInputSchema, &schema); err != nil {
		t.Fatal(err)
	}
	required := schema["required"].([]any)
	got := strings.Join([]string{required[0].(string), required[1].(string)}, ",")
	if got != "network,queries" {
		t.Fatalf("required = %s", got)
	}
}

func TestBuildServerInstructionsMentionBatchTimeout(t *testing.T) {
	text := BuildServerInstructions()
	if !strings.Contains(text, "per-query timeout") {
		t.Fatalf("instructions = %q", text)
	}
	if !strings.Contains(text, "graph_query_batch") {
		t.Fatalf("instructions = %q", text)
	}
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
docker run --rm -v "$PWD":/work -w /work golang:1.25-alpine sh -lc '/usr/local/go/bin/go test ./internal/graphmcp -run "GraphQueryBatchSchema|BuildServerInstructions"'
```

Expected: FAIL because tool schema and instruction helpers do not exist.

- [ ] **Step 3: Implement tool schemas and handlers**

Create `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/tools.go` with these exported values and handler flow:

```go
package graphmcp

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

var GraphQueryInputSchema = json.RawMessage(`{
  "type": "object",
  "properties": {
    "network": {"type": "string", "description": "Required network to query: bittensor, ethereum, or base."},
    "query": {"type": "string", "description": "Read-only Cypher query."}
  },
  "required": ["network", "query"],
  "additionalProperties": false
}`)

var GraphQueryBatchInputSchema = json.RawMessage(`{
  "type": "object",
  "properties": {
    "network": {"type": "string", "description": "Required network to query: bittensor, ethereum, or base."},
    "per_query_timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 10, "description": "Per-query timeout. Max 10 seconds."},
    "queries": {
      "type": "array",
      "minItems": 1,
      "maxItems": 20,
      "items": {
        "type": "object",
        "properties": {
          "id": {"type": "string"},
          "query": {"type": "string"}
        },
        "required": ["query"],
        "additionalProperties": false
      }
    }
  },
  "required": ["network", "queries"],
  "additionalProperties": false
}`)

var ChainInsightsOutputSchema = json.RawMessage(`{
  "type": "object",
  "properties": {
    "schema": {"type": "string"},
    "tool": {"type": "string"},
    "hint": {"type": ["string", "null"]},
    "facts": {"type": "object", "additionalProperties": true}
  },
  "required": ["schema", "tool", "facts"],
  "additionalProperties": false
}`)

type GraphQueryArgs struct {
	Network string `json:"network"`
	Query   string `json:"query"`
}

type GraphQueryBatchArgs struct {
	Network                string       `json:"network"`
	PerQueryTimeoutSeconds int          `json:"per_query_timeout_seconds"`
	Queries                []BatchQuery `json:"queries"`
}

func RegisterTools(server *mcp.Server, cfg Config, runner QueryRunner) {
	readOnly := false
	openWorld := true
	server.AddTool(&mcp.Tool{
		Name:        "graph_query",
		Title:       "Cypher Graph Query",
		Description: "Execute one read-only Cypher query against Memgraph. Write operations are blocked. Queries without LIMIT get LIMIT 1000.",
		InputSchema: GraphQueryInputSchema,
		OutputSchema: ChainInsightsOutputSchema,
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, DestructiveHint: &readOnly, IdempotentHint: false, OpenWorldHint: &openWorld},
	}, func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		return HandleGraphQuery(ctx, cfg, runner, req)
	})
	server.AddTool(&mcp.Tool{
		Name:        "graph_query_batch",
		Title:       "Batch Cypher Graph Query",
		Description: "Execute up to 20 read-only Cypher queries sequentially. Each query gets its own timeout, default 10 seconds. Billing is based on total query seconds.",
		InputSchema: GraphQueryBatchInputSchema,
		OutputSchema: ChainInsightsOutputSchema,
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, DestructiveHint: &readOnly, IdempotentHint: false, OpenWorldHint: &openWorld},
	}, func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		return HandleGraphQueryBatch(ctx, cfg, runner, req)
	})
}

func HandleGraphQuery(ctx context.Context, cfg Config, runner QueryRunner, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	var args GraphQueryArgs
	if err := json.Unmarshal(req.Params.Arguments, &args); err != nil {
		return toolError(fmt.Sprintf("Invalid graph_query arguments: %s", err)), nil
	}
	cypher, err := ValidateReadOnlyCypher(args.Query)
	if err != nil {
		return toolError(err.Error()), nil
	}
	batch, err := ExecuteBatch(ctx, runner, args.Network, []BatchQuery{{ID: "q1", Query: cypher}}, BatchOptions{
		MaxQueries:              1,
		PerQueryTimeoutSeconds: cfg.PerQueryTimeoutSeconds,
	})
	if err != nil {
		return toolError(err.Error()), nil
	}
	item := batch[0]
	if !item.OK {
		return toolError(item.Error), nil
	}
	structured := BuildGraphQueryStructuredContent(args.Network, item.Rows, item.ElapsedMS)
	summary, _ := json.Marshal(map[string]any{"results": item.Rows, "count": item.Count})
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(summary)}}, StructuredContent: structured}, nil
}

func HandleGraphQueryBatch(ctx context.Context, cfg Config, runner QueryRunner, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	var args GraphQueryBatchArgs
	if err := json.Unmarshal(req.Params.Arguments, &args); err != nil {
		return toolError(fmt.Sprintf("Invalid graph_query_batch arguments: %s", err)), nil
	}
	timeoutSeconds := args.PerQueryTimeoutSeconds
	if timeoutSeconds <= 0 || timeoutSeconds > cfg.PerQueryTimeoutSeconds {
		timeoutSeconds = cfg.PerQueryTimeoutSeconds
	}
	results, err := ExecuteBatch(ctx, runner, args.Network, args.Queries, BatchOptions{
		MaxQueries:              cfg.MaxBatchQueries,
		PerQueryTimeoutSeconds: timeoutSeconds,
	})
	if err != nil {
		return toolError(err.Error()), nil
	}
	structured := BuildGraphQueryBatchStructuredContent(args.Network, timeoutSeconds, cfg.PricePerSecondUSDC, results)
	summary, _ := json.Marshal(structured.Facts)
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(summary)}}, StructuredContent: structured}, nil
}

func toolError(message string) *mcp.CallToolResult {
	return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: message}}}
}
```

- [ ] **Step 4: Implement server and main**

Create `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/server.go`:

```go
package graphmcp

import (
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func BuildServerInstructions() string {
	return "GraphRAG Graph MCP exposes graph_query and graph_query_batch only. All queries are read-only Cypher. graph_query_batch uses a per-query timeout, default and max 10 seconds, and is billed by total query seconds."
}

func NewMCPServer(cfg Config, runner QueryRunner) *mcp.Server {
	server := mcp.NewServer(
		&mcp.Implementation{Name: "graphrag-graph-mcp-go", Version: "0.1.0"},
		&mcp.ServerOptions{Instructions: BuildServerInstructions()},
	)
	RegisterTools(server, cfg, runner)
	return server
}

func NewHTTPHandler(cfg Config, runner QueryRunner) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","service":"graphrag-graph-mcp-go"}`))
	})
	mux.Handle("/mcp", mcp.NewStreamableHTTPHandler(
		func(*http.Request) *mcp.Server { return NewMCPServer(cfg, runner) },
		&mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true},
	))
	return mux
}
```

Create `/home/aphex5/work/rbmk/repos/ml/graphrag/cmd/graphrag-mcp-go/main.go`:

```go
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"

	"github.com/chainswarm/graphrag/internal/graphmcp"
)

func main() {
	cfg := graphmcp.LoadConfig()
	pool := graphmcp.NewMemgraphPool(cfg)
	defer pool.Close(context.Background())

	addr := "0.0.0.0:" + strconv.Itoa(cfg.Port)
	log.Printf("graphrag Go MCP listening on http://%s/mcp", addr)
	if err := http.ListenAndServe(addr, graphmcp.NewHTTPHandler(cfg, pool)); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(fmt.Errorf("server failed: %w", err))
	}
}
```

- [ ] **Step 5: Run Go tests**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
docker run --rm -v "$PWD":/work -w /work golang:1.25-alpine sh -lc '/usr/local/go/bin/gofmt -w cmd internal/graphmcp && /usr/local/go/bin/go mod tidy && /usr/local/go/bin/go test ./...'
```

Expected: PASS.

- [ ] **Step 6: Run MCP Inspector against Go service**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
docker run --rm -v "$PWD":/work -w /work -e CGO_ENABLED=0 golang:1.25-alpine sh -lc '/usr/local/go/bin/go build -o bin/graphrag-mcp-go ./cmd/graphrag-mcp-go'
PORT=8012 MEMGRAPH_URI_BITTENSOR=bolt://127.0.0.1:7687 ./bin/graphrag-mcp-go
```

In another terminal:

```bash
npx @modelcontextprotocol/inspector \
  --cli http://127.0.0.1:8012/mcp \
  --transport http \
  --method tools/list

npx @modelcontextprotocol/inspector \
  --cli http://127.0.0.1:8012/mcp \
  --transport http \
  --method tools/call \
  --tool-name graph_query \
  --tool-arg network=bittensor \
  --tool-arg 'query=MATCH (n) WHERE n.address IS NOT NULL RETURN labels(n) AS labels, n.address AS address LIMIT 3'
```

Expected: `tools/list` contains only `graph_query` and `graph_query_batch`; `tools/call` returns rows.

- [ ] **Step 7: Commit**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
git add cmd/graphrag-mcp-go internal/graphmcp/tools.go internal/graphmcp/server.go internal/graphmcp/tools_test.go go.mod go.sum
git commit -m "feat: expose graph query MCP tools in Go"
```

## Task 7: Add Debug Bearer and x402 Enforcement Gate

**Status:** Completed as fail-closed UAT gate in GraphRAG worktree commits `8b1663b` and `e80bfeb`; production x402 remains blocked by stock MCP wrapper dynamic-settlement gap documented in README.

**Files:**
- Create: `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/x402.go`
- Create: `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/x402_test.go`
- Modify: `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/server.go`

- [ ] **Step 1: Write debug bypass tests**

Create `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/x402_test.go`:

```go
package graphmcp

import (
	"net/http"
	"testing"
)

func TestHasDebugBypassTokenChecksBothHeaders(t *testing.T) {
	cfg := Config{DebugToken: "dev-token"}
	req, _ := http.NewRequest("POST", "http://example.test/mcp", nil)
	req.Header.Set("X-MCP-Debug-Token", "dev-token")
	if !HasDebugBypassToken(req, cfg) {
		t.Fatal("expected X-MCP-Debug-Token bypass")
	}

	req, _ = http.NewRequest("POST", "http://example.test/mcp", nil)
	req.Header.Set("Authorization", "Bearer dev-token")
	if !HasDebugBypassToken(req, cfg) {
		t.Fatal("expected Authorization bearer bypass")
	}
}

func TestHasDebugBypassTokenRejectsWrongToken(t *testing.T) {
	cfg := Config{DebugToken: "dev-token"}
	req, _ := http.NewRequest("POST", "http://example.test/mcp", nil)
	req.Header.Set("X-MCP-Debug-Token", "wrong")
	if HasDebugBypassToken(req, cfg) {
		t.Fatal("wrong token bypassed")
	}
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
docker run --rm -v "$PWD":/work -w /work golang:1.25-alpine sh -lc '/usr/local/go/bin/go test ./internal/graphmcp -run DebugBypass'
```

Expected: FAIL because debug bypass helpers do not exist.

- [ ] **Step 3: Implement debug bypass helpers**

Create `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/x402.go`:

```go
package graphmcp

import (
	"net/http"
	"strings"
)

func HasDebugBypassToken(req *http.Request, cfg Config) bool {
	expected := strings.TrimSpace(cfg.DebugToken)
	if expected == "" {
		return false
	}
	if req.Header.Get("X-MCP-Debug-Token") == expected {
		return true
	}
	auth := req.Header.Get("Authorization")
	return strings.TrimPrefix(auth, "Bearer ") == expected
}
```

Modify `/home/aphex5/work/rbmk/repos/ml/graphrag/internal/graphmcp/server.go` so `/mcp` can route through an x402 enforcement middleware in Task 7 Step 5. Keep debug bypass first:

```go
func NewHTTPHandler(cfg Config, runner QueryRunner) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","service":"graphrag-graph-mcp-go"}`))
	})
	mcpHandler := mcp.NewStreamableHTTPHandler(
		func(*http.Request) *mcp.Server { return NewMCPServer(cfg, runner) },
		&mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true},
	)
	mux.Handle("/mcp", PaymentMiddleware(cfg, mcpHandler))
	return mux
}
```

- [ ] **Step 4: Add no-op payment middleware first**

Extend `x402.go`:

```go
func PaymentMiddleware(cfg Config, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if HasDebugBypassToken(req, cfg) || !cfg.X402Enabled {
			next.ServeHTTP(w, req)
			return
		}
		http.Error(w, "x402 payment required", http.StatusPaymentRequired)
	})
}
```

This is not the final x402 implementation. It gives a safe, testable gate before wiring the SDK.

- [ ] **Step 5: Compile official x402 Go SDK integration**

Use the current Go SDK APIs under `github.com/x402-foundation/x402/go`. The implementation must use these package families, verified by `go doc` before editing:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
docker run --rm -v "$PWD":/work -w /work golang:1.25-alpine sh -lc '
  /usr/local/go/bin/go doc github.com/x402-foundation/x402/go/mcp.NewPaymentWrapper
  /usr/local/go/bin/go doc github.com/x402-foundation/x402/go/mechanisms/evm/exact/server
  /usr/local/go/bin/go doc github.com/x402-foundation/x402/go/mechanisms/evm/upto/server
'
```

Expected:

- `mcp.NewPaymentWrapper` exists.
- EVM `exact` server package exists.
- EVM `upto` server package exists.

Then replace the Step 4 `PaymentMiddleware` 402 stub with the official x402 MCP wrapper path:

- `graph_query` uses exact payment with minimum `0.01 USDC`.
- `graph_query_batch` uses `upto` with maximum authorized amount derived from `len(queries) * per_query_timeout_seconds * 0.01 USDC`.
- Settlement charges actual `billable_seconds * 0.01 USDC`.
- If the SDK MCP wrapper cannot settle post-execution actual amount for `upto`, stop this plan at this task and record the exact missing SDK method in `README.md`; do not promote Go to production.

- [ ] **Step 6: Verify debug bypass still works**

Run:

```bash
npx @modelcontextprotocol/inspector \
  --cli http://127.0.0.1:8012/mcp \
  --transport http \
  --method tools/list \
  --header "X-MCP-Debug-Token: chain-insights-dev-debug"
```

Expected: `tools/list` succeeds with `X402_ENABLED=true` and matching `GRAPH_MCP_DEBUG_TOKEN`.

- [ ] **Step 7: Verify paid challenge without debug token**

Run:

```bash
npx @modelcontextprotocol/inspector \
  --cli http://127.0.0.1:8012/mcp \
  --transport http \
  --method tools/call \
  --tool-name graph_query \
  --tool-arg network=bittensor \
  --tool-arg 'query=MATCH (n) RETURN count(n) AS count LIMIT 1'
```

Expected: HTTP 402 payment challenge when no x402-paying fetch is used.

- [ ] **Step 8: Commit**

Run only after Steps 5-7 pass:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
git add internal/graphmcp/x402.go internal/graphmcp/x402_test.go internal/graphmcp/server.go go.mod go.sum README.md
git commit -m "feat: enforce x402 for Go graph MCP"
```

## Task 8: Add Docker and Compose UAT Service

**Status:** Completed in GraphRAG commits `ff4ca5f`, `74bdc22` and RBMK commits `6bedd715`, `68ec625f`; compose build and Inspector UAT passed.

**Files:**
- Create: `/home/aphex5/work/rbmk/repos/ml/graphrag/ops/Dockerfile.mcp-go`
- Modify: `/home/aphex5/work/rbmk/repos/ml/compose/shared.yml`
- Modify: `/home/aphex5/work/rbmk/repos/ml/graphrag/README.md`

- [ ] **Step 1: Add Dockerfile**

Create `/home/aphex5/work/rbmk/repos/ml/graphrag/ops/Dockerfile.mcp-go`:

```dockerfile
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -o /out/graphrag-mcp-go ./cmd/graphrag-mcp-go

FROM alpine:3.22
RUN adduser -D -u 10001 app
USER app
COPY --from=build /out/graphrag-mcp-go /usr/local/bin/graphrag-mcp-go
EXPOSE 8012
ENTRYPOINT ["/usr/local/bin/graphrag-mcp-go"]
```

- [ ] **Step 2: Build image**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
docker build -f ops/Dockerfile.mcp-go -t graphrag-mcp-go:local .
```

Expected: image builds successfully.

- [ ] **Step 3: Add side-by-side compose service**

Modify `/home/aphex5/work/rbmk/repos/ml/compose/shared.yml` to add a new service named `graphrag-mcp-go` on port `8012`. It must point at the same Memgraph service as the current GraphRAG MCP and include:

```yaml
  graphrag-mcp-go:
    build:
      context: ../graphrag
      dockerfile: ops/Dockerfile.mcp-go
    environment:
      PORT: "8012"
      MEMGRAPH_URI_BITTENSOR: bolt://memgraph-bittensor:7687
      GRAPH_MCP_DEBUG_TOKEN: ${GRAPH_MCP_DEBUG_TOKEN:-chain-insights-dev-debug}
      X402_ENABLED: ${X402_ENABLED:-false}
      X402_NETWORK: ${X402_NETWORK:-eip155:8453}
      X402_ASSET: ${X402_ASSET:-}
      X402_PAY_TO: ${X402_PAY_TO:-}
      X402_FACILITATOR_URL: ${X402_FACILITATOR_URL:-}
      GRAPH_MCP_PRICE_PER_SECOND_USDC: "0.01"
      GRAPH_MCP_PER_QUERY_TIMEOUT_SECONDS: "10"
      GRAPH_MCP_MAX_BATCH_QUERIES: "20"
    ports:
      - "8012:8012"
    depends_on:
      - memgraph-bittensor
```

- [ ] **Step 4: Run compose UAT**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml
set -a; . ../../.env; . ./.env; set +a
docker compose -f compose/shared.yml up -d memgraph-bittensor graphrag-mcp-go

npx @modelcontextprotocol/inspector \
  --cli http://localhost:8012/mcp \
  --transport http \
  --method tools/list \
  --header "X-MCP-Debug-Token: chain-insights-dev-debug"

npx @modelcontextprotocol/inspector \
  --cli http://localhost:8012/mcp \
  --transport http \
  --method tools/call \
  --tool-name graph_query_batch \
  --header "X-MCP-Debug-Token: chain-insights-dev-debug" \
  --tool-arg network=bittensor \
  --tool-arg 'queries=[{"id":"count","query":"MATCH (n) RETURN count(n) AS count LIMIT 1"},{"id":"sample","query":"MATCH (n) WHERE n.address IS NOT NULL RETURN labels(n) AS labels, n.address AS address LIMIT 3"}]'
```

Expected:

- `tools/list` returns `graph_query` and `graph_query_batch`.
- Batch call returns `facts.batch.billable_seconds`.
- Batch call returns both query result entries.
- No high-level AML tools are listed on the Go Graph MCP server.

- [ ] **Step 5: Commit**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml
git add graphrag/ops/Dockerfile.mcp-go compose/shared.yml graphrag/README.md
git commit -m "feat: add Go graph MCP compose service"
```

## Task 9: Add Chain Insights Graph MCP Batch Client

**Status:** Completed in Chain Insights commit `e445f7f`.

**Files:**
- Modify: `/home/aphex5/work/chain-insights/src/config/schema.ts`
- Create: `/home/aphex5/work/chain-insights/src/mcp/graph-client.ts`
- Create: `/home/aphex5/work/chain-insights/tests/mcp-graph-client.test.ts`

- [ ] **Step 1: Write failing Chain Insights client tests**

Create `/home/aphex5/work/chain-insights/tests/mcp-graph-client.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { callGraphQueryBatch } from '../src/mcp/graph-client.js'

describe('graph MCP batch client', () => {
  it('calls graph_query_batch with network and query list', async () => {
    const callTool = vi.fn().mockResolvedValue({
      structuredContent: {
        schema: 'chain-insights.result.v1',
        tool: 'graph_query_batch',
        hint: null,
        facts: { batch: { count: 1 }, queries: [] },
      },
    })
    const result = await callGraphQueryBatch({
      client: { callTool },
      network: 'bittensor',
      queries: [{ id: 'count', query: 'MATCH (n) RETURN count(n) AS count LIMIT 1' }],
    })

    expect(callTool).toHaveBeenCalledWith({
      name: 'graph_query_batch',
      arguments: {
        network: 'bittensor',
        queries: [{ id: 'count', query: 'MATCH (n) RETURN count(n) AS count LIMIT 1' }],
      },
    })
    expect(result.tool).toBe('graph_query_batch')
  })

  it('rejects missing network before calling MCP', async () => {
    const callTool = vi.fn()
    await expect(callGraphQueryBatch({
      client: { callTool },
      network: '',
      queries: [{ query: 'MATCH (n) RETURN n LIMIT 1' }],
    })).rejects.toThrow('network is required')
    expect(callTool).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd /home/aphex5/work/chain-insights
npm test -- tests/mcp-graph-client.test.ts
```

Expected: FAIL because `graph-client.ts` does not exist.

- [ ] **Step 3: Implement typed graph client**

Create `/home/aphex5/work/chain-insights/src/mcp/graph-client.ts`:

```ts
type ToolCaller = {
  callTool(input: { name: string; arguments: Record<string, unknown> }): Promise<unknown>
}

export type GraphBatchQuery = {
  id?: string
  query: string
}

export type ChainInsightsResult = {
  schema: 'chain-insights.result.v1'
  tool: string
  hint: string | null
  facts: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function extractStructuredContent(result: unknown): ChainInsightsResult {
  if (!isRecord(result) || !isRecord(result.structuredContent)) {
    throw new Error('Graph MCP result is missing structuredContent')
  }
  const content = result.structuredContent
  if (content.schema !== 'chain-insights.result.v1' || typeof content.tool !== 'string' || !isRecord(content.facts)) {
    throw new Error('Graph MCP result has invalid Chain Insights envelope')
  }
  return {
    schema: 'chain-insights.result.v1',
    tool: content.tool,
    hint: typeof content.hint === 'string' ? content.hint : null,
    facts: content.facts,
  }
}

export async function callGraphQueryBatch(input: {
  client: ToolCaller
  network: string
  queries: GraphBatchQuery[]
  perQueryTimeoutSeconds?: number
}): Promise<ChainInsightsResult> {
  const network = input.network.trim()
  if (!network) throw new Error('network is required')
  if (input.queries.length === 0) throw new Error('at least one query is required')

  const args: Record<string, unknown> = {
    network,
    queries: input.queries,
  }
  if (input.perQueryTimeoutSeconds !== undefined) {
    args.per_query_timeout_seconds = input.perQueryTimeoutSeconds
  }

  const result = await input.client.callTool({
    name: 'graph_query_batch',
    arguments: args,
  })
  return extractStructuredContent(result)
}
```

- [ ] **Step 4: Add config fields**

Modify `/home/aphex5/work/chain-insights/src/config/schema.ts` to include:

```ts
graphMcpEndpoint: z.string().default('http://localhost:8012/mcp'),
graphMcpAuthToken: z.string().optional(),
```

If the current config uses `mcpEndpoint` and `mcpAuthToken`, keep those names as backward-compatible aliases but prefer `graphMcpEndpoint` in new code.

- [ ] **Step 5: Run tests**

Run:

```bash
cd /home/aphex5/work/chain-insights
npm test -- tests/mcp-graph-client.test.ts tests/config.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
cd /home/aphex5/work/chain-insights
git add src/config/schema.ts src/mcp/graph-client.ts tests/mcp-graph-client.test.ts
git commit -m "feat: add graph MCP batch client"
```

## Task 10: Expose Batch Tool Through Chain Insights MCP

**Status:** Completed in Chain Insights commit `91bdbba`.

**Files:**
- Modify: `/home/aphex5/work/chain-insights/src/mcp/proxy.ts`
- Modify: `/home/aphex5/work/chain-insights/tests/mcp-proxy.test.ts`
- Modify: `/home/aphex5/work/chain-insights/tests/cli-mcp.test.ts`

- [ ] **Step 1: Write proxy schema regression tests**

Add tests asserting:

```ts
expect(toolNames).toContain('graph_query')
expect(toolNames).toContain('graph_query_batch')
expect(toolNames).toContain('balance')
expect(toolNames).not.toContain('topup')
```

Add a schema assertion:

```ts
expect(graphQueryBatch.inputSchema.required).toEqual(['network', 'queries'])
expect(graphQueryBatch.inputSchema.properties.per_query_timeout_seconds.maximum).toBe(10)
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd /home/aphex5/work/chain-insights
npm test -- tests/mcp-proxy.test.ts tests/cli-mcp.test.ts
```

Expected: FAIL until `graph_query_batch` is registered and `topup` is removed from advertised tools.

- [ ] **Step 3: Register local-facing batch schema**

Modify `/home/aphex5/work/chain-insights/src/mcp/proxy.ts`:

- Add `graph_query_batch` to `KNOWN_PUBLIC_TOOL_REQUIRED_ARGS` with `['network', 'queries']`.
- Add a description that says it executes multiple read-only Cypher queries through the paid graph primitive with a 10-second per-query timeout.
- Add a zod schema with `network`, `queries`, and optional `per_query_timeout_seconds`.
- Keep `topup` out of `LOCAL_TOOL_NAMES` unless the verified product decision changes.

Schema shape:

```ts
case 'graph_query_batch':
  return {
    network: z.string().min(1).describe(NETWORK_DESCRIPTION),
    queries: z.array(z.object({
      id: z.string().optional(),
      query: z.string().min(1).describe('Read-only Cypher query'),
    })).min(1).max(20),
    per_query_timeout_seconds: z.number().int().min(1).max(10).optional(),
  }
```

- [ ] **Step 4: Ensure remote forwarding preserves payment fetch**

Use the existing configured MCP fetch path. The Chain Insights MCP must call the configured graph endpoint with either:

- `graphMcpAuthToken` as `X-MCP-Debug-Token` and `Authorization: Bearer ...`, or
- local x402 wallet fetch when no debug token is configured.

- [ ] **Step 5: Run tests**

Run:

```bash
cd /home/aphex5/work/chain-insights
npm test -- tests/mcp-proxy.test.ts tests/cli-mcp.test.ts tests/mcp-client.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
cd /home/aphex5/work/chain-insights
git add src/mcp/proxy.ts tests/mcp-proxy.test.ts tests/cli-mcp.test.ts
git commit -m "feat: expose graph query batch through chain insights"
```

## Task 11: Keep Graph App Compatibility Without Making It the Core Workflow

**Status:** Completed in GraphRAG commit `66f8351` and Chain Insights commit `3770029`.

**Files:**
- Modify: `/home/aphex5/work/rbmk/repos/ml/graphrag/src/mcp_server/apps/graph.html`
- Modify: `/home/aphex5/work/rbmk/repos/ml/graphrag/tests/unit/test_html_apps.py`
- Modify: `/home/aphex5/work/chain-insights/src/viz/templates/graph.html`
- Modify: `/home/aphex5/work/chain-insights/tests/viz-html-generator.test.ts`

- [ ] **Step 1: Verify current GraphRAG `_meta` app contract**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
PYTHONPATH=src uv run --extra dev pytest tests/unit/test_html_apps.py -q
```

Expected: PASS. If it fails, fix only the app resource contract, not high-level tool registration.

- [ ] **Step 2: Add regression coverage for `_meta.chainInsights.graph.data` and URL loading**

In GraphRAG tests, assert the Python app can still read MCP app data from:

```json
{
  "_meta": {
    "chainInsights": {
      "graph": {
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

In Chain Insights tests, assert local graph HTML can read:

```json
{
  "_meta": {
    "chainInsights": {
      "graph": {
        "url": "http://127.0.0.1:35123/artifacts/abc/graph.json"
      }
    }
  }
}
```

- [ ] **Step 3: Run visualization tests**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
PYTHONPATH=src uv run --extra dev pytest tests/unit/test_html_apps.py -q

cd /home/aphex5/work/chain-insights
npm test -- tests/viz-html-generator.test.ts tests/mcp-artifacts.test.ts tests/mcp-artifact-server.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
git add src/mcp_server/apps/graph.html tests/unit/test_html_apps.py
git commit -m "test: preserve graph app meta compatibility"

cd /home/aphex5/work/chain-insights
git add src/viz/templates/graph.html tests/viz-html-generator.test.ts
git commit -m "test: preserve local graph artifact app loading"
```

## Task 12: Documentation and Operator UAT

**Status:** Completed; documentation commits follow this verification block.

**Verification:**
- GraphRAG: `docker run --rm -v "$PWD":/work -w /work golang:1.25-alpine sh -lc '/usr/local/go/bin/go test ./...'` passed.
- GraphRAG: `PYTHONPATH=src uv run --extra dev pytest tests/unit/test_html_apps.py tests/unit/test_mcp_tools.py -q` passed with 82 tests.
- Chain Insights: `npm run typecheck`, `npm run build`, and ordered `npm test` passed with 31 files / 265 tests.
- UAT: Go Graph MCP on `http://localhost:8012/mcp` listed only `graph_query` and `graph_query_batch` through MCP Inspector with `X-MCP-Debug-Token: chain-insights-dev-debug`.
- UAT: `node bin/cli.js mcp call graph_query_batch ...` returned `chain-insights.result.v1`, `billable_seconds: 1`, and real Bittensor Memgraph rows.

**Files:**
- Modify: `/home/aphex5/work/rbmk/repos/ml/graphrag/README.md`
- Modify: `/home/aphex5/work/rbmk/repos/ml/graphrag/CLAUDE.md`
- Modify: `/home/aphex5/work/rbmk/repos/ml/graphrag/AGENTS.md`
- Modify: `/home/aphex5/work/chain-insights/README.md`
- Modify: `/home/aphex5/work/chain-insights/docs/superpowers/specs/2026-05-14-chain-insights-mcp-framework-split-design.md`

- [ ] **Step 1: Update GraphRAG README**

Document:

- Go Graph MCP server purpose.
- `graph_query` and `graph_query_batch` only.
- Debug UAT command with `X-MCP-Debug-Token`.
- x402 pricing: `0.01 USDC` per started query-second, `10` seconds per query, one batch payment.
- Docker compose service and port `8012`.
- Python sync remains the source of Memgraph data.
- Python high-level tools are reference code only after migration.

- [ ] **Step 2: Update Chain Insights README**

Document:

- Local Chain Insights MCP connects clients to the paid Go Graph MCP.
- `balance` is the wallet status tool.
- `topup` is not a supported happy path.
- Configure debug local UAT:

```bash
chain-insights config set graphMcpEndpoint http://localhost:8012/mcp
chain-insights config set graphMcpAuthToken chain-insights-dev-debug
```

- Configure paid mode:

```bash
chain-insights config set graphMcpEndpoint https://<paid-graph-mcp-host>/mcp
chain-insights wallet balance
```

- Batch usage example:

```bash
chain-insights mcp call graph_query_batch \
  network=bittensor \
  'queries=[{"id":"count","query":"MATCH (n) RETURN count(n) AS count LIMIT 1"}]'
```

- Editor workflow remains case files, claims, evidence, dossiers, sessions, reports, and local graph artifacts.

- [ ] **Step 3: Run full local tests**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
docker run --rm -v "$PWD":/work -w /work golang:1.25-alpine sh -lc '/usr/local/go/bin/go test ./...'
PYTHONPATH=src uv run --extra dev pytest tests/unit/test_html_apps.py tests/unit/test_mcp_tools.py -q

cd /home/aphex5/work/chain-insights
npm test
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 4: Run end-to-end UAT**

Start services:

```bash
cd /home/aphex5/work/rbmk/repos/ml
set -a; . ../../.env; . ./.env; set +a
docker compose -f compose/shared.yml up -d memgraph-bittensor graphrag-mcp-go
```

Verify Go Graph MCP:

```bash
npx @modelcontextprotocol/inspector \
  --cli http://localhost:8012/mcp \
  --transport http \
  --method tools/list \
  --header "X-MCP-Debug-Token: chain-insights-dev-debug"
```

Verify Chain Insights proxy:

```bash
cd /home/aphex5/work/chain-insights
npm run build
chain-insights config set graphMcpEndpoint http://localhost:8012/mcp
chain-insights config set graphMcpAuthToken chain-insights-dev-debug
chain-insights mcp tools --refresh
chain-insights mcp call graph_query_batch \
  network=bittensor \
  'queries=[{"id":"count","query":"MATCH (n) RETURN count(n) AS count LIMIT 1"},{"id":"sample","query":"MATCH (n) WHERE n.address IS NOT NULL RETURN labels(n) AS labels, n.address AS address LIMIT 3"}]'
```

Expected:

- Chain Insights can call Go Graph MCP through debug token.
- Batch output includes `billable_seconds`.
- No `address_risk`, `track_funds`, `money_flows_between_exchanges`, or `address_connection_risk` are served by GraphRAG Go MCP.
- Chain Insights still owns high-level user-facing workflow and docs.

- [ ] **Step 5: Commit docs**

Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
git add README.md CLAUDE.md AGENTS.md
git commit -m "docs: document Go graph MCP boundary"

cd /home/aphex5/work/chain-insights
git add README.md docs/superpowers/specs/2026-05-14-chain-insights-mcp-framework-split-design.md
git commit -m "docs: document paid graph MCP workflow"
```

## Promotion Gate

Promote Go Graph MCP from side-by-side service to default paid graph primitive only when all gates pass:

- Go unit tests pass.
- Go MCP Inspector `tools/list` shows only `graph_query` and `graph_query_batch`.
- Go MCP Inspector `tools/call graph_query` works with debug bearer.
- Go MCP Inspector `tools/call graph_query_batch` works with debug bearer.
- x402 unauthenticated call returns payment challenge.
- x402 paid client completes one `graph_query` payment.
- x402 paid client completes one `graph_query_batch` payment.
- Batch settlement is one payment path for the batch, not one payment per query.
- Batch price is computed from actual total query elapsed seconds, minimum `0.01 USDC`.
- Chain Insights can call batch through local config.
- Chain Insights docs do not advertise `topup` as working.
- GraphRAG Python public high-level tools are disabled in the promoted public service.
- Graph app `_meta` compatibility tests pass.

## Rollout Order

1. Build Go service side-by-side on port `8012`.
2. Validate debug-token UAT through MCP Inspector.
3. Validate Chain Insights local proxy against port `8012`.
4. Validate x402 exact single-query payment.
5. Validate x402 `upto` batch payment and actual settlement.
6. Switch Chain Insights default graph endpoint to the Go service.
7. Disable Python public MCP registration for high-level AML tools in the production GraphRAG service.
8. Start a separate Superpowers plan for porting `address_risk` into Chain Insights over `graph_query_batch`.

## Self-Review

- Spec coverage: The plan covers the trusted Go graph primitive, one-payment batch calls, per-query 10-second timeout, `0.01 USDC` per started query-second, Chain Insights local adapter, docs, UAT, and graph app compatibility.
- Boundary check: Billing lives only in the server-side Go Graph MCP. Local Chain Insights remains user-side and untrusted for payment enforcement.
- Placeholder scan: The only intentional hard gate is x402 `upto` post-execution settlement. If the Go SDK cannot do it, promotion stops; that is a product gate, not a deferred implementation.
- Type consistency: `graph_query_batch`, `per_query_timeout_seconds`, `billable_seconds`, `estimated_usdc`, and `chain-insights.result.v1` are used consistently across Go and TypeScript tasks.
