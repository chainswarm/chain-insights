package cyphersql

import (
	"errors"
	"strings"
	"testing"
)

// Injection: every literal — however hostile — must become a bound arg and
// must NOT appear in the emitted SQL text.
func TestInjectionLiteralsAreBoundNotInterpolated(t *testing.T) {
	hostile := []string{
		`x'; DROP TABLE users; --`,
		`a" OR "1"="1`,
		"back`tick",
		`quote'quote`,
		`back\slash`,
		`semi;colon`,
		`c/*comment*/d`,
	}
	for _, val := range hostile {
		q := `USE facts MATCH (a:Address {address: "` + escapeForCypher(val) + `"}) RETURN a.address AS id LIMIT 1`
		c, err := Compile(q)
		if err != nil {
			// A literal containing a comment sequence may be rejected at lex
			// time — that is also safe. But if it compiled, it must be bound.
			continue
		}
		if strings.Contains(c.SQL, "DROP") || strings.Contains(c.SQL, val) {
			t.Errorf("hostile literal %q leaked into SQL: %s", val, c.SQL)
		}
		if len(c.Args) != 1 || c.Args[0] != val {
			t.Errorf("hostile literal %q not bound as arg (args=%v)", val, c.Args)
		}
	}
}

// Comments in the query body are rejected outright.
func TestCommentsRejected(t *testing.T) {
	for _, q := range []string{
		`USE facts MATCH (a:Address) // comment
		 RETURN a.address AS id LIMIT 1`,
		`USE facts /* c */ MATCH (a:Address) RETURN a.address AS id LIMIT 1`,
		`USE facts MATCH (a:Address) RETURN a.address AS id LIMIT 1 -- tail`,
	} {
		if _, err := Compile(q); err == nil {
			t.Errorf("expected comment rejection for: %s", q)
		}
	}
}

// The retired Asset facts label (facts_assets_view, dropped schema-side) is no
// longer mapped: an :Asset query fails at COMPILE time with the unknown-label
// validation error instead of reaching StarRocks.
func TestAssetLabelRejectedAsUnmapped(t *testing.T) {
	for _, q := range []string{
		`USE facts MATCH (a:Asset) WHERE a.coingecko_id IS NULL RETURN a.asset_symbol AS id ORDER BY a.asset_symbol ASC LIMIT 10`,
		`USE facts MATCH (a:Asset) WHERE a.coingecko_id IS NOT NULL RETURN a.asset_symbol AS id LIMIT 10`,
	} {
		_, err := Compile(q)
		if err == nil {
			t.Errorf("expected unmapped-label rejection for: %s", q)
			continue
		}
		if !strings.Contains(err.Error(), `node label "Asset" is not mapped`) {
			t.Errorf("error %q does not name the unmapped Asset label", err.Error())
		}
	}
}

// The retired LINKED facts edge (linked_addresses_view, dropped by migration
// 0022) is no longer mapped: a facts-scope [:LINKED] query fails at COMPILE
// time with the unknown-relationship validation error. LINKED is served only
// on USE topology (native Memgraph).
func TestLinkedEdgeRejectedAsUnmapped(t *testing.T) {
	for _, q := range []string{
		`USE facts MATCH (a:Address {address: "x"})-[:LINKED]->(b:Address) RETURN b.address AS id LIMIT 5`,
		`USE facts MATCH (a:Address {address: "x"})-[l:LINKED]->(b:Address) RETURN b.address AS id, l.basis AS basis LIMIT 5`,
	} {
		_, err := Compile(q)
		if err == nil {
			t.Errorf("expected unmapped-relationship rejection for: %s", q)
			continue
		}
		if !strings.Contains(err.Error(), `relationship type "LINKED" is not mapped`) {
			t.Errorf("error %q does not name the unmapped LINKED relationship", err.Error())
		}
	}
}

// The retired RiskScore facts label (facts_risk_scores_view, retired by
// rbmk#447 P2a — ML risk verdict is topology-only) is no longer mapped: a
// :RiskScore / [:HAS_RISK_SCORE] query fails at COMPILE time with the
// unknown-label / unknown-relationship validation error.
func TestRiskScoreRejectedAsUnmapped(t *testing.T) {
	labelQueries := []string{
		`USE facts MATCH (r:RiskScore) WHERE r.risk_score IS NULL RETURN r.risk_score_id AS id LIMIT 10`,
		`USE facts MATCH (r:RiskScore) WHERE r.risk_score IS NOT NULL RETURN r.risk_score_id AS id LIMIT 10`,
	}
	for _, q := range labelQueries {
		_, err := Compile(q)
		if err == nil {
			t.Errorf("expected unmapped-label rejection for: %s", q)
			continue
		}
		if !strings.Contains(err.Error(), `node label "RiskScore" is not mapped`) {
			t.Errorf("error %q does not name the unmapped RiskScore label", err.Error())
		}
	}
	edgeQueries := []string{
		`USE facts MATCH (a:Address)-[:HAS_RISK_SCORE]->(r:RiskScore) RETURN a.address AS id LIMIT 10`,
		`USE facts MATCH (a:Address)-[:HAS_RISK_SCORE]->(r) RETURN a.address AS id LIMIT 10`,
	}
	for _, q := range edgeQueries {
		_, err := Compile(q)
		if err == nil {
			t.Errorf("expected unmapped-relationship rejection for: %s", q)
			continue
		}
		if !strings.Contains(err.Error(), `relationship type "HAS_RISK_SCORE" is not mapped`) {
			t.Errorf("error %q does not name the unmapped HAS_RISK_SCORE relationship", err.Error())
		}
	}
}

// The retired AddressLabel facts label and HAS_LABEL edge
// (facts_address_labels_view, dropped schema-side; per-label risk now lives
// on the topology address node as i.label_risk) are no longer mapped: a
// facts [:HAS_LABEL] query fails at COMPILE time with the unknown-relationship
// validation error instead of reaching StarRocks.
func TestLabelEdgeRejectedAsUnmapped(t *testing.T) {
	for _, q := range []string{
		`USE facts MATCH (a:Address)-[:HAS_LABEL]->(l:AddressLabel) RETURN a.address AS id, l.label AS label LIMIT 25`,
		`USE facts MATCH (a:Address {address: "x"})-[hl:HAS_LABEL]->(l:AddressLabel) RETURN a.address AS id, hl.updated_timestamp AS updated_timestamp LIMIT 5`,
	} {
		_, err := Compile(q)
		if err == nil {
			t.Errorf("expected unmapped-relationship rejection for: %s", q)
			continue
		}
		if !strings.Contains(err.Error(), `relationship type "HAS_LABEL" is not mapped`) {
			t.Errorf("error %q does not name the unmapped HAS_LABEL relationship", err.Error())
		}
	}
}

// NULL semantics preserved: IS NULL / IS NOT NULL map straight through.
func TestNullSemantics(t *testing.T) {
	c, err := Compile(`USE facts MATCH (a:Address)-[:HAS_FEATURE]->(f:AddressFeature) WHERE f.net_flow_usd IS NULL RETURN a.address AS id ORDER BY a.address ASC LIMIT 10`)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(c.SQL, "IS NULL") {
		t.Errorf("IS NULL not preserved: %s", c.SQL)
	}
	c, err = Compile(`USE facts MATCH (a:Address)-[:HAS_FEATURE]->(f:AddressFeature) WHERE f.net_flow_usd IS NOT NULL RETURN a.address AS id LIMIT 10`)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(c.SQL, "IS NOT NULL") {
		t.Errorf("IS NOT NULL not preserved: %s", c.SQL)
	}
}

// Deterministic ordering: a stable id tiebreaker is appended so LIMIT
// truncation is reproducible.
func TestOrderByTiebreaker(t *testing.T) {
	c, err := Compile(`USE facts MATCH (a:Address {address: "x"})-[:HAS_FEATURE]->(f:AddressFeature) RETURN f.degree_in AS degree_in, f.net_flow_usd AS net_flow_usd ORDER BY f.net_flow_usd DESC LIMIT 50`)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(c.SQL, "ORDER BY") {
		t.Fatalf("no ORDER BY: %s", c.SQL)
	}
	// tiebreaker on the terminal label's id appended after the explicit sort
	if !strings.Contains(c.SQL, "address` ASC") {
		t.Errorf("missing id tiebreaker: %s", c.SQL)
	}
}

// Negative shapes: each returns the correct typed sentinel.
func TestNegativeShapes(t *testing.T) {
	cases := []struct {
		name string
		q    string
		want error
	}{
		{"topology scope", `USE topology MATCH (a:Address) RETURN a.address AS id LIMIT 1`, ErrUnsupportedShape},
		{"unknown label", `USE facts MATCH (a:Widget) RETURN a.address AS id LIMIT 1`, ErrUnknownIdentifier},
		{"unknown property", `USE facts MATCH (a:AddressFeature) RETURN a.nonexistent AS x LIMIT 1`, ErrUnknownIdentifier},
		{"unknown edge", `USE facts MATCH (a:Address)-[r:BOGUS]->(b:Address) RETURN a.address AS id LIMIT 1`, ErrUnknownIdentifier},
		{"variable length", `USE facts MATCH (a:Address)-[:HAS_FEATURE*1..3]->(f:AddressFeature) RETURN f.degree_in AS id LIMIT 1`, ErrUnsupportedShape},
		{"missing limit", `USE facts MATCH (a:Address) RETURN a.address AS id`, ErrLimitRequired},
		{"limit too high", `USE facts MATCH (a:Address) RETURN a.address AS id LIMIT 5000`, ErrLimitTooHigh},
		{"offset", `USE facts MATCH (a:Address) RETURN a.address AS id SKIP 5 LIMIT 10`, ErrOffsetForbidden},
		{"with pipeline", `USE facts MATCH (a:Address) WITH a RETURN a.address AS id LIMIT 1`, ErrUnsupportedShape},
		{"collect", `USE facts MATCH (a:Address) RETURN collect(a.address) AS ids LIMIT 1`, ErrUnsupportedShape},
		{"write", `USE facts MATCH (a:Address) DELETE a LIMIT 1`, ErrParse},
	}
	for _, tc := range cases {
		_, err := Compile(tc.q)
		if !errors.Is(err, tc.want) {
			t.Errorf("%s: got %v, want %v", tc.name, err, tc.want)
		}
	}
}

func escapeForCypher(s string) string {
	return strings.ReplaceAll(s, `"`, `\"`)
}
