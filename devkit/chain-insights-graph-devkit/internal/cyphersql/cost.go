package cyphersql

// applyCostBound rejects the one archive shape family that generates a
// prohibitively expensive StarRocks plan: a FLOWS_TO chain of >=3 hops
// where BOTH terminal nodes are free (no inline id anchor), i.e. a
// self-join over archive_topology_edges_view (1M+ rows) with no selective
// starting point. This is exactly the shape that OOMed the mcp_readonly_wg
// resource group under MemGQL (2026-07-01 archive-tier decision); we return
// ErrCostBound deterministically rather than let StarRocks OOM.
//
// A single bound end (source or target has an inline {id: ...} filter) makes
// the plan selective and is allowed — that is what every real trace builder
// emits (reverseDepositSourceQueryAtDepth anchors the deposit end, etc.).
func (s *emitState) applyCostBound() error {
	flowsHops := 0
	for _, e := range s.q.edges {
		if e.relType == "FLOWS_TO" {
			flowsHops++
		}
	}
	if flowsHops < 3 {
		return nil
	}
	if s.hasInlineIDAnchor(s.q.nodes[0]) || s.hasInlineIDAnchor(s.q.nodes[len(s.q.nodes)-1]) {
		return nil
	}
	return newErr(ErrCostBound, s.q.nodes[0].pos,
		"a %d-hop FLOWS_TO chain with no anchored endpoint would scan the full edge view; anchor the source or target with an inline {identity_id: ...} filter", flowsHops)
}

// hasInlineIDAnchor reports whether a node carries an inline filter on its
// mapped id property (a selective anchor).
func (s *emitState) hasInlineIDAnchor(n nodePattern) bool {
	if len(n.props) == 0 {
		return false
	}
	nm, ok := mapping.nodes[n.label]
	if !ok {
		return false
	}
	for _, f := range n.props {
		if col, ok := nm.Properties[f.key]; ok && col == nm.IDColumn {
			return true
		}
	}
	return false
}
