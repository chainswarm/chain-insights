package devkitmcp

import (
	"strings"
	"testing"
	"time"
)

// The facts recency window mirrors the production config key
// (FACTS_RECENCY_WINDOW_DAYS, default 90): address-kind facts queries get a
// block_date floor of now - window days (spec S6).
func TestConfigFactsRecencyWindowDefault(t *testing.T) {
	t.Setenv("FACTS_RECENCY_WINDOW_DAYS", "")
	cfg := ConfigFromEnvironment()
	if cfg.FactsRecencyWindowDays != 90 {
		t.Fatalf("FactsRecencyWindowDays = %d, want 90", cfg.FactsRecencyWindowDays)
	}
}

func TestConfigFactsRecencyWindowEnvOverride(t *testing.T) {
	t.Setenv("FACTS_RECENCY_WINDOW_DAYS", "30")
	cfg := ConfigFromEnvironment()
	if cfg.FactsRecencyWindowDays != 30 {
		t.Fatalf("FactsRecencyWindowDays = %d, want 30", cfg.FactsRecencyWindowDays)
	}
}

func TestConfigFactsRecencyWindowNonNumericFallsBack(t *testing.T) {
	t.Setenv("FACTS_RECENCY_WINDOW_DAYS", "soon")
	cfg := ConfigFromEnvironment()
	if cfg.FactsRecencyWindowDays != 90 {
		t.Fatalf("FactsRecencyWindowDays = %d, want 90 (non-numeric falls back)", cfg.FactsRecencyWindowDays)
	}
}

// A zero/negative window is a misconfiguration and must fail at startup
// (NewStarRocksRunner), never silently disable the partition floor.
func TestStarRocksRunnerRejectsNonPositiveWindow(t *testing.T) {
	for _, days := range []int{0, -1, -90} {
		cfg := Config{StarRocksHost: "localhost", StarRocksPort: 9030, StarRocksUser: "root", StarRocksDatabase: "bittensor", FactsRecencyWindowDays: days}
		if _, err := NewStarRocksRunner(cfg); err == nil {
			t.Errorf("FactsRecencyWindowDays = %d: expected startup rejection", days)
		}
	}
}

// The window start is computed in Go, truncated to the day, minus the window
// (spec D2: bounds are computed in the caller, never in SQL).
func TestRecencyWindowStartFor(t *testing.T) {
	now := time.Date(2026, 8, 28, 15, 4, 5, 0, time.UTC)
	if got := recencyWindowStartFor(now, 90); got != "2026-05-30" {
		t.Fatalf("recencyWindowStartFor = %q, want 2026-05-30", got)
	}
	if got := recencyWindowStartFor(now, 1); got != "2026-08-27" {
		t.Fatalf("recencyWindowStartFor(1) = %q, want 2026-08-27", got)
	}
	if got := recencyWindowStartFor(now, 0); got != "2026-08-28" {
		t.Fatalf("recencyWindowStartFor(0) = %q, want 2026-08-28", got)
	}
}

// StarRocksRunner fails closed before any database access when the query has
// no admitted predicate kind: the remedy error names the missing predicate.
// (A nil db is safe here because the kind gate and compile run first.)
func TestStarRocksRunnerFailsClosedOnNoneKind(t *testing.T) {
	r := &StarRocksRunner{}
	_, err := r.Run(t.Context(), "bittensor", `USE facts MATCH (from:Address)-[t:TRANSFER]->(to:Address) WHERE t.block_height >= 100 AND t.block_height <= 200 RETURN t.tx_id AS tx_id LIMIT 10`)
	if err == nil {
		t.Fatal("expected the height-only query to fail closed")
	}
	if !strings.Contains(err.Error(), "add a bare block_date bound") {
		t.Fatalf("error does not carry the remedy: %v", err)
	}
}

// The address-kind window floor reaches the compiled SQL: an address-only
// query compiled through the runner's path carries the bare block_date bound
// and the window arg. Compilation is exercised here (no db needed for the
// decision); execution against the warehouse is the devkit smoke lane.
func TestStarRocksRunnerCompilesAddressKindWithWindow(t *testing.T) {
	r := &StarRocksRunner{factsWindowStart: "2026-05-30"}
	compiled, err := r.compileForKind(`USE facts MATCH (from:Address {address: "5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuyUpnhM"})-[t:TRANSFER]->(to:Address) RETURN t.tx_id AS tx_id LIMIT 10`)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(compiled.SQL, "`block_date` >= ?") {
		t.Fatalf("compiled SQL lacks the window floor: %s", compiled.SQL)
	}
	if len(compiled.Args) != 2 || compiled.Args[1] != "2026-05-30" {
		t.Fatalf("args = %v, want [address, 2026-05-30]", compiled.Args)
	}
}
