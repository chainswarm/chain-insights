package devkitmcp

import (
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// TraversalBounds caps the native topology read surface. Direct Memgraph
// unlocks BFS/DFS/WSHORTEST/ALLSHORTEST/KSHORTEST and variable-length paths;
// these bounds keep an admitted query from turning into an unbounded graph
// walk. The devkit mirrors the production graphrag-mcp bounds exactly so a
// query a developer proves bounded here is accepted in production too.
type TraversalBounds struct {
	MaxDepth  int
	MaxK      int
	MaxUnwind int
}

// defaultTraversalBounds mirrors the production defaults (MaxDepth 5, MaxK 16,
// MaxUnwind 1000) and honours the same MCP_MAX_* env overrides so bound tuning
// is identical to the production backend.
func defaultTraversalBounds() TraversalBounds {
	return TraversalBounds{
		MaxDepth:  envIntBound("MCP_MAX_TRAVERSAL_DEPTH", 5),
		MaxK:      envIntBound("MCP_MAX_SHORTEST_K", 16),
		MaxUnwind: envIntBound("MCP_MAX_UNWIND_ITEMS", 1000),
	}
}

func envIntBound(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return fallback
}

// queryTargetsTopology reports whether the query is an explicit
// `USE topology` read, mirroring production's graph-scope gate: traversal
// bounds run only for explicit topology reads (native Memgraph), never for
// facts (which takes the translator) or no-prefix queries.
func queryTargetsTopology(query string) bool {
	fields := strings.Fields(strings.TrimSpace(query))
	if len(fields) < 2 || !strings.EqualFold(fields[0], "USE") {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(fields[1]), "topology")
}

// edgeBodyPattern captures the inside of any relationship whose body uses a
// variable-length / algorithm marker '*': [ ... * ... ].
var edgeBodyPattern = regexp.MustCompile(`\[[^\]]*\*[^\]]*\]`)

// hopRangePattern extracts an a..b, ..b, or a.. range: group1=a, group2=b.
var hopRangePattern = regexp.MustCompile(`(\d*)\.\.(\d*)`)

// kshortestKPattern extracts the k in *KSHORTEST|k.
var kshortestKPattern = regexp.MustCompile(`(?i)KSHORTEST\s*\|\s*(\d+)`)

// standaloneLimitPattern extracts a bare hop/path limit like "*BFS 5" or
// "*WSHORTEST 5" — a single number after the marker keyword.
var standaloneLimitPattern = regexp.MustCompile(`(?i)\*\s*(?:BFS|DFS|WSHORTEST|ALLSHORTEST|KSHORTEST)?\s*(\d+)`)

// unwindListPattern captures the literal list of an UNWIND [ ... ] AS clause.
var unwindListPattern = regexp.MustCompile(`(?is)\bUNWIND\s*\[([^\]]*)\]`)

// ValidateLiveTraversalBounds enforces TraversalBounds on a query already
// admitted as read-only. It runs ONLY for topology reads (native Memgraph);
// facts goes through the corpus-scoped translator instead. Returns an
// error naming the exact violated bound.
func ValidateLiveTraversalBounds(query string, b TraversalBounds) error {
	for _, body := range edgeBodyPattern.FindAllString(query, -1) {
		if err := validateEdgeBound(body, b); err != nil {
			return err
		}
	}
	if err := validateUnwindBound(query, b); err != nil {
		return err
	}
	return nil
}

func validateEdgeBound(body string, b TraversalBounds) error {
	// KSHORTEST|k is bounded by its path count k, not a hop range.
	if m := kshortestKPattern.FindStringSubmatch(body); m != nil {
		k, _ := strconv.Atoi(m[1])
		if k > b.MaxK {
			return fmt.Errorf("KSHORTEST k=%d exceeds the maximum of %d", k, b.MaxK)
		}
		return nil
	}
	upper, hasUpper := extractUpperHop(body)
	if !hasUpper {
		return fmt.Errorf("unbounded traversal %s is not permitted: add an explicit upper hop bound (e.g. *1..%d, *BFS 1..%d)", strings.TrimSpace(body), b.MaxDepth, b.MaxDepth)
	}
	if upper > b.MaxDepth {
		return fmt.Errorf("traversal depth %d exceeds the maximum of %d", upper, b.MaxDepth)
	}
	return nil
}

// extractUpperHop finds the effective upper hop bound of an edge body:
// from an a..b / ..b range, or a standalone numeric limit after the marker.
// Returns (bound, true) when an explicit upper bound exists.
func extractUpperHop(body string) (int, bool) {
	if m := hopRangePattern.FindStringSubmatch(body); m != nil {
		if m[2] != "" {
			n, _ := strconv.Atoi(m[2])
			return n, true
		}
		// a.. with no upper bound is unbounded
		return 0, false
	}
	if m := standaloneLimitPattern.FindStringSubmatch(body); m != nil && m[1] != "" {
		n, _ := strconv.Atoi(m[1])
		return n, true
	}
	// bare '*', '*BFS', '*WSHORTEST (r,n|w)' with no numeric bound → unbounded
	return 0, false
}

func validateUnwindBound(query string, b TraversalBounds) error {
	for _, m := range unwindListPattern.FindAllStringSubmatch(query, -1) {
		items := strings.Count(m[1], ",") + 1
		if strings.TrimSpace(m[1]) == "" {
			items = 0
		}
		if items > b.MaxUnwind {
			return fmt.Errorf("UNWIND list of %d items exceeds the maximum of %d", items, b.MaxUnwind)
		}
	}
	return nil
}
