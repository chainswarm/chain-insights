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
	want := []string{"network_capabilities", "usage_status", "graph_query", "graph_query_batch"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("tool names mismatch: got %v want %v", got, want)
	}
}

func TestClassifyQueryTier(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		query       string
		wantTier    string
		wantTimeout int
	}{
		{name: "no use clause is topology", query: "MATCH (a:Address) RETURN a LIMIT 1", wantTier: "live", wantTimeout: liveTierTimeoutSeconds},
		{name: "topology is topology tier", query: "USE topology MATCH (a) RETURN a", wantTier: "live", wantTimeout: liveTierTimeoutSeconds},
		{name: "unknown scope defaults to topology", query: "USE mystery MATCH (a) RETURN a", wantTier: "live", wantTimeout: liveTierTimeoutSeconds},
		{name: "facts is starrocks", query: "USE facts MATCH (f) RETURN f", wantTier: "starrocks", wantTimeout: starrocksTierTimeoutSeconds},
		{name: "case insensitive", query: "use FACTS MATCH (f) RETURN f", wantTier: "starrocks", wantTimeout: starrocksTierTimeoutSeconds},
		{name: "leading whitespace", query: "   USE facts MATCH (f) RETURN f", wantTier: "starrocks", wantTimeout: starrocksTierTimeoutSeconds},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			tier, timeout := ClassifyQueryTier(test.query)
			if tier != test.wantTier || timeout != test.wantTimeout {
				t.Fatalf("ClassifyQueryTier(%q) = (%q, %d), want (%q, %d)", test.query, tier, timeout, test.wantTier, test.wantTimeout)
			}
		})
	}
}

func TestBatchAppliesPerTierTimeoutsAndReportsThem(t *testing.T) {
	t.Parallel()

	handler := graphQueryBatchHandler(fakeRunner{})
	_, structured, err := handler(context.Background(), nil, GraphQueryBatchArgs{
		Network: "bittensor",
		Queries: []BatchQuery{
			{ID: "topology", Query: "USE topology MATCH (a) RETURN a"},
			{ID: "facts", Query: "USE facts MATCH (f) RETURN f"},
		},
	})
	if err != nil {
		t.Fatalf("handler returned error: %v", err)
	}
	result := structured.(ChainInsightsBatchResult)
	if result.Facts.Batch.LiveTierTimeoutSeconds != liveTierTimeoutSeconds {
		t.Fatalf("live tier timeout = %d", result.Facts.Batch.LiveTierTimeoutSeconds)
	}
	if result.Facts.Batch.StarRocksTierTimeoutSeconds != starrocksTierTimeoutSeconds {
		t.Fatalf("starrocks tier timeout = %d", result.Facts.Batch.StarRocksTierTimeoutSeconds)
	}
	byID := map[string]ChainInsightsBatchQuery{}
	for _, query := range result.Facts.Queries {
		byID[query.ID] = query
	}
	if byID["topology"].Tier != "live" || byID["topology"].TimeoutSeconds != liveTierTimeoutSeconds {
		t.Fatalf("topology query tier facts = %+v", byID["topology"])
	}
	if byID["facts"].Tier != "starrocks" || byID["facts"].TimeoutSeconds != starrocksTierTimeoutSeconds {
		t.Fatalf("facts query tier facts = %+v", byID["facts"])
	}
}

func TestBatchCallerTimeoutOverrideOnlyLowers(t *testing.T) {
	t.Parallel()

	handler := graphQueryBatchHandler(fakeRunner{})

	_, structured, err := handler(context.Background(), nil, GraphQueryBatchArgs{
		Network:                "bittensor",
		PerQueryTimeoutSeconds: 5,
		Queries:                []BatchQuery{{ID: "facts", Query: "USE facts MATCH (f) RETURN f"}},
	})
	if err != nil {
		t.Fatalf("handler returned error: %v", err)
	}
	result := structured.(ChainInsightsBatchResult)
	if result.Facts.Queries[0].TimeoutSeconds != 5 {
		t.Fatalf("override did not lower timeout: %+v", result.Facts.Queries[0])
	}

	callResult, _, err := handler(context.Background(), nil, GraphQueryBatchArgs{
		Network:                "bittensor",
		PerQueryTimeoutSeconds: starrocksTierTimeoutSeconds + 1,
		Queries:                []BatchQuery{{ID: "live", Query: "MATCH (i) RETURN i"}},
	})
	if err != nil {
		t.Fatalf("handler returned error: %v", err)
	}
	if callResult == nil || !callResult.IsError {
		t.Fatal("expected over-ceiling per_query_timeout_seconds to be rejected")
	}
}

func TestUsageStatusReportsUnmeteredDevkit(t *testing.T) {
	t.Parallel()

	doc := UsageStatusDocument()
	if doc.Schema != "chain-insights.result.v1" {
		t.Fatalf("schema = %q", doc.Schema)
	}
	if doc.Tool != "usage_status" {
		t.Fatalf("tool = %q", doc.Tool)
	}
	if doc.Facts.Usage["mode"] != "devkit_unmetered" {
		t.Fatalf("usage mode = %v", doc.Facts.Usage["mode"])
	}
	if doc.Facts.Usage["billing"] != "disabled" {
		t.Fatalf("billing = %v", doc.Facts.Usage["billing"])
	}
}

func TestNetworkDocumentAdvertisesTopologyTierSublayers(t *testing.T) {
	t.Parallel()

	topology := NetworkDocument().Networks[0].Layers["topology"]
	if topology.Live == nil || !topology.Live.Enabled || topology.Live.TimeoutSeconds != liveTierTimeoutSeconds {
		t.Fatalf("live sublayer = %+v", topology.Live)
	}
	if topology.Archive == nil || !topology.Archive.Enabled || topology.Archive.TimeoutSeconds != starrocksTierTimeoutSeconds {
		t.Fatalf("archive sublayer = %+v", topology.Archive)
	}
	facts := NetworkDocument().Networks[0].Layers["facts"]
	if facts.Live != nil || facts.Archive != nil {
		t.Fatal("facts layer must stay flat")
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
	if network.FixtureWindow != "2024-01-01..2026-07-02" {
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
			ID: "facts_subject",
			// Bounded projection: admitted by the StarRocks cost-shape gate
			// (explicit LIMIT, no predicate-less global aggregate).
			Query: "USE facts MATCH (f:AddressFeature) RETURN f.feature_scope AS feature_scope LIMIT 1;",
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

func TestBatchRejectsMoreThanMaxQueries(t *testing.T) {
	t.Parallel()

	handler := graphQueryBatchHandler(fakeRunner{})
	queries := make([]BatchQuery, maxBatchQueries+1)
	for index := range queries {
		queries[index] = BatchQuery{Query: "MATCH (i) RETURN i"}
	}
	callResult, _, err := handler(context.Background(), nil, GraphQueryBatchArgs{Network: "bittensor", Queries: queries})
	if err != nil {
		t.Fatalf("handler returned error: %v", err)
	}
	if callResult == nil || !callResult.IsError {
		t.Fatalf("expected batch larger than %d to be rejected", maxBatchQueries)
	}
}

func TestGraphQueryReturnsChainInsightsEnvelopeWithRouting(t *testing.T) {
	t.Parallel()

	handler := graphQueryHandler(fakeRunner{})
	_, structured, err := handler(context.Background(), nil, GraphQueryArgs{
		Network: "bittensor",
		Query:   "USE facts MATCH (f:AddressFeature) RETURN f.feature_scope AS feature_scope LIMIT 1",
	})
	if err != nil {
		t.Fatalf("handler returned error: %v", err)
	}
	result, ok := structured.(ChainInsightsQueryResult)
	if !ok {
		t.Fatalf("structured result type = %T, want ChainInsightsQueryResult", structured)
	}
	if result.Schema != "chain-insights.result.v1" || result.Tool != "graph_query" {
		t.Fatalf("envelope = %q/%q", result.Schema, result.Tool)
	}
	if result.Facts.Query.Tier != "starrocks" || result.Facts.Query.TimeoutSeconds != starrocksTierTimeoutSeconds {
		t.Fatalf("query facts = %+v", result.Facts.Query)
	}
	if result.Facts.Routing.TopologyKey != "facts" {
		t.Fatalf("topology key = %q", result.Facts.Routing.TopologyKey)
	}
	if result.Facts.Routing.StarRocksDatabase != "bittensor" {
		t.Fatalf("starrocks database = %q", result.Facts.Routing.StarRocksDatabase)
	}
	if len(result.Facts.Query.Results) != 1 {
		t.Fatalf("results = %#v", result.Facts.Query.Results)
	}
}
