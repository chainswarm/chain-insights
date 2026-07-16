package devkitmcp

import (
	"context"
	"strings"
)

// DispatchRunner routes a query to the backend that owns its scope, mirroring
// the production graphrag-mcp two-scope model: `USE topology` → Memgraph
// (native Cypher, unified recent+historical, USE prefix stripped at
// execution); `USE facts` → StarRocks via the corpus-scoped translator.
//
// The struct field names (`live`, `archive`) are historical: `live` is the
// Memgraph runner that now serves the whole topology scope, and `archive` is
// the StarRocks translator runner that now serves only facts.
type DispatchRunner struct {
	live    QueryRunner
	archive QueryRunner
}

func NewDispatchRunner(live, archive QueryRunner) *DispatchRunner {
	return &DispatchRunner{live: live, archive: archive}
}

func (d *DispatchRunner) Run(ctx context.Context, network, query string) (QueryResult, error) {
	tier, _ := ClassifyQueryTier(query)
	if tier == starrocksTierName {
		return d.archive.Run(ctx, network, query)
	}
	// topology (or unknown): strip the USE prefix so Memgraph accepts native
	// Cypher.
	return d.live.Run(ctx, network, stripUsePrefix(query))
}

// stripUsePrefix removes a single leading "USE <layer>" clause.
func stripUsePrefix(query string) string {
	trimmed := strings.TrimLeft(query, " \t\n\r")
	fields := strings.Fields(trimmed)
	if len(fields) >= 2 && strings.EqualFold(fields[0], "USE") {
		if idx := strings.Index(strings.ToUpper(trimmed), strings.ToUpper(fields[1])); idx >= 0 {
			return strings.TrimLeft(trimmed[idx+len(fields[1]):], " \t\n\r")
		}
	}
	return query
}
