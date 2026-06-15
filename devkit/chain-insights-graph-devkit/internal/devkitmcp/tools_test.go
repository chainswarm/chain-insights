package devkitmcp

import (
	"context"
	"reflect"
	"testing"
)

type fakeRunner struct{}

func (fakeRunner) Run(_ context.Context, _ string, query string) (QueryResult, error) {
	return QueryResult{Rows: []map[string]any{{"query": query}}}, nil
}

func TestToolNames(t *testing.T) {
	t.Parallel()

	got := ToolNames()
	want := []string{"network_capabilities", "graph_query", "graph_query_batch"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("tool names mismatch: got %v want %v", got, want)
	}
}

func TestNetworkDocument(t *testing.T) {
	t.Parallel()

	doc := NetworkDocument()
	if len(doc.Networks) != 1 {
		t.Fatalf("network count = %d, want 1", len(doc.Networks))
	}
	network := doc.Networks[0]
	if network.Network != "bittensor" {
		t.Fatalf("network = %q, want bittensor", network.Network)
	}
	if network.FixtureWindow != "genesis..2025-12-31" {
		t.Fatalf("fixture window = %q", network.FixtureWindow)
	}
	if !network.Layers["topology"].Enabled {
		t.Fatal("topology layer is not enabled")
	}
	if !network.Layers["facts"].Enabled {
		t.Fatal("facts layer is not enabled")
	}
	if network.Layers["risk"].Enabled {
		t.Fatal("risk layer is enabled")
	}
	for _, tool := range ToolNames() {
		if network.Tools[tool] != "available" {
			t.Fatalf("tool %s not available in network document", tool)
		}
	}
}

func TestGraphQueryBatchUsesChainInsightsEnvelope(t *testing.T) {
	t.Parallel()

	handler := graphQueryBatchHandler(fakeRunner{})
	_, structured, err := handler(context.Background(), nil, GraphQueryBatchArgs{
		Network: "bittensor",
		Queries: []BatchQuery{{
			ID:    "facts_subject",
			Query: "USE facts MATCH (f:AddressFeature) RETURN count(f) AS features;",
		}},
	})
	if err != nil {
		t.Fatalf("handler returned error: %v", err)
	}
	result, ok := structured.(ChainInsightsBatchResult)
	if !ok {
		t.Fatalf("structured result type = %T, want ChainInsightsBatchResult", structured)
	}
	if result.Schema != "chain-insights.result.v1" {
		t.Fatalf("schema = %q", result.Schema)
	}
	if result.Tool != "graph_query_batch" {
		t.Fatalf("tool = %q", result.Tool)
	}
	if result.Hint != nil {
		t.Fatalf("hint = %v, want nil", result.Hint)
	}
	if len(result.Facts.Queries) != 1 {
		t.Fatalf("query result count = %d, want 1", len(result.Facts.Queries))
	}
	query := result.Facts.Queries[0]
	if query.ID != "facts_subject" {
		t.Fatalf("query id = %q", query.ID)
	}
	if !query.OK {
		t.Fatalf("query result was not ok: %s", query.Error)
	}
	if len(query.Results) != 1 || query.Results[0]["query"] == "" {
		t.Fatalf("unexpected query results: %#v", query.Results)
	}
}
