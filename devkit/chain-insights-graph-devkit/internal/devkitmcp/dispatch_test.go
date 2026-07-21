package devkitmcp

import (
	"context"
	"testing"
)

type recordingRunner struct {
	lastQuery string
	rows      []map[string]any
}

func (r *recordingRunner) Run(_ context.Context, _ string, query string) (QueryResult, error) {
	r.lastQuery = query
	return QueryResult{Rows: r.rows}, nil
}

func TestDispatchRoutesByScope(t *testing.T) {
	live := &recordingRunner{rows: []map[string]any{{"live": true}}}
	archive := &recordingRunner{rows: []map[string]any{{"archive": true}}}
	d := NewDispatchRunner(live, archive)

	// topology → Memgraph (live) runner, USE prefix stripped for native Cypher.
	_, _ = d.Run(context.Background(), "bittensor", `USE topology MATCH (n:Address) RETURN n.address LIMIT 1`)
	if live.lastQuery != `MATCH (n:Address) RETURN n.address LIMIT 1` {
		t.Errorf("topology runner got %q (USE prefix not stripped)", live.lastQuery)
	}

	// facts → StarRocks (archive) translator runner, query passed through
	// (the translator consumes the USE facts prefix itself).
	archive.lastQuery = ""
	_, _ = d.Run(context.Background(), "bittensor", `USE facts MATCH (a:Address)-[:HAS_FEATURE]->(f:AddressFeature) RETURN f.tx_out_count LIMIT 5`)
	if archive.lastQuery == "" {
		t.Error("facts query was not routed to the StarRocks translator runner")
	}

	// unknown/no scope defaults to the Memgraph (topology) runner (fail-open
	// until the T10 strict invalid_scope cutover), never the translator.
	live.lastQuery = ""
	archive.lastQuery = ""
	_, _ = d.Run(context.Background(), "bittensor", `MATCH (n:Address) RETURN n.address LIMIT 1`)
	if live.lastQuery == "" || archive.lastQuery != "" {
		t.Errorf("no-scope query mis-routed: live=%q archive=%q", live.lastQuery, archive.lastQuery)
	}
}

func TestStripUsePrefix(t *testing.T) {
	got := stripUsePrefix(`USE topology MATCH (n) RETURN n LIMIT 1`)
	if got != `MATCH (n) RETURN n LIMIT 1` {
		t.Errorf("stripUsePrefix = %q", got)
	}
	if stripUsePrefix(`MATCH (n) RETURN n LIMIT 1`) != `MATCH (n) RETURN n LIMIT 1` {
		t.Error("no-prefix query should be unchanged")
	}
}
