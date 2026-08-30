package devkitmcp

import (
	"fmt"
	"github.com/chainswarm/chain-insights/devkit/chain-insights-graph-devkit/internal/cypheradmit"
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

// edgeBodies returns every relationship body `[ ... ]` that carries a
// variable-length / algorithm marker '*', with NESTED brackets kept intact.
//
// This replaces a `\[[^\]]*\*[^\]]*\]` regex that stopped at the FIRST ']' and
// therefore truncated any body containing a nested list index — e.g. an
// algorithm lambda like `[:R *WSHORTEST (r,n | size(n.tags[0..2])) w]` was cut
// at the slice's bracket. The truncated fragment still held `0..2`, which the
// hop-range extractor then read as an upper bound of 2, so a genuinely
// depth-UNBOUNDED expansion was admitted (internal epic, not merely a missed optimization).
func edgeBodies(query string) []string {
	var bodies []string
	for i := 0; i < len(query); i++ {
		if query[i] != '[' {
			continue
		}
		depth := 0
		for j := i; j < len(query); j++ {
			switch query[j] {
			case '[':
				depth++
			case ']':
				depth--
			}
			if depth != 0 {
				continue
			}
			body := query[i : j+1]
			if strings.Contains(body, "*") {
				bodies = append(bodies, body)
			}
			i = j
			break
		}
	}
	return bodies
}

// hopBoundRegion returns the only part of an edge body that may legitimately
// carry a hop bound: from the '*' marker up to an algorithm lambda '(' , with
// any nested bracket content removed. Memgraph places the bound before the
// lambda (`*WSHORTEST 5 (e,n | e.weight) w`), so a `..` appearing inside the
// lambda or inside a list slice is data, never a traversal bound.
func hopBoundRegion(body string) string {
	star := strings.IndexByte(body, '*')
	if star < 0 {
		return ""
	}
	region := body[star:]
	if p := strings.IndexByte(region, '('); p >= 0 {
		region = region[:p]
	}
	var sb strings.Builder
	depth := 0
	for i := 0; i < len(region); i++ {
		switch region[i] {
		case '[':
			depth++
		case ']':
			if depth > 0 {
				depth--
			}
		default:
			if depth == 0 {
				sb.WriteByte(region[i])
			}
		}
	}
	return sb.String()
}

// hopRangePattern extracts an a..b, ..b, or a.. range: group1=a, group2=b.
// Digit-group separators are matched so `*1..1_000_000` cannot read as `1..1`
// (a bound of 1) while an engine honouring `_` walks a million hops.
var hopRangePattern = regexp.MustCompile(`([0-9_]*)\.\.([0-9_]*)`)

// parseHopNumber parses a hop bound, tolerating `_` digit grouping. An empty or
// unparseable value reports absent so the caller fails closed.
func parseHopNumber(raw string) (int, bool) {
	cleaned := strings.ReplaceAll(raw, "_", "")
	if cleaned == "" {
		return 0, false
	}
	n, err := strconv.Atoi(cleaned)
	if err != nil {
		return 0, false
	}
	return n, true
}

// kshortestKPattern extracts the k in *KSHORTEST|k.
var kshortestKPattern = regexp.MustCompile(`(?i)KSHORTEST\s*\|\s*(\d+)`)

// standaloneLimitPattern extracts a bare hop/path limit like "*BFS 5" or
// "*WSHORTEST 5" — a single number after the marker keyword.
var standaloneLimitPattern = regexp.MustCompile(`(?i)\*\s*(?:BFS|DFS|WSHORTEST|ALLSHORTEST|KSHORTEST)?\s*([0-9][0-9_]*)`)

// unwindListPattern captures the literal list of an UNWIND [ ... ] AS clause.
var unwindListPattern = regexp.MustCompile(`(?is)\bUNWIND\s*\[([^\]]*)\]`)

// ValidateLiveTraversalBounds enforces TraversalBounds on a query already
// admitted as read-only. It runs ONLY for topology reads (native Memgraph);
// facts goes through the corpus-scoped translator instead. Returns an
// error naming the exact violated bound.
func ValidateLiveTraversalBounds(query string, b TraversalBounds) error {
	// Scan with string literals and comments blanked out, exactly as
	// production does: a `..` inside a literal or a comment is NOT a hop
	// bound, but a raw scan read one and admitted an UNBOUNDED expansion.
	for _, body := range edgeBodies(cypheradmit.StripLiteralsAndComments(query)) {
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
	// Only the pre-lambda, bracket-free region can carry a bound; a `..` inside
	// an algorithm lambda or a list slice is data (internal epic).
	body = hopBoundRegion(body)
	if m := hopRangePattern.FindStringSubmatch(body); m != nil {
		if n, ok := parseHopNumber(m[2]); ok {
			return n, true
		}
		// a.. with no upper bound is unbounded
		return 0, false
	}
	if m := standaloneLimitPattern.FindStringSubmatch(body); m != nil {
		if n, ok := parseHopNumber(m[1]); ok {
			return n, true
		}
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
