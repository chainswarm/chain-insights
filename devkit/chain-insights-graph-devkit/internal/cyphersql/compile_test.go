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

// NULL semantics preserved: IS NULL / IS NOT NULL map straight through.
func TestNullSemantics(t *testing.T) {
	c, err := Compile(`USE facts MATCH (a:Asset) WHERE a.coingecko_id IS NULL RETURN a.asset_symbol AS id ORDER BY a.asset_symbol ASC LIMIT 10`)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(c.SQL, "IS NULL") {
		t.Errorf("IS NULL not preserved: %s", c.SQL)
	}
	c, err = Compile(`USE facts MATCH (a:Asset) WHERE a.coingecko_id IS NOT NULL RETURN a.asset_symbol AS id LIMIT 10`)
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
	c, err := Compile(`USE facts MATCH (a:Address {address: "x"})-[:HAS_LABEL]->(l:AddressLabel) RETURN l.label AS label, l.confidence_score AS score ORDER BY l.confidence_score DESC LIMIT 50`)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(c.SQL, "ORDER BY") {
		t.Fatalf("no ORDER BY: %s", c.SQL)
	}
	// tiebreaker on the terminal label's id appended after the explicit sort
	if !strings.Contains(c.SQL, "label_id` ASC") {
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
		{"variable length", `USE facts MATCH (a:Address)-[:HAS_LABEL*1..3]->(l:AddressLabel) RETURN l.label AS id LIMIT 1`, ErrUnsupportedShape},
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
