package devkitmcp

import (
	"strings"
	"testing"
)

func testBounds() TraversalBounds { return TraversalBounds{MaxDepth: 5, MaxK: 16, MaxUnwind: 1000} }

func TestLiveTraversalBoundsAcceptsBoundedNativeForms(t *testing.T) {
	ok := []string{
		`USE live_topology MATCH p=(a:Identity {identity_id:"x"})-[:FLOWS_TO *BFS 1..5]->(b:Identity {identity_id:"y"}) RETURN p LIMIT 5`,
		`USE live_topology MATCH (a:Identity {identity_id:"x"})-[:FLOWS_TO *1..3]->(b:Identity) RETURN b.identity_id LIMIT 10`,
		`USE live_topology MATCH p=(a:Identity {identity_id:"x"})-[:FLOWS_TO *WSHORTEST 5 (r,n | coalesce(r.amount_usd_sum,1)) w]->(b:Identity {identity_id:"y"}) RETURN p LIMIT 5`,
		`USE live_topology MATCH p=(a)-[:FLOWS_TO *KSHORTEST|3]->(b) RETURN p LIMIT 3`,
		`USE live_topology MATCH (a:Identity)-[:FLOWS_TO]->(b:Identity) RETURN b.identity_id LIMIT 10`, // no traversal marker
	}
	for _, q := range ok {
		if err := ValidateLiveTraversalBounds(q, testBounds()); err != nil {
			t.Errorf("expected accept, got %v\n  %s", err, q)
		}
	}
}

func TestLiveTraversalBoundsRejectsUnbounded(t *testing.T) {
	bad := []struct{ q, want string }{
		{`USE live_topology MATCH (a:Identity {identity_id:"x"})-[:FLOWS_TO *]->(b) RETURN b.identity_id LIMIT 10`, "unbounded"},
		{`USE live_topology MATCH p=(a {identity_id:"x"})-[:FLOWS_TO *BFS]->(b) RETURN p LIMIT 5`, "unbounded"},
		{`USE live_topology MATCH (a {identity_id:"x"})-[:FLOWS_TO *3..]->(b) RETURN b.identity_id LIMIT 5`, "unbounded"},
	}
	for _, tc := range bad {
		err := ValidateLiveTraversalBounds(tc.q, testBounds())
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("expected %q rejection, got %v\n  %s", tc.want, err, tc.q)
		}
	}
}

func TestLiveTraversalBoundsRejectsOverCap(t *testing.T) {
	if err := ValidateLiveTraversalBounds(`USE live_topology MATCH (a {identity_id:"x"})-[:FLOWS_TO *1..9]->(b) RETURN b.identity_id LIMIT 5`, testBounds()); err == nil || !strings.Contains(err.Error(), "exceeds the maximum of 5") {
		t.Errorf("expected depth-cap rejection, got %v", err)
	}
	if err := ValidateLiveTraversalBounds(`USE live_topology MATCH p=(a)-[:FLOWS_TO *KSHORTEST|50]->(b) RETURN p LIMIT 5`, testBounds()); err == nil || !strings.Contains(err.Error(), "k=50") {
		t.Errorf("expected k-cap rejection, got %v", err)
	}
}

func TestLiveTraversalBoundsUnwindCap(t *testing.T) {
	small := TraversalBounds{MaxDepth: 5, MaxK: 16, MaxUnwind: 3}
	if err := ValidateLiveTraversalBounds(`USE live_topology UNWIND [1,2,3] AS x RETURN x LIMIT 3`, small); err != nil {
		t.Errorf("3-item UNWIND within cap should pass, got %v", err)
	}
	if err := ValidateLiveTraversalBounds(`USE live_topology UNWIND [1,2,3,4,5] AS x RETURN x LIMIT 5`, small); err == nil || !strings.Contains(err.Error(), "exceeds the maximum of 3") {
		t.Errorf("5-item UNWIND over cap should fail, got %v", err)
	}
}

// The bounds gate mirrors production: it runs ONLY for an explicit
// `USE live_topology` read. Archive/facts (translator path) and no-prefix
// queries must not be bounds-checked here.
func TestQueryTargetsLiveTopologyGate(t *testing.T) {
	live := []string{
		`USE live_topology MATCH (n:Identity) RETURN n LIMIT 1`,
		`  use   LIVE_TOPOLOGY MATCH (n) RETURN n LIMIT 1`,
	}
	for _, q := range live {
		if !queryTargetsLiveTopology(q) {
			t.Errorf("expected live-topology gate true for %q", q)
		}
	}
	notLive := []string{
		`USE archive_topology MATCH (a)-[r:FLOWS_TO]->(b) RETURN b LIMIT 5`,
		`USE facts MATCH (l:AddressLabel) RETURN l LIMIT 5`,
		`MATCH (n:Identity) RETURN n LIMIT 1`, // no prefix
	}
	for _, q := range notLive {
		if queryTargetsLiveTopology(q) {
			t.Errorf("expected live-topology gate false for %q", q)
		}
	}
}

func TestDefaultTraversalBoundsMirrorProduction(t *testing.T) {
	b := defaultTraversalBounds()
	if b.MaxDepth != 5 || b.MaxK != 16 || b.MaxUnwind != 1000 {
		t.Errorf("default bounds = %+v, want {5 16 1000}", b)
	}
}
