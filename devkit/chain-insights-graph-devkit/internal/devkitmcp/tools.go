package devkitmcp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Tier timeout ceilings mirror the production Chain Insights Graph backend
// contract (live Memgraph tier vs StarRocks-backed archive/facts tier). The
// devkit is config-light by design; these are documented devkit constants,
// not tunables. Keep them in sync with the production defaults.
const (
	liveTierTimeoutSeconds      = 10
	starrocksTierTimeoutSeconds = 30

	liveTierName      = "live"
	starrocksTierName = "starrocks"
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
	Batch   ChainInsightsBatchInfo    `json:"batch"`
	Queries []ChainInsightsBatchQuery `json:"queries"`
}

type ChainInsightsBatchInfo struct {
	LiveTierTimeoutSeconds      int `json:"live_tier_timeout_seconds"`
	StarRocksTierTimeoutSeconds int `json:"starrocks_tier_timeout_seconds"`
}

type ChainInsightsBatchQuery struct {
	ID             string           `json:"id,omitempty"`
	OK             bool             `json:"ok"`
	Tier           string           `json:"tier"`
	TimeoutSeconds int              `json:"timeout_seconds"`
	Results        []map[string]any `json:"results"`
	Error          string           `json:"error,omitempty"`
}

type UsageStatusResult struct {
	Schema string           `json:"schema"`
	Tool   string           `json:"tool"`
	Facts  UsageStatusFacts `json:"facts"`
	Hint   *string          `json:"hint"`
}

type UsageStatusFacts struct {
	Usage map[string]any `json:"usage"`
}

func ToolNames() []string {
	return []string{"network_capabilities", "usage_status", "graph_query", "graph_query_batch"}
}

// ClassifyQueryTier resolves a query's execution tier and timeout ceiling
// from its leading USE clause, mirroring production tier selection:
// `USE archive_topology` and `USE facts` run on the StarRocks tier; anything
// else (including `USE live_topology` and no USE clause) is the live tier.
func ClassifyQueryTier(query string) (string, int) {
	fields := strings.Fields(strings.ToLower(query))
	if len(fields) >= 2 && fields[0] == "use" {
		switch fields[1] {
		case "archive_topology", "facts":
			return starrocksTierName, starrocksTierTimeoutSeconds
		}
	}
	return liveTierName, liveTierTimeoutSeconds
}

// UsageStatusDocument reports the devkit's fixed unmetered usage contract:
// no billing, no metering, no usage limits. The shape matches the production
// chain-insights.result.v1 envelope so clients exercise the same parse path.
func UsageStatusDocument() UsageStatusResult {
	return UsageStatusResult{
		Schema: "chain-insights.result.v1",
		Tool:   "usage_status",
		Facts: UsageStatusFacts{
			Usage: map[string]any{
				"mode":     "devkit_unmetered",
				"billing":  "disabled",
				"metering": "disabled",
				"limits":   "none",
			},
		},
		Hint: nil,
	}
}

func RegisterTools(server *mcp.Server, runner QueryRunner) {
	mcp.AddTool(server, &mcp.Tool{Name: "network_capabilities", Description: "Return devkit Bittensor graph metadata."}, handleNetworkCapabilities)
	mcp.AddTool(server, &mcp.Tool{Name: "usage_status", Description: "Return the devkit's unmetered usage status."}, handleUsageStatus)
	mcp.AddTool(server, &mcp.Tool{Name: "graph_query", Description: "Run one read-only graph query against the devkit graph endpoint."}, graphQueryHandler(runner))
	mcp.AddTool(server, &mcp.Tool{Name: "graph_query_batch", Description: "Run read-only graph queries against the devkit graph endpoint."}, graphQueryBatchHandler(runner))
}

func handleNetworkCapabilities(ctx context.Context, req *mcp.CallToolRequest, args struct{}) (*mcp.CallToolResult, any, error) {
	return jsonResult(NetworkDocument())
}

func handleUsageStatus(ctx context.Context, req *mcp.CallToolRequest, args struct{}) (*mcp.CallToolResult, any, error) {
	return jsonResult(UsageStatusDocument())
}

func graphQueryHandler(runner QueryRunner) func(context.Context, *mcp.CallToolRequest, GraphQueryArgs) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, args GraphQueryArgs) (*mcp.CallToolResult, any, error) {
		if err := ValidateReadOnlyQuery(args.Query); err != nil {
			return toolError(err.Error()), nil, nil
		}
		_, timeoutSeconds := ClassifyQueryTier(args.Query)
		queryContext, cancel := context.WithTimeout(ctx, time.Duration(timeoutSeconds)*time.Second)
		defer cancel()
		result, err := runner.Run(queryContext, args.Network, args.Query)
		if err != nil {
			return toolError(err.Error()), nil, nil
		}
		return jsonResult(result)
	}
}

func graphQueryBatchHandler(runner QueryRunner) func(context.Context, *mcp.CallToolRequest, GraphQueryBatchArgs) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, args GraphQueryBatchArgs) (*mcp.CallToolResult, any, error) {
		if args.PerQueryTimeoutSeconds > starrocksTierTimeoutSeconds {
			return toolError(fmt.Sprintf(
				"per_query_timeout_seconds must not exceed %d (live tier ceiling %d, starrocks tier ceiling %d)",
				starrocksTierTimeoutSeconds, liveTierTimeoutSeconds, starrocksTierTimeoutSeconds,
			)), nil, nil
		}
		queries := make([]ChainInsightsBatchQuery, 0, len(args.Queries))
		for index, query := range args.Queries {
			id := query.ID
			if id == "" {
				id = fmt.Sprintf("%d", index)
			}
			tier, timeoutSeconds := ClassifyQueryTier(query.Query)
			if args.PerQueryTimeoutSeconds > 0 && args.PerQueryTimeoutSeconds < timeoutSeconds {
				timeoutSeconds = args.PerQueryTimeoutSeconds
			}
			if err := ValidateReadOnlyQuery(query.Query); err != nil {
				queries = append(queries, ChainInsightsBatchQuery{ID: id, OK: false, Tier: tier, TimeoutSeconds: timeoutSeconds, Results: []map[string]any{}, Error: err.Error()})
				continue
			}
			queryContext, cancel := context.WithTimeout(ctx, time.Duration(timeoutSeconds)*time.Second)
			result, err := runner.Run(queryContext, args.Network, query.Query)
			cancel()
			if err != nil {
				queries = append(queries, ChainInsightsBatchQuery{ID: id, OK: false, Tier: tier, TimeoutSeconds: timeoutSeconds, Results: []map[string]any{}, Error: err.Error()})
				continue
			}
			queries = append(queries, ChainInsightsBatchQuery{ID: id, OK: true, Tier: tier, TimeoutSeconds: timeoutSeconds, Results: result.Rows})
		}
		return jsonResult(ChainInsightsBatchResult{
			Schema: "chain-insights.result.v1",
			Tool:   "graph_query_batch",
			Facts: ChainInsightsBatchFacts{
				Batch: ChainInsightsBatchInfo{
					LiveTierTimeoutSeconds:      liveTierTimeoutSeconds,
					StarRocksTierTimeoutSeconds: starrocksTierTimeoutSeconds,
				},
				Queries: queries,
			},
			Hint: nil,
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
