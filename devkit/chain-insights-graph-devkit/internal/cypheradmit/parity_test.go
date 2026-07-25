package cypheradmit

import (
	"strings"
	"testing"
)

// This package is a MIRROR of the production admission gate
// (chainswarm/data-pipeline internal/graphmcp). It had 645 lines and zero
// tracked tests, which is why it silently drifted four days behind production
// during the rbmk#473 hardening epic: every hardening landed upstream and none
// of it here, so a query a developer validated locally could be refused by the
// real endpoint.
//
// These tests pin the parity rules that drifted. Each case names the upstream
// PR it mirrors. When production's gate changes, port the change AND its case
// here in the same wave.

// TestTopologyStatementOpenerRefusesAdminVerbs mirrors data-pipeline #248.
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

// TestIndexedPredicateCannotBeForged mirrors data-pipeline #240 and #260. The
// cost-shape patterns must run over text with string literals and comments
// blanked out, or a crafted literal forges an indexed predicate the query does
// not have and buys an unbounded facts scan.
func TestIndexedPredicateCannotBeForged(t *testing.T) {
	forged := []string{
		`USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.asset_symbol = "junk tx_id = 1" RETURN t.tx_id AS tx_id LIMIT 10`,
		`USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.asset_symbol = 'junk address = 1' RETURN t.tx_id AS tx_id LIMIT 10`,
		"USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.asset_symbol <> `tx_id = 1` RETURN sum(t.amount_usd) AS s LIMIT 1",
		`USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) /* tx_id = 1 */ RETURN sum(t.amount_usd) AS s LIMIT 1`,
	}
	for _, query := range forged {
		if _, err := ValidateReadOnlyGraphQuery(query); err == nil {
			t.Errorf("forged indexed predicate admitted locally but refused upstream: %s", query)
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
		`USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.block_height >= 100 AND t.block_height <= 200 RETURN t.tx_id AS tx_id LIMIT 10`,
		// one-sided ranges STAY admitted — production deliberately did not narrow this
		`USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.block_date >= '2026-07-01' RETURN t.tx_id AS tx_id LIMIT 10`,
	} {
		if _, err := ValidateReadOnlyGraphQuery(query); err != nil {
			t.Errorf("genuine predicate refused locally but admitted upstream: %s -> %v", query, err)
		}
	}
}

// TestTierClassifierIgnoresDottedUseFacts mirrors data-pipeline #260: a
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
