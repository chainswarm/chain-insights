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

func TestDispatchRoutesByLayer(t *testing.T) {
	live := &recordingRunner{rows: []map[string]any{{"live": true}}}
	archive := &recordingRunner{rows: []map[string]any{{"archive": true}}}
	d := NewDispatchRunner(live, archive)

	// live_topology → live runner, USE prefix stripped
	_, _ = d.Run(context.Background(), "bittensor", `USE live_topology MATCH (n:Identity) RETURN n.identity_id LIMIT 1`)
	if live.lastQuery != `MATCH (n:Identity) RETURN n.identity_id LIMIT 1` {
		t.Errorf("live runner got %q (USE prefix not stripped)", live.lastQuery)
	}

	// archive_topology → archive runner, query passed through (translator strips)
	_, _ = d.Run(context.Background(), "bittensor", `USE archive_topology MATCH (a:Identity {identity_id:"x"})-[f:FLOWS_TO]->(b:Identity) RETURN b.identity_id LIMIT 5`)
	if archive.lastQuery == "" {
		t.Error("archive runner not invoked for archive_topology query")
	}

	// facts → archive (StarRocks) runner
	_, _ = d.Run(context.Background(), "bittensor", `USE facts MATCH (i:Identity)-[:HAS_LABEL]->(l:AddressLabel) RETURN l.label LIMIT 5`)
	if archive.lastQuery == "" {
		t.Error("archive runner not invoked for facts query")
	}
}

func TestStripUsePrefix(t *testing.T) {
	got := stripUsePrefix(`USE live_topology MATCH (n) RETURN n LIMIT 1`)
	if got != `MATCH (n) RETURN n LIMIT 1` {
		t.Errorf("stripUsePrefix = %q", got)
	}
	if stripUsePrefix(`MATCH (n) RETURN n LIMIT 1`) != `MATCH (n) RETURN n LIMIT 1` {
		t.Error("no-prefix query should be unchanged")
	}
}
