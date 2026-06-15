package devkitmcp

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type GraphQueryArgs struct {
	Network string `json:"network"`
	Query   string `json:"query"`
}

type GraphQueryBatchArgs struct {
	Network                string       `json:"network"`
	Queries                []BatchQuery `json:"queries"`
	PerQueryTimeoutSeconds int          `json:"per_query_timeout_seconds,omitempty"`
}

type BatchQuery struct {
	ID    string `json:"id,omitempty"`
	Query string `json:"query"`
}

type BatchQueryResult struct {
	ID     string      `json:"id,omitempty"`
	Result QueryResult `json:"result,omitempty"`
	Error  string      `json:"error,omitempty"`
}

type ChainInsightsBatchResult struct {
	Schema string                  `json:"schema"`
	Tool   string                  `json:"tool"`
	Facts  ChainInsightsBatchFacts `json:"facts"`
	Hint   *string                 `json:"hint"`
}

type ChainInsightsBatchFacts struct {
	Queries []ChainInsightsBatchQuery `json:"queries"`
}

type ChainInsightsBatchQuery struct {
	ID      string           `json:"id,omitempty"`
	OK      bool             `json:"ok"`
	Results []map[string]any `json:"results"`
	Error   string           `json:"error,omitempty"`
}

func ToolNames() []string {
	return []string{"network_capabilities", "graph_query", "graph_query_batch"}
}

func RegisterTools(server *mcp.Server, runner QueryRunner) {
	mcp.AddTool(server, &mcp.Tool{Name: "network_capabilities", Description: "Return devkit Bittensor graph metadata."}, handleNetworkCapabilities)
	mcp.AddTool(server, &mcp.Tool{Name: "graph_query", Description: "Run one read-only graph query against the devkit graph endpoint."}, graphQueryHandler(runner))
	mcp.AddTool(server, &mcp.Tool{Name: "graph_query_batch", Description: "Run read-only graph queries against the devkit graph endpoint."}, graphQueryBatchHandler(runner))
}

func handleNetworkCapabilities(ctx context.Context, req *mcp.CallToolRequest, args struct{}) (*mcp.CallToolResult, any, error) {
	return jsonResult(NetworkDocument())
}

func graphQueryHandler(runner QueryRunner) func(context.Context, *mcp.CallToolRequest, GraphQueryArgs) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, args GraphQueryArgs) (*mcp.CallToolResult, any, error) {
		if err := ValidateReadOnlyQuery(args.Query); err != nil {
			return toolError(err.Error()), nil, nil
		}
		result, err := runner.Run(ctx, args.Network, args.Query)
		if err != nil {
			return toolError(err.Error()), nil, nil
		}
		return jsonResult(result)
	}
}

func graphQueryBatchHandler(runner QueryRunner) func(context.Context, *mcp.CallToolRequest, GraphQueryBatchArgs) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, args GraphQueryBatchArgs) (*mcp.CallToolResult, any, error) {
		timeout := args.PerQueryTimeoutSeconds
		if timeout <= 0 {
			timeout = 15
		}
		if timeout > 60 {
			return toolError("per_query_timeout_seconds must be 60 or less"), nil, nil
		}
		queries := make([]ChainInsightsBatchQuery, 0, len(args.Queries))
		for index, query := range args.Queries {
			id := query.ID
			if id == "" {
				id = fmt.Sprintf("%d", index)
			}
			if err := ValidateReadOnlyQuery(query.Query); err != nil {
				queries = append(queries, ChainInsightsBatchQuery{ID: id, OK: false, Results: []map[string]any{}, Error: err.Error()})
				continue
			}
			queryContext, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Second)
			result, err := runner.Run(queryContext, args.Network, query.Query)
			cancel()
			if err != nil {
				queries = append(queries, ChainInsightsBatchQuery{ID: id, OK: false, Results: []map[string]any{}, Error: err.Error()})
				continue
			}
			queries = append(queries, ChainInsightsBatchQuery{ID: id, OK: true, Results: result.Rows})
		}
		return jsonResult(ChainInsightsBatchResult{
			Schema: "chain-insights.result.v1",
			Tool:   "graph_query_batch",
			Facts:  ChainInsightsBatchFacts{Queries: queries},
			Hint:   nil,
		})
	}
}

func jsonResult(value any) (*mcp.CallToolResult, any, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, nil, err
	}
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(encoded)}}}, value, nil
}

func toolError(message string) *mcp.CallToolResult {
	return &mcp.CallToolResult{
		IsError: true,
		Content: []mcp.Content{&mcp.TextContent{
			Text: message,
		}},
	}
}
