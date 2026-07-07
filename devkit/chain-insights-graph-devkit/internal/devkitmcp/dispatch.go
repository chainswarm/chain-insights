package devkitmcp

import (
	"context"
	"strings"
)

// DispatchRunner routes a query to the backend that owns its topology layer,
// mirroring the production graphrag-mcp split after the MemGQL retirement:
// live_topology → Memgraph (native Cypher, USE prefix stripped at
// execution); archive_topology / facts → StarRocks via the translator.
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
	// live (or unknown): strip the USE prefix so Memgraph accepts native Cypher.
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
