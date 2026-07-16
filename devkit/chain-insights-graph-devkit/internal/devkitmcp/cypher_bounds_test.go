package devkitmcp

import (
	"strings"
	"testing"
)

func testBounds() TraversalBounds { return TraversalBounds{MaxDepth: 5, MaxK: 16, MaxUnwind: 1000} }

func TestLiveTraversalBoundsAcceptsBoundedNativeForms(t *testing.T) {
	ok := []string{
		`USE topology MATCH p=(a:Address {address:"x"})-[:FLOWS_TO *BFS 1..5]->(b:Address {address:"y"}) RETURN p LIMIT 5`,
		`USE topology MATCH (a:Address {address:"x"})-[:FLOWS_TO *1..3]->(b:Address) RETURN b.address LIMIT 10`,
		`USE topology MATCH p=(a:Address {address:"x"})-[:FLOWS_TO *WSHORTEST 5 (r,n | coalesce(r.amount_usd_sum,1)) w]->(b:Address {address:"y"}) RETURN p LIMIT 5`,
		`USE topology MATCH p=(a)-[:FLOWS_TO *KSHORTEST|3]->(b) RETURN p LIMIT 3`,
		`USE topology MATCH (a:Address)-[:FLOWS_TO]->(b:Address) RETURN b.address LIMIT 10`, // no traversal marker
	}
	for _, q := range ok {
		if err := ValidateLiveTraversalBounds(q, testBounds()); err != nil {
			t.Errorf("expected accept, got %v\n  %s", err, q)
		}
	}
}

func TestLiveTraversalBoundsRejectsUnbounded(t *testing.T) {
	bad := []struct{ q, want string }{
		{`USE topology MATCH (a:Address {address:"x"})-[:FLOWS_TO *]->(b) RETURN b.address LIMIT 10`, "unbounded"},
		{`USE topology MATCH p=(a {address:"x"})-[:FLOWS_TO *BFS]->(b) RETURN p LIMIT 5`, "unbounded"},
		{`USE topology MATCH (a {address:"x"})-[:FLOWS_TO *3..]->(b) RETURN b.address LIMIT 5`, "unbounded"},
	}
	for _, tc := range bad {
		err := ValidateLiveTraversalBounds(tc.q, testBounds())
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("expected %q rejection, got %v\n  %s", tc.want, err, tc.q)
		}
	}
}

func TestLiveTraversalBoundsRejectsOverCap(t *testing.T) {
	if err := ValidateLiveTraversalBounds(`USE topology MATCH (a {address:"x"})-[:FLOWS_TO *1..9]->(b) RETURN b.address LIMIT 5`, testBounds()); err == nil || !strings.Contains(err.Error(), "exceeds the maximum of 5") {
		t.Errorf("expected depth-cap rejection, got %v", err)
	}
	if err := ValidateLiveTraversalBounds(`USE topology MATCH p=(a)-[:FLOWS_TO *KSHORTEST|50]->(b) RETURN p LIMIT 5`, testBounds()); err == nil || !strings.Contains(err.Error(), "k=50") {
		t.Errorf("expected k-cap rejection, got %v", err)
	}
}

func TestLiveTraversalBoundsUnwindCap(t *testing.T) {
	small := TraversalBounds{MaxDepth: 5, MaxK: 16, MaxUnwind: 3}
	if err := ValidateLiveTraversalBounds(`USE topology UNWIND [1,2,3] AS x RETURN x LIMIT 3`, small); err != nil {
		t.Errorf("3-item UNWIND within cap should pass, got %v", err)
	}
	if err := ValidateLiveTraversalBounds(`USE topology UNWIND [1,2,3,4,5] AS x RETURN x LIMIT 5`, small); err == nil || !strings.Contains(err.Error(), "exceeds the maximum of 3") {
		t.Errorf("5-item UNWIND over cap should fail, got %v", err)
	}
}

// The bounds gate mirrors production: it runs ONLY for an explicit
// `USE topology` read. Facts (translator path) and no-prefix queries must not
// be bounds-checked here.
func TestQueryTargetsTopologyGate(t *testing.T) {
	topology := []string{
		`USE topology MATCH (n:Address) RETURN n LIMIT 1`,
		`  use   TOPOLOGY MATCH (n) RETURN n LIMIT 1`,
	}
	for _, q := range topology {
		if !queryTargetsTopology(q) {
			t.Errorf("expected topology gate true for %q", q)
		}
	}
	notTopology := []string{
		`USE facts MATCH (l:AddressLabel) RETURN l LIMIT 5`,
		`MATCH (n:Address) RETURN n LIMIT 1`, // no prefix
	}
	for _, q := range notTopology {
		if queryTargetsTopology(q) {
			t.Errorf("expected topology gate false for %q", q)
		}
	}
}

func TestDefaultTraversalBoundsMirrorProduction(t *testing.T) {
	b := defaultTraversalBounds()
	if b.MaxDepth != 5 || b.MaxK != 16 || b.MaxUnwind != 1000 {
		t.Errorf("default bounds = %+v, want {5 16 1000}", b)
	}
}
