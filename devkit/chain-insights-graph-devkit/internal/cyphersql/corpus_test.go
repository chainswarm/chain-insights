package cyphersql

import (
	"encoding/json"
	"errors"
	"os"
	"testing"
)

// corpusGoldens is the archive/facts result-baseline fixture recorded from
// the pre-removal MemGQL devkit (chain-insights
// tests/fixtures/archive-result-goldens.json, copied here). Each entry's
// baseline field partitions the conformance contract:
//   - "memgql":      MemGQL's translation was correct; our translator must
//                    compile it AND (under -tags starrocks_it) reproduce the
//                    rows.
//   - "unsupported": a documented shape outside the compiled archive subset;
//                    our translator must return ErrUnsupportedShape.
type corpusGoldens struct {
	Entries []struct {
		ID           string           `json:"id"`
		Layer        string           `json:"layer"`
		Query        string           `json:"query"`
		Baseline     string           `json:"baseline"`
		ExpectedRows []map[string]any `json:"expected_rows"`
	} `json:"entries"`
}

func loadGoldens(t *testing.T) corpusGoldens {
	t.Helper()
	raw, err := os.ReadFile("testdata/archive-goldens.json")
	if err != nil {
		t.Fatalf("read goldens: %v", err)
	}
	var g corpusGoldens
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatalf("parse goldens: %v", err)
	}
	if len(g.Entries) == 0 {
		t.Fatal("empty goldens")
	}
	return g
}

// TestCorpusCompileConformance: every trusted archive/facts recipe compiles
// to SQL; every documented-unsupported recipe returns ErrUnsupportedShape.
// No StarRocks required — pure compile contract, safe for CI.
func TestCorpusCompileConformance(t *testing.T) {
	g := loadGoldens(t)
	compiled, rejected := 0, 0
	for _, e := range g.Entries {
		c, err := Compile(e.Query)
		switch e.Baseline {
		case "memgql":
			if err != nil {
				t.Errorf("%s: expected compile, got %v\n  query: %s", e.ID, err, e.Query)
				continue
			}
			if c.SQL == "" {
				t.Errorf("%s: empty SQL", e.ID)
			}
			// every value must be a bound arg — the SQL must not contain
			// the raw identity literal from the query.
			for _, arg := range c.Args {
				if s, ok := arg.(string); ok && len(s) > 8 && contains(c.SQL, s) {
					t.Errorf("%s: literal %q leaked into SQL (must be bound)", e.ID, s)
				}
			}
			compiled++
		case "unsupported":
			if !errors.Is(err, ErrUnsupportedShape) && !errors.Is(err, ErrCostBound) {
				t.Errorf("%s: expected ErrUnsupportedShape/ErrCostBound, got %v", e.ID, err)
			}
			rejected++
		}
	}
	t.Logf("compile conformance: %d compiled, %d correctly rejected", compiled, rejected)
	if compiled == 0 {
		t.Fatal("no recipes compiled — fixture or translator broken")
	}
}

func contains(haystack, needle string) bool {
	return len(needle) > 0 && len(haystack) >= len(needle) && indexOf(haystack, needle) >= 0
}

func indexOf(h, n string) int {
	for i := 0; i+len(n) <= len(h); i++ {
		if h[i:i+len(n)] == n {
			return i
		}
	}
	return -1
}
