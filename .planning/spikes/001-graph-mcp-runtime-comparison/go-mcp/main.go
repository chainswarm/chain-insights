package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
	"github.com/neo4j/neo4j-go-driver/v5/neo4j/dbtype"
)

const chainInsightsResultSchema = "chain-insights.result.v1"

var (
	writeKeywordPattern = regexp.MustCompile(`(?i)\b(MERGE|DELETE|CREATE|SET|REMOVE|DROP|DETACH)\b`)
	limitPattern        = regexp.MustCompile(`(?i)\bLIMIT\b`)
)

type graphQueryArgs struct {
	Query   string `json:"query"`
	Network string `json:"network"`
}

type graphQueryPayload struct {
	Results []map[string]any `json:"results"`
	Count   int              `json:"count"`
}

type chainInsightsResult struct {
	Schema string         `json:"schema"`
	Tool   string         `json:"tool"`
	Hint   *string        `json:"hint"`
	Facts  map[string]any `json:"facts"`
}

type memgraphPool struct {
	mu      sync.Mutex
	drivers map[string]neo4j.DriverWithContext
}

func newMemgraphPool() *memgraphPool {
	return &memgraphPool{drivers: map[string]neo4j.DriverWithContext{}}
}

func (p *memgraphPool) driverFor(network string) (neo4j.DriverWithContext, error) {
	uri, err := memgraphURI(network)
	if err != nil {
		return nil, err
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	if driver, ok := p.drivers[uri]; ok {
		return driver, nil
	}

	var auth neo4j.AuthToken
	user := os.Getenv("MEMGRAPH_USER")
	if user != "" {
		auth = neo4j.BasicAuth(user, os.Getenv("MEMGRAPH_PASSWORD"), "")
	} else {
		auth = neo4j.NoAuth()
	}

	driver, err := neo4j.NewDriverWithContext(uri, auth, func(config *neo4j.Config) {
		config.MaxConnectionPoolSize = envInt("MEMGRAPH_POOL_SIZE", 32)
		config.ConnectionAcquisitionTimeout = 5 * time.Second
		config.SocketConnectTimeout = 5 * time.Second
	})
	if err != nil {
		return nil, err
	}

	p.drivers[uri] = driver
	return driver, nil
}

func (p *memgraphPool) close(ctx context.Context) {
	p.mu.Lock()
	defer p.mu.Unlock()

	for _, driver := range p.drivers {
		_ = driver.Close(ctx)
	}
	p.drivers = map[string]neo4j.DriverWithContext{}
}

func main() {
	pool := newMemgraphPool()
	defer pool.close(context.Background())

	server := mcp.NewServer(
		&mcp.Implementation{Name: "chain-insights-graph-query-go-spike", Version: "0.0.0"},
		&mcp.ServerOptions{
			Instructions: "Spike MCP server for direct Memgraph graph_query over Go. Only graph_query is exposed.",
		},
	)

	readOnly := false
	openWorld := true
	server.AddTool(&mcp.Tool{
		Name:        "graph_query",
		Title:       "Cypher Graph Query",
		Description: "Execute a read-only Cypher query against Memgraph. Write operations (MERGE, DELETE, CREATE, SET, REMOVE, DROP, DETACH) are blocked. Queries without LIMIT get LIMIT 1000 auto-appended.",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"query": {"type": "string", "description": "Cypher read query to execute"},
				"network": {"type": "string", "description": "Network to query. This spike supports bittensor by default."}
			},
			"required": ["query", "network"],
			"additionalProperties": false
		}`),
		OutputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"schema": {"type": "string"},
				"tool": {"type": "string"},
				"hint": {"type": ["string", "null"]},
				"facts": {"type": "object", "additionalProperties": true}
			},
			"required": ["schema", "tool", "facts"],
			"additionalProperties": false
		}`),
		Annotations: &mcp.ToolAnnotations{
			ReadOnlyHint:    true,
			DestructiveHint: &readOnly,
			IdempotentHint:  false,
			OpenWorldHint:   &openWorld,
		},
	}, func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		var args graphQueryArgs
		if err := json.Unmarshal(req.Params.Arguments, &args); err != nil {
			return toolError(fmt.Sprintf("Invalid graph_query arguments: %s", err)), nil
		}

		query, err := validateCypher(args.Query)
		if err != nil {
			return toolError(err.Error()), nil
		}
		if strings.TrimSpace(args.Network) == "" {
			return toolError("Network cannot be empty"), nil
		}

		driver, err := pool.driverFor(args.Network)
		if err != nil {
			return toolError(err.Error()), nil
		}

		rows, err := runReadQuery(ctx, driver, query)
		if err != nil {
			return toolError("An unexpected error occurred executing the query"), nil
		}

		payload := graphQueryPayload{Results: rows, Count: len(rows)}
		summary, _ := json.Marshal(payload)
		structured := chainInsightsResult{
			Schema: chainInsightsResultSchema,
			Tool:   "graph_query",
			Hint:   nil,
			Facts: map[string]any{
				"subject": map[string]any{"network": args.Network},
				"query":   payload,
			},
		}

		return &mcp.CallToolResult{
			Content:           []mcp.Content{&mcp.TextContent{Text: string(summary)}},
			StructuredContent: structured,
		}, nil
	})

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","service":"graph-query-go-spike"}`))
	})
	mux.Handle("/mcp", mcp.NewStreamableHTTPHandler(
		func(*http.Request) *mcp.Server { return server },
		&mcp.StreamableHTTPOptions{
			Stateless:    true,
			JSONResponse: true,
		},
	))

	addr := "127.0.0.1:" + strconv.Itoa(envInt("PORT", 8921))
	log.Printf("graph-query Go MCP spike listening on http://%s/mcp", addr)
	if err := http.ListenAndServe(addr, mux); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func runReadQuery(ctx context.Context, driver neo4j.DriverWithContext, query string) ([]map[string]any, error) {
	ctx, cancel := context.WithTimeout(ctx, time.Duration(envInt("MCP_TOOL_TIMEOUT_MS", 600000))*time.Millisecond)
	defer cancel()

	session := driver.NewSession(ctx, neo4j.SessionConfig{
		AccessMode: neo4j.AccessModeRead,
	})
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

func validateCypher(query string) (string, error) {
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
	return strings.TrimRight(strings.TrimSpace(strings.TrimRight(trimmed, ";")), ";") + " LIMIT 1000", nil
}

func memgraphURI(network string) (string, error) {
	switch strings.TrimSpace(network) {
	case "bittensor", "bittensor_evm":
		if uri := os.Getenv("MEMGRAPH_URI_BITTENSOR"); uri != "" {
			return uri, nil
		}
		if uri := os.Getenv("MEMGRAPH_URI"); uri != "" {
			return uri, nil
		}
		return "bolt://127.0.0.1:7687", nil
	case "base":
		if uri := os.Getenv("MEMGRAPH_URI_BASE"); uri != "" {
			return uri, nil
		}
	case "ethereum":
		if uri := os.Getenv("MEMGRAPH_URI_ETHEREUM"); uri != "" {
			return uri, nil
		}
	}
	return "", fmt.Errorf("Unsupported or unconfigured network: %s", network)
}

func serializeValue(value any) any {
	switch typed := value.(type) {
	case nil, string, bool, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, float32, float64:
		return typed
	case []any:
		out := make([]any, len(typed))
		for i, item := range typed {
			out[i] = serializeValue(item)
		}
		return out
	case []string:
		out := make([]any, len(typed))
		for i, item := range typed {
			out[i] = item
		}
		return out
	case map[string]any:
		return serializeMap(typed)
	case dbtype.Node:
		out := map[string]any{"id": typed.ElementId}
		for key, prop := range typed.Props {
			out[key] = serializeValue(prop)
		}
		return out
	case dbtype.Relationship:
		out := serializeMap(typed.Props)
		if _, ok := out["id"]; !ok {
			out["id"] = typed.ElementId
		}
		out["type"] = typed.Type
		out["from"] = typed.StartElementId
		out["to"] = typed.EndElementId
		return out
	case dbtype.Path:
		nodes := make([]any, 0, len(typed.Nodes))
		for _, node := range typed.Nodes {
			nodes = append(nodes, serializeValue(node))
		}
		edges := make([]any, 0, len(typed.Relationships))
		for _, rel := range typed.Relationships {
			edges = append(edges, serializeValue(rel))
		}
		return map[string]any{"nodes": nodes, "edges": edges}
	default:
		return fmt.Sprint(value)
	}
}

func serializeMap(input map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range input {
		out[key] = serializeValue(value)
	}
	return out
}

func toolError(message string) *mcp.CallToolResult {
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: message}},
		IsError: true,
	}
}

func envInt(name string, fallback int) int {
	if raw := os.Getenv(name); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			return parsed
		}
	}
	return fallback
}
