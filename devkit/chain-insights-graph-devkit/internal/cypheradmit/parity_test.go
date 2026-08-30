package cypheradmit

import (
	"strings"
	"testing"
)

// This package is a MIRROR of the production admission gate
// (the retired internal federation module). It had 645 lines and zero
// tracked tests, which is why it silently drifted four days behind production
// during the internal epic, so a query a developer validated locally could be refused by the
// real endpoint.
//
// These tests pin the parity rules that drifted. Each case names the upstream
// PR it mirrors. When production's gate changes, port the change AND its case
// here in the same wave.

// TestTopologyStatementOpenerRefusesAdminVerbs mirrors the upstream pipeline #248.
// The read-clause allowlist only inspects tokens[0] of the whole query, which
// for `USE topology ...` is `USE` — so without this check the REAL statement is
// screened by the write denylist alone, and admin verbs that use no denylisted
// keyword reach the Bolt session.
func TestTopologyStatementOpenerRefusesAdminVerbs(t *testing.T) {
	for _, query := range []string{
		`USE topology SHOW STORAGE INFO`,
		`USE topology SHOW CONFIG`,
		`USE topology STORAGE MODE IN_MEMORY_ANALYTICAL`,
		`USE topology TERMINATE TRANSACTIONS "1234"`,
		`USE topology FREE MEMORY`,
		`USE topology ANALYZE GRAPH`,
		`USE topology RECOVER SNAPSHOT "/tmp/s"`,
		`USE topology REGISTER REPLICA r1 SYNC TO "10.0.0.1:10000"`,
		`USE topology USE DATABASE memgraph MATCH (n) RETURN n LIMIT 1`,
	} {
		if err := ValidateTopologyStatementOpener(query); err == nil {
			t.Errorf("admin verb admitted locally but refused upstream: %s", query)
		}
	}
}

// TestTopologyStatementOpenerAdmitsReadClauses guards against over-blocking:
// a devkit that refuses what production admits wastes developer time just as
// surely as one that admits what production refuses.
func TestTopologyStatementOpenerAdmitsReadClauses(t *testing.T) {
	for _, query := range []string{
		`USE topology MATCH (a:Address) RETURN a LIMIT 1`,
		`USE topology OPTIONAL MATCH (a:Address) RETURN a LIMIT 1`,
		`USE topology UNWIND [1,2,3] AS x RETURN x`,
		`USE topology WITH 1 AS x RETURN x`,
		`USE topology RETURN 1`,
		`USE topology EXPLAIN MATCH (a) RETURN a`,
		`USE topology PROFILE MATCH (a) RETURN a`,
		`USE topology match (a:Address) return a LIMIT 1`,
	} {
		if err := ValidateTopologyStatementOpener(query); err != nil {
			t.Errorf("read clause refused locally but admitted upstream: %s -> %v", query, err)
		}
	}
}

// TestIndexedPredicateCannotBeForged mirrors the upstream pipeline #240 and #260. The
// cost-shape patterns must run over text with string literals and comments
// blanked out, or a crafted literal forges an indexed predicate the query does
// not have and buys an unbounded facts scan.
func TestIndexedPredicateCannotBeForged(t *testing.T) {
	forged := []string{
		`USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.asset_symbol = "junk tx_id = 1" RETURN t.tx_id AS tx_id LIMIT 10`,
		`USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.asset_symbol = 'junk address = 1' RETURN t.tx_id AS tx_id LIMIT 10`,
		"USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.asset_symbol <> `tx_id = 1` RETURN sum(t.amount_usd) AS s LIMIT 1",
		`USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) /* tx_id = 1 */ RETURN sum(t.amount_usd) AS s LIMIT 1`,
		// the facts partition-pruning wave (plan 2026-08-28, Task 2): forged
		// block_date forms are blanked the same way — a crafted literal must
		// not buy an unbounded facts scan under the kind-aware gate.
		`USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.asset_symbol = "junk block_date = 1" RETURN t.tx_id AS tx_id LIMIT 10`,
		"USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.asset_symbol <> `block_date >= 1` RETURN sum(t.amount_usd) AS s LIMIT 1",
	}
	for _, query := range forged {
		if _, err := ValidateReadOnlyGraphQuery(query); err == nil {
			t.Errorf("forged indexed predicate admitted locally but refused upstream: %s", query)
		}
		if kind, _ := FactsPredicateKind(query); kind != FactsPredicateNone {
			t.Errorf("forged indexed predicate classified as kind %v: %s", kind, query)
		}
	}
}

// TestGenuineIndexedPredicatesStillAdmitted is the over-blocking guard for the
// rule above: a backtick IDENTIFIER is not data and must keep working.
func TestGenuineIndexedPredicatesStillAdmitted(t *testing.T) {
	for _, query := range []string{
		`USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.tx_id = "8505939-10" RETURN t.tx_id AS tx_id LIMIT 10`,
		"USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.`tx_id` = \"8505939-10\" RETURN t.tx_id AS tx_id LIMIT 10",
		`USE facts MATCH (a:Address {address: "5C4h"})-[t:TRANSFER]->(b:Address) RETURN t.tx_id AS tx_id LIMIT 10`,
		// one-sided ranges STAY admitted — production deliberately did not narrow this
		`USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.block_date >= '2026-07-01' RETURN t.tx_id AS tx_id LIMIT 10`,
	} {
		if _, err := ValidateReadOnlyGraphQuery(query); err != nil {
			t.Errorf("genuine predicate refused locally but admitted upstream: %s -> %v", query, err)
		}
	}
}

// TestFactsPredicateKindAdmitsTheThreeBoundedShapes mirrors the upstream pipeline's
// facts partition-pruning gate (plan 2026-08-28-facts-serving-partition-pruning
// Task 2, spec S1-S3): the three admitted predicate kinds are bare block_date
// bounds, tx_id equality/IN, and address equality/IN (map or WHERE). Precedence
// is blockDate > txID > address.
func TestFactsPredicateKindAdmitsTheThreeBoundedShapes(t *testing.T) {
	cases := []struct {
		name  string
		query string
		want  factsPredicateKind
	}{
		{"address map", `USE facts MATCH (a:Address {address: "5C4h"})-[t:TRANSFER]->(b:Address) RETURN t.tx_id AS tx_id LIMIT 10`, FactsPredicateAddress},
		{"address where equality", `USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE a.address = "5C4h" RETURN t.tx_id AS tx_id LIMIT 10`, FactsPredicateAddress},
		{"address where in", `USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE a.address IN ["5C4h", "5D1x"] RETURN t.tx_id AS tx_id LIMIT 10`, FactsPredicateAddress},
		{"address and tx_id precedence", `USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE a.address = "5C4h" AND t.tx_id = "8505939-10" RETURN t.tx_id AS tx_id LIMIT 10`, FactsPredicateTxID},
		{"tx_id equality", `USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.tx_id = "8505939-10" RETURN t.tx_id AS tx_id LIMIT 10`, FactsPredicateTxID},
		{"tx_id in", `USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.tx_id IN ["8505939-10"] RETURN t.tx_id AS tx_id LIMIT 10`, FactsPredicateTxID},
		{"block_date ge", `USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.block_date >= '2026-07-01' RETURN t.tx_id AS tx_id LIMIT 10`, FactsPredicateBlockDate},
		{"block_date two-sided", `USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.block_date >= '2026-06-01' AND t.block_date < '2026-09-01' RETURN t.tx_id AS tx_id LIMIT 10`, FactsPredicateBlockDate},
		{"block_date equality", `USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.block_date = '2026-07-01' RETURN t.tx_id AS tx_id LIMIT 10`, FactsPredicateBlockDate},
		{"block_date between", `USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.block_date BETWEEN '2026-06-01' AND '2026-09-01' RETURN t.tx_id AS tx_id LIMIT 10`, FactsPredicateBlockDate},
		{"block_date in", `USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.block_date IN ['2026-06-01', '2026-07-01'] RETURN t.tx_id AS tx_id LIMIT 10`, FactsPredicateBlockDate},
		{"full range stays lifetime", `USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.block_date >= '1970-01-01' RETURN t.tx_id AS tx_id LIMIT 10`, FactsPredicateBlockDate},
		{"grouped or arm admits", `USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.block_date >= '2026-06-01' AND (a.address = "5C4h" OR b.address = "5D1x") RETURN t.tx_id AS tx_id LIMIT 10`, FactsPredicateBlockDate},
	}
	for _, tc := range cases {
		kind, err := FactsPredicateKind(tc.query)
		if err != nil {
			t.Errorf("%s: FactsPredicateKind error: %v", tc.name, err)
			continue
		}
		if kind != tc.want {
			t.Errorf("%s: kind = %v, want %v", tc.name, kind, tc.want)
		}
		if _, err := ValidateReadOnlyGraphQuery(tc.query); err != nil {
			t.Errorf("%s: query refused locally but admitted upstream: %v", tc.name, err)
		}
	}
}

// TestFactsPredicateKindRejectsUnboundedShapes mirrors the upstream pipeline Task 2,
// spec S4/S5: block_height/block_timestamp-only bounds, function-wrapped
// block_date, and block_date inside an OR arm do not bound the partition scan.
// Each is rejected with the naming-remedy error. This includes the deliberate
// internal epic) flips from ADMITTED to REJECTED in the same wave as upstream.
func TestFactsPredicateKindRejectsUnboundedShapes(t *testing.T) {
	for _, query := range []string{
		`USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.block_height >= 100 AND t.block_height <= 200 RETURN t.tx_id AS tx_id LIMIT 10`,
		`USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.block_height >= 100 RETURN t.tx_id AS tx_id LIMIT 10`,
		`USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.block_timestamp > 0 RETURN t.tx_id AS tx_id LIMIT 10`,
		`USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE DATE(t.block_date) >= '2026-06-01' RETURN t.tx_id AS tx_id LIMIT 10`,
		`USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.block_height >= 0 OR t.block_date >= '2026-06-01' RETURN t.tx_id AS tx_id LIMIT 10`,
		`USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE (t.block_date >= '2026-06-01') OR (b.address = "5C4h") RETURN t.tx_id AS tx_id LIMIT 10`,
		`USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE a.address = "5C4h" AND (t.block_date >= '2026-06-01' OR t.block_date <= '2026-08-01') RETURN t.tx_id AS tx_id LIMIT 10`,
	} {
		kind, err := FactsPredicateKind(query)
		if kind != FactsPredicateNone {
			t.Errorf("unbounded shape classified as kind %v: %s", kind, query)
		}
		if err == nil || !strings.Contains(err.Error(), FactsPredicateRemedy) {
			t.Errorf("rejection error does not carry the remedy: %v (query: %s)", err, query)
		}
		if _, err := ValidateReadOnlyGraphQuery(query); err == nil {
			t.Errorf("unbounded shape admitted locally but refused upstream: %s", query)
		}
	}
}

// TestTierClassifierIgnoresDottedUseFacts mirrors the upstream pipeline #260: a
// property path like `n.use.facts` must not flip the billing tier.
func TestTierClassifierIgnoresDottedUseFacts(t *testing.T) {
	for _, query := range []string{
		`USE topology MATCH (n:Address) RETURN n.use.facts LIMIT 1`,
		`USE topology MATCH (n:Address) RETURN count(n.use.facts) AS c LIMIT 1`,
	} {
		if tier := ClassifyQueryTier(query); tier == QueryTierStarRocks {
			t.Errorf("dotted use.facts flipped the tier locally but not upstream: %s", query)
		}
	}
}

// TestStripLiteralsAndCommentsKeepsBareIdentifiers pins the exported lexical
// view the traversal-bounds gate shares.
func TestStripLiteralsAndCommentsKeepsBareIdentifiers(t *testing.T) {
	if got := StripLiteralsAndComments("MATCH (a) WHERE a.`tx_id` = \"x\" RETURN a"); !strings.Contains(got, "`tx_id`") {
		t.Errorf("a bare backtick identifier must survive stripping, got %q", got)
	}
	if got := StripLiteralsAndComments("MATCH (a) WHERE a.x = \"tx_id = 1\" RETURN a"); strings.Contains(got, "tx_id = 1") {
		t.Errorf("a string literal must be blanked, got %q", got)
	}
	if got := StripLiteralsAndComments("MATCH (a) /* tx_id = 1 */ RETURN a"); strings.Contains(got, "tx_id") {
		t.Errorf("a comment must be blanked, got %q", got)
	}
}
