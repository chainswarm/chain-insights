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
		// Asset is a standalone-mappable facts label (Address is endpoint-only
		// and refuses single-node MATCH at compile time).
		q := `USE facts MATCH (a:Asset {asset_contract: "` + escapeForCypher(val) + `"}) RETURN a.asset_contract AS id LIMIT 1`
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

// The Asset facts label (facts_assets_view) is part of the production serving
// contract the devkit tracks, and the fake-token recipe reads it. It compiles
// for its mapped properties; unmapped properties are still rejected, so the
// allowlist stays exact.
func TestAssetLabelCompiles(t *testing.T) {
	for _, q := range []string{
		`USE facts MATCH (a:Asset) RETURN a.asset_contract AS asset_contract, a.symbol_lower AS symbol_lower, a.asset_symbol AS asset_symbol, a.verified AS verified, a.verification_source AS verification_source ORDER BY a.asset_contract LIMIT 10`,
		`USE facts MATCH (a:Asset) WHERE a.asset_contract > "x" RETURN a.asset_contract AS asset_contract LIMIT 10`,
	} {
		compiled, err := Compile(q)
		if err != nil {
			t.Errorf("expected :Asset to compile, got %v for: %s", err, q)
			continue
		}
		if !strings.Contains(compiled.SQL, "facts_assets_view") {
			t.Errorf("compiled SQL %q does not target facts_assets_view", compiled.SQL)
		}
	}

	unmapped := `USE facts MATCH (a:Asset) WHERE a.coingecko_id IS NULL RETURN a.asset_symbol AS id LIMIT 10`
	if _, err := Compile(unmapped); err == nil {
		t.Errorf("expected unmapped-property rejection for: %s", unmapped)
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
// internal epic) is no longer mapped: a
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

// The retired NeuronEndpoint/Hotkey/IPAddress facts labels and their
// HAS_NEURON_ENDPOINT/REGISTERED_NEURON/SERVED_FROM/OPERATED_FROM edges
// (facts_neuron_endpoints_view, facts_neuron_hotkeys_view,
// facts_neuron_ip_addresses_view, dropped schema-side by internal migration 0031)
// are no longer mapped: neuron identity, hotkey/coldkey pairing, and
// IP/axon-port observation now live on the topology :Neuron node and
// MINES/VALIDATES/HOTKEY_OF/COLDKEY_OF edges. A facts query against any of
// the retired shapes fails at COMPILE time with the unknown-label/unknown-
// relationship validation error instead of reaching StarRocks.
func TestNeuronShapesRejectedAsUnmapped(t *testing.T) {
	cases := []struct {
		query   string
		wantErr string
	}{
		{
			`USE facts MATCH (n:NeuronEndpoint) WHERE n.netuid = 15 RETURN n.endpoint_id AS endpoint_id LIMIT 25`,
			`node label "NeuronEndpoint" is not mapped`,
		},
		{
			`USE facts MATCH (a:Address {address: "x"})-[hne:HAS_NEURON_ENDPOINT]->(n:NeuronEndpoint) RETURN n.endpoint_id AS endpoint_id LIMIT 25`,
			`relationship type "HAS_NEURON_ENDPOINT" is not mapped`,
		},
		{
			`USE facts MATCH (a:Address {address: "x"})-[reg:REGISTERED_NEURON]->(h:Hotkey) RETURN h.address AS hotkey_address LIMIT 25`,
			`relationship type "REGISTERED_NEURON" is not mapped`,
		},
		{
			`USE facts MATCH (h:Hotkey) RETURN h.address AS address LIMIT 25`,
			`node label "Hotkey" is not mapped`,
		},
		{
			`USE facts MATCH (h:Hotkey)-[sf:SERVED_FROM]->(ip:IPAddress) RETURN ip.ip_address AS ip_address LIMIT 25`,
			`relationship type "SERVED_FROM" is not mapped`,
		},
		{
			`USE facts MATCH (a:Address {address: "x"})-[op:OPERATED_FROM]->(ip:IPAddress) RETURN ip.ip_address AS ip_address LIMIT 25`,
			`relationship type "OPERATED_FROM" is not mapped`,
		},
		{
			`USE facts MATCH (ip:IPAddress) RETURN ip.ip_address AS ip_address LIMIT 25`,
			`node label "IPAddress" is not mapped`,
		},
	}
	for _, c := range cases {
		_, err := Compile(c.query)
		if err == nil {
			t.Errorf("expected unmapped rejection for: %s", c.query)
			continue
		}
		if !strings.Contains(err.Error(), c.wantErr) {
			t.Errorf("error %q does not contain %q for query: %s", err.Error(), c.wantErr, c.query)
		}
	}
}

// The TRANSFER facts edge (facts_transfers_view) compiles the
// (from:Address)-[t:TRANSFER]->(to:Address) shape: endpoint identity binds via
// from_address/to_address (the Address node's "address" id column), and the
// row's other columns are TRANSFER edge properties.
func TestTransferEdgeCompiles(t *testing.T) {
	c, err := Compile(`USE facts MATCH (from:Address {address: "5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuyUpnhM"})-[t:TRANSFER]->(to:Address) RETURN to.address AS to_address, t.tx_id AS tx_id, t.block_height AS block_height, t.amount_usd AS amount_usd LIMIT 10`)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(c.SQL, "facts_transfers_view") {
		t.Errorf("expected facts_transfers_view in SQL: %s", c.SQL)
	}
	if !strings.Contains(c.SQL, "from_address") || !strings.Contains(c.SQL, "to_address") {
		t.Errorf("expected endpoint columns in SQL: %s", c.SQL)
	}
	if len(c.Args) != 1 || c.Args[0] != "5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuyUpnhM" {
		t.Errorf("expected bound from_address arg, got %v", c.Args)
	}
}

// Row-select by tx_id: tx_id is a TRANSFER edge property (not an endpoint id),
// so it is filtered via WHERE rather than an inline node property.
func TestTransferEdgeFiltersByTxID(t *testing.T) {
	c, err := Compile(`USE facts MATCH (from:Address)-[t:TRANSFER]->(to:Address) WHERE t.tx_id = "8505939-10" RETURN from.address AS from_address, to.address AS to_address, t.event_index AS event_index, t.edge_index AS edge_index LIMIT 10`)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(c.SQL, "tx_id") {
		t.Errorf("expected tx_id predicate in SQL: %s", c.SQL)
	}
	if len(c.Args) != 1 || c.Args[0] != "8505939-10" {
		t.Errorf("expected bound tx_id arg, got %v", c.Args)
	}
}

// Bounded aggregate: count + sum(amount_usd) anchored on an address endpoint.
func TestTransferEdgeAggregateByAddress(t *testing.T) {
	c, err := Compile(`USE facts MATCH (from:Address {address: "5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuyUpnhM"})-[t:TRANSFER]->(to:Address) RETURN count(t) AS transfer_count, sum(t.amount_usd) AS total_amount_usd LIMIT 1`)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(c.SQL, "COUNT(*)") || !strings.Contains(c.SQL, "SUM(") {
		t.Errorf("expected count/sum aggregate SQL: %s", c.SQL)
	}
	if !strings.Contains(c.SQL, "COALESCE(SUM(") {
		t.Errorf("expected sum() to be wrapped in COALESCE(..., 0): %s", c.SQL)
	}
}

// StarRocks returns NULL for SUM() over an empty group; openCypher/Memgraph
// sum() = 0 for the same case. Every sum() aggregate must compile to
// COALESCE(SUM(col), 0) so a bounded aggregate on a transfer-less address (or
// any empty-group sum) serves 0, not NULL, alongside count: 0.
func TestSumAggregateWrapsCoalesceForEmptyGroup(t *testing.T) {
	c, err := Compile(`USE facts MATCH (from:Address {address: "5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuyUpnhM"})-[t:TRANSFER]->(to:Address) RETURN sum(t.amount_usd) AS total_amount_usd LIMIT 1`)
	if err != nil {
		t.Fatal(err)
	}
	want := "COALESCE(SUM(`e1`.`amount_usd`), 0) AS `total_amount_usd`"
	if !strings.Contains(c.SQL, want) {
		t.Errorf("SQL = %s, want it to contain %q", c.SQL, want)
	}
	if strings.Contains(c.SQL, "COALESCE(SUM(SUM(") {
		t.Errorf("double-wrapped SUM: %s", c.SQL)
	}
}

// NULL semantics preserved: IS NULL / IS NOT NULL map straight through.
func TestNullSemantics(t *testing.T) {
	c, err := Compile(`USE facts MATCH (from:Address)-[t:TRANSFER]->(to:Address) WHERE t.price_missing IS NULL RETURN from.address AS id LIMIT 10`)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(c.SQL, "IS NULL") {
		t.Errorf("IS NULL not preserved: %s", c.SQL)
	}
	c, err = Compile(`USE facts MATCH (from:Address)-[t:TRANSFER]->(to:Address) WHERE t.price_missing IS NOT NULL RETURN from.address AS id LIMIT 10`)
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
	c, err := Compile(`USE facts MATCH (from:Address {address: "x"})-[t:TRANSFER]->(to:Address) RETURN t.amount_usd AS amount_usd, t.tx_id AS tx_id ORDER BY t.amount_usd DESC LIMIT 50`)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(c.SQL, "ORDER BY") {
		t.Fatalf("no ORDER BY: %s", c.SQL)
	}
	// tiebreaker on the terminal label's id (the TRANSFER target endpoint)
	// appended after the explicit sort
	if !strings.Contains(c.SQL, "to_address` ASC") {
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
		{"standalone address endpoint-only", `USE facts MATCH (a:Address) RETURN a.address AS id LIMIT 1`, ErrUnsupportedShape},
		{"unknown label", `USE facts MATCH (a:Widget) RETURN a.address AS id LIMIT 1`, ErrUnknownIdentifier},
		{"retired AddressFeature label", `USE facts MATCH (a:AddressFeature) RETURN a.nonexistent AS x LIMIT 1`, ErrUnknownIdentifier},
		{"unknown edge", `USE facts MATCH (a:Address)-[r:BOGUS]->(b:Address) RETURN a.address AS id LIMIT 1`, ErrUnknownIdentifier},
		{"variable length", `USE facts MATCH (a:Address)-[:TRANSFER*1..3]->(f:Address) RETURN f.address AS id LIMIT 1`, ErrUnsupportedShape},
		{"missing limit", `USE facts MATCH (a:Asset) RETURN a.asset_contract AS id`, ErrLimitRequired},
		{"limit too high", `USE facts MATCH (a:Asset) RETURN a.asset_contract AS id LIMIT 5000`, ErrLimitTooHigh},
		{"offset", `USE facts MATCH (a:Asset) RETURN a.asset_contract AS id SKIP 5 LIMIT 10`, ErrOffsetForbidden},
		{"with pipeline", `USE facts MATCH (a:Asset) WITH a RETURN a.asset_contract AS id LIMIT 1`, ErrUnsupportedShape},
		{"collect", `USE facts MATCH (a:Asset) RETURN collect(a.asset_contract) AS ids LIMIT 1`, ErrUnsupportedShape},
		{"avg still rejected", `USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) RETURN avg(t.amount_usd) AS a LIMIT 1`, ErrUnsupportedShape},
		{"sum star rejected", `USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) RETURN sum(*) AS a LIMIT 1`, ErrUnsupportedShape},
		{"sum bare variable rejected", `USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) RETURN sum(t) AS a LIMIT 1`, ErrUnsupportedShape},
		{"write", `USE facts MATCH (a:Address) DELETE a LIMIT 1`, ErrParse},
	}
	for _, tc := range cases {
		_, err := Compile(tc.q)
		if !errors.Is(err, tc.want) {
			t.Errorf("%s: got %v, want %v", tc.name, err, tc.want)
		}
	}
}

// The retired AddressFeature facts label and HAS_FEATURE edge
// (facts_address_features_view, dropped by migration 0033) are no longer
// mapped — a facts :AddressFeature / [:HAS_FEATURE] query fails at COMPILE
// time with the unknown-identifier error, mirroring the production mapping.
func TestAddressFeatureRejectedAsUnmapped(t *testing.T) {
	cases := []struct {
		query   string
		wantErr string
	}{
		{`USE facts MATCH (f:AddressFeature) RETURN f.feature_scope AS feature_scope LIMIT 10`, `node label "AddressFeature" is not mapped`},
		{`USE facts MATCH (a:Address)-[:HAS_FEATURE]->(f:AddressFeature) RETURN f.net_flow_usd AS net_flow_usd LIMIT 10`, `relationship type "HAS_FEATURE" is not mapped`},
		{`USE facts MATCH (a:Address)-[:HAS_FEATURE]->(f) RETURN f.feature_scope AS feature_scope LIMIT 10`, `relationship type "HAS_FEATURE" is not mapped`},
	}
	for _, c := range cases {
		_, err := Compile(c.query)
		if err == nil {
			t.Errorf("expected unmapped rejection for: %s", c.query)
			continue
		}
		if !strings.Contains(err.Error(), c.wantErr) {
			t.Errorf("error %q does not contain %q for query: %s", err.Error(), c.wantErr, c.query)
		}
	}
}

// CompileWithWindow appends the recency-window floor: on an address-kind
// query (no caller date bound) the compiled SQL gains one bare
// `block_date >= ?` conjunct with the window date as the trailing arg. The
// column comes from the edge mapping's partition metadata, never hardcoded.
func TestCompileWithWindowInjectsWindowForAddressKind(t *testing.T) {
	q := `USE facts MATCH (from:Address {address: "5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuyUpnhM"})-[t:TRANSFER]->(to:Address) RETURN to.address AS to_address, t.amount_usd AS amount_usd LIMIT 10`
	window := "2026-05-30"
	c, err := CompileWithWindow(q, window)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(c.SQL, "`block_date` >= ?") {
		t.Errorf("compiled SQL lacks the bare block_date floor: %s", c.SQL)
	}
	// the window arg is appended AFTER the caller's address arg
	wantArgs := []any{"5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuyUpnhM", window}
	if len(c.Args) != len(wantArgs) {
		t.Fatalf("args = %v, want %v", c.Args, wantArgs)
	}
	for i := range wantArgs {
		if c.Args[i] != wantArgs[i] {
			t.Fatalf("args = %v, want %v", c.Args, wantArgs)
		}
	}
	// the floor is a bare partition-column conjunct: no function wrapping
	if strings.Contains(c.SQL, "DATE(") || strings.Contains(c.SQL, "date_trunc") {
		t.Errorf("window floor wraps the partition column: %s", c.SQL)
	}
}

// A caller-written block_date bound wins: CompileWithWindow adds NO second
// bound when the query already bounds block_date (lifetime reads stay
// lifetime; caller bounds pass through untouched).
func TestCompileWithWindowCallerBoundWins(t *testing.T) {
	q := `USE facts MATCH (from:Address {address: "5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuyUpnhM"})-[t:TRANSFER]->(to:Address) WHERE t.block_date >= '2026-06-01' RETURN t.tx_id AS tx_id LIMIT 10`
	c, err := CompileWithWindow(q, "2026-05-30")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(c.SQL, "`block_date` >= ?") {
		t.Fatalf("caller's block_date bound missing: %s", c.SQL)
	}
	if got := strings.Count(c.SQL, "`block_date`"); got != 1 {
		t.Errorf("block_date appears %d times (expected exactly the caller's bound): %s", got, c.SQL)
	}
	wantArgs := []any{"5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuyUpnhM", "2026-06-01"}
	if len(c.Args) != len(wantArgs) {
		t.Fatalf("args = %v, want %v (no injected window arg)", c.Args, wantArgs)
	}
	for i := range wantArgs {
		if c.Args[i] != wantArgs[i] {
			t.Fatalf("args = %v, want %v", c.Args, wantArgs)
		}
	}
}

// CompileWithWindow with an empty window is exactly Compile (the golden
// path — zero-window callers and the plain Compile entry point).
func TestCompileWithWindowEmptyWindowMatchesCompile(t *testing.T) {
	q := `USE facts MATCH (from:Address {address: "5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuyUpnhM"})-[t:TRANSFER]->(to:Address) RETURN t.tx_id AS tx_id LIMIT 10`
	plain, err := Compile(q)
	if err != nil {
		t.Fatal(err)
	}
	withWindow, err := CompileWithWindow(q, "")
	if err != nil {
		t.Fatal(err)
	}
	if plain.SQL != withWindow.SQL {
		t.Errorf("CompileWithWindow(q, \"\") SQL differs from Compile:\n  %s\n  %s", plain.SQL, withWindow.SQL)
	}
	if len(plain.Args) != len(withWindow.Args) {
		t.Errorf("CompileWithWindow(q, \"\") args differ from Compile: %v vs %v", plain.Args, withWindow.Args)
	}
}

// CompileWithWindow on a shape without a partition column (a standalone
// Asset node, which is not date-partitioned) compiles unchanged — there is
// nothing to inject.
func TestCompileWithWindowNoPartitionColumnCompilesUnchanged(t *testing.T) {
	q := `USE facts MATCH (a:Asset) WHERE a.asset_symbol = "TAO" RETURN a.asset_contract AS asset_contract LIMIT 10`
	c, err := CompileWithWindow(q, "2026-05-30")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(c.SQL, "block_date") {
		t.Errorf("no partition column — window must not be injected: %s", c.SQL)
	}
}

// The partition metadata in mapping.json pins the TRANSFER edge's partition
// column/granularity — the compiler's window floor must use it.
func TestTransferEdgePartitionMetadata(t *testing.T) {
	em, err := mapping.resolveEdge("TRANSFER", 0)
	if err != nil {
		t.Fatal(err)
	}
	if em.PartitionColumn != "block_date" {
		t.Errorf("TRANSFER partition_column = %q, want block_date", em.PartitionColumn)
	}
	if em.PartitionGranularity != "day" {
		t.Errorf("TRANSFER partition_granularity = %q, want day", em.PartitionGranularity)
	}
	nm, err := mapping.resolveNode("Address", 0)
	if err != nil {
		t.Fatal(err)
	}
	if !nm.EndpointOnly {
		t.Error("Address node mapping must be endpoint_only (facts = transfers only)")
	}
}

func escapeForCypher(s string) string {
	return strings.ReplaceAll(s, `"`, `\"`)
}
