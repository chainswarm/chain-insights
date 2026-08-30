package devkitmcp

import "testing"

// Mirror-parity for the traversal-bounds gate (internal parity epics).
// The devkit copy is what a developer validates against locally; when it is
// looser than production, a locally-green query is refused by the real
// endpoint. Port upstream bounds changes together with their case here.

func parityBounds() TraversalBounds {
	return TraversalBounds{MaxDepth: 5, MaxK: 16, MaxUnwind: 1000}
}

// TestHopBoundCannotBeForged pins the three channels that each let an
// UNBOUNDED expansion look bounded: a bound read out of a string literal, out
// of a comment, out of a nested list slice inside an algorithm lambda, and a
// digit-grouped number the range regex could not match.
func TestHopBoundCannotBeForged(t *testing.T) {
	for _, query := range []string{
		`USE topology MATCH (a)-[r:FLOWS_TO* {asset:"0..2"}]->(b) RETURN b LIMIT 10`,
		`USE topology MATCH (a)-[r:FLOWS_TO* /*1..3*/]->(b) RETURN b LIMIT 10`,
		`USE topology MATCH p=(a)-[:FLOWS_TO *WSHORTEST (r,n | size(n.tags[0..2])) w]->(b) RETURN p LIMIT 5`,
		`USE topology MATCH (a)-[r:FLOWS_TO *1..1_000_000]->(b) RETURN b LIMIT 10`,
	} {
		if err := ValidateLiveTraversalBounds(query, parityBounds()); err == nil {
			t.Errorf("forged hop bound admitted locally but refused upstream: %s", query)
		}
	}
}

// TestGenuineBoundsStillAdmitted is the over-blocking guard.
func TestGenuineBoundsStillAdmitted(t *testing.T) {
	for _, query := range []string{
		`USE topology MATCH (a)-[r:FLOWS_TO*1..3]->(b) RETURN b LIMIT 10`,
		`USE topology MATCH (a)-[r:FLOWS_TO*1..5 {asset:"TAO"}]->(b) RETURN b LIMIT 10`,
		`USE topology MATCH (a)-[r:FLOWS_TO*BFS 1..4]->(b) RETURN b LIMIT 10`,
		`USE topology MATCH (a)-[r:FLOWS_TO]->(b) RETURN r LIMIT 10`,
		`USE topology MATCH (a)-[r*1..2]->(b) WHERE a.address = "[abc*def]" RETURN r LIMIT 10`,
	} {
		if err := ValidateLiveTraversalBounds(query, parityBounds()); err != nil {
			t.Errorf("genuine bound refused locally but admitted upstream: %s -> %v", query, err)
		}
	}
}

// TestDigitGroupingIsParsedNotIgnored: `1_0` is ten, not one.
func TestDigitGroupingIsParsedNotIgnored(t *testing.T) {
	if err := ValidateLiveTraversalBounds(`USE topology MATCH (a)-[r*1..1_0]->(b) RETURN b LIMIT 1`, parityBounds()); err == nil {
		t.Error("1_0 == 10 exceeds MaxDepth 5 and must be refused")
	}
	if err := ValidateLiveTraversalBounds(`USE topology MATCH (a)-[r*1..0_5]->(b) RETURN b LIMIT 1`, parityBounds()); err != nil {
		t.Errorf("0_5 == 5 is within MaxDepth 5 and must be admitted, got %v", err)
	}
}
