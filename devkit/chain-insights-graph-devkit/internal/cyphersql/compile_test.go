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
		q := `USE archive_topology MATCH (a:Identity {identity_id: "` + escapeForCypher(val) + `"}) RETURN a.identity_id AS id LIMIT 1`
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
		`USE archive_topology MATCH (a:Identity) // comment
		 RETURN a.identity_id AS id LIMIT 1`,
		`USE archive_topology /* c */ MATCH (a:Identity) RETURN a.identity_id AS id LIMIT 1`,
		`USE archive_topology MATCH (a:Identity) RETURN a.identity_id AS id LIMIT 1 -- tail`,
	} {
		if _, err := Compile(q); err == nil {
			t.Errorf("expected comment rejection for: %s", q)
		}
	}
}

// NULL semantics preserved: IS NULL / IS NOT NULL map straight through.
func TestNullSemantics(t *testing.T) {
	c, err := Compile(`USE archive_topology MATCH (a:Identity) WHERE a.is_exchange IS NULL RETURN a.identity_id AS id ORDER BY a.identity_id ASC LIMIT 10`)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(c.SQL, "IS NULL") {
		t.Errorf("IS NULL not preserved: %s", c.SQL)
	}
	c, err = Compile(`USE archive_topology MATCH (a:Identity) WHERE a.is_exchange IS NOT NULL RETURN a.identity_id AS id LIMIT 10`)
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
	c, err := Compile(`USE archive_topology MATCH (a:Identity {identity_id: "x"})-[f:FLOWS_TO]->(b:Identity) RETURN b.identity_id AS to_id, f.amount_usd_sum AS amt ORDER BY f.amount_usd_sum DESC LIMIT 50`)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(c.SQL, "ORDER BY") {
		t.Fatalf("no ORDER BY: %s", c.SQL)
	}
	// tiebreaker on the terminal identity appended after the explicit sort
	if !strings.Contains(c.SQL, "to_identity` ASC") {
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
		{"live scope", `USE live_topology MATCH (a:Identity) RETURN a.identity_id AS id LIMIT 1`, ErrUnsupportedShape},
		{"unknown label", `USE archive_topology MATCH (a:Widget) RETURN a.identity_id AS id LIMIT 1`, ErrUnknownIdentifier},
		{"unknown property", `USE archive_topology MATCH (a:Identity) RETURN a.nonexistent AS x LIMIT 1`, ErrUnknownIdentifier},
		{"unknown edge", `USE archive_topology MATCH (a:Identity)-[r:BOGUS]->(b:Identity) RETURN a.identity_id AS id LIMIT 1`, ErrUnknownIdentifier},
		{"variable length", `USE archive_topology MATCH (a:Identity)-[:FLOWS_TO*1..3]->(b:Identity) RETURN b.identity_id AS id LIMIT 1`, ErrUnsupportedShape},
		{"missing limit", `USE archive_topology MATCH (a:Identity) RETURN a.identity_id AS id`, ErrLimitRequired},
		{"limit too high", `USE archive_topology MATCH (a:Identity) RETURN a.identity_id AS id LIMIT 5000`, ErrLimitTooHigh},
		{"offset", `USE archive_topology MATCH (a:Identity) RETURN a.identity_id AS id SKIP 5 LIMIT 10`, ErrOffsetForbidden},
		{"with pipeline", `USE archive_topology MATCH (a:Identity) WITH a RETURN a.identity_id AS id LIMIT 1`, ErrUnsupportedShape},
		{"collect", `USE archive_topology MATCH (a:Identity) RETURN collect(a.identity_id) AS ids LIMIT 1`, ErrUnsupportedShape},
		{"write", `USE archive_topology MATCH (a:Identity) DELETE a LIMIT 1`, ErrParse},
	}
	for _, tc := range cases {
		_, err := Compile(tc.q)
		if !errors.Is(err, tc.want) {
			t.Errorf("%s: got %v, want %v", tc.name, err, tc.want)
		}
	}
}

// Cost bound: a 3-hop FLOWS_TO chain with both ends free is rejected;
// anchoring one end makes it compile.
func TestCostBound(t *testing.T) {
	free := `USE archive_topology MATCH (a:Identity)-[r1:FLOWS_TO]->(n1:Identity)-[r2:FLOWS_TO]->(n2:Identity)-[r3:FLOWS_TO]->(b:Identity) RETURN b.identity_id AS id LIMIT 10`
	if _, err := Compile(free); !errors.Is(err, ErrCostBound) {
		t.Errorf("free-ended 3-hop chain: want ErrCostBound, got %v", err)
	}
	anchored := `USE archive_topology MATCH (a:Identity {identity_id: "x"})-[r1:FLOWS_TO]->(n1:Identity)-[r2:FLOWS_TO]->(n2:Identity)-[r3:FLOWS_TO]->(b:Identity) RETURN b.identity_id AS id LIMIT 10`
	if _, err := Compile(anchored); err != nil {
		t.Errorf("anchored 3-hop chain should compile, got %v", err)
	}
}

func escapeForCypher(s string) string {
	return strings.ReplaceAll(s, `"`, `\"`)
}
