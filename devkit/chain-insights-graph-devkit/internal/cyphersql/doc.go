// Package cyphersql (devkit lite backend, independent copy — parity-pinned
// to the production graphrag-mcp translator by shared conformance fixtures,
// NOT by shared source, per the devkit IP boundary) compiles the CORPUS-SCOPED subset of Cypher that the
// Chain Insights AML builders and documented recipes emit for the
// USE archive_topology / USE facts layers into parameterized StarRocks SQL
// (MySQL wire protocol). It exists because the Memgraph Zero / MemGQL
// federation layer was retired (see
// docs/architecture/decisions/2026-07-06-* and the retirement spec): live
// topology now runs directly against Memgraph (full native Cypher, handled
// elsewhere), while archive/facts run directly against StarRocks through
// this translator.
//
// Design (judge-panel, 2026-07-06): a hand-rolled recursive-descent parser
// → AST → shape-directed planner → parameterized SQL emitter. Zero new
// module dependencies. The accepted grammar is exactly the corpus; any
// shape outside it fails loud with a typed error, never a wrong or unsafe
// SQL string.
//
// # Safety invariants (all enforced, all tested)
//
//   - Read-only: only MATCH ... [WHERE] ... RETURN [ORDER BY] [LIMIT]. No
//     writes, no CALL, no catalog/admin, no multi-statement.
//   - Injection-closed: every literal value is a bound `?` argument via
//     database/sql; identifiers (views, columns) come ONLY from the
//     embedded mapping resolver — never from user text.
//   - LIMIT required and capped at maxLimit (1000); OFFSET forbidden.
//   - Deterministic ordering: the mapped id column is appended as the final
//     ORDER BY tiebreaker so truncated result sets are stable.
//   - Cost bound: a k>=3 FLOWS_TO chain with a free (unbound) end returns
//     ErrCostBound rather than a full-view self-join that OOMs the
//     StarRocks mcp_readonly_wg resource group.
//
// # Coverage table (grafted auditability — reject-by-default)
//
// Supported shape families (the ONLY things that compile):
//
//	single-node lookup      MATCH (n:Label {id: "x"}) RETURN n.p AS a ...
//	single-node scan+where  MATCH (n:Label) WHERE ... RETURN ... ORDER BY ... LIMIT k
//	node-edge-node (1 hop)  MATCH (a:L)-[r:REL]->(b:L) [WHERE ...] RETURN ...
//	fixed k-hop FLOWS_TO    MATCH (a)-[r1:FLOWS_TO]->(n1)-...-(t) [WHERE ...] RETURN ...
//	facts edge lookup       MATCH (i:Identity)-[:HAS_*]->(f:Label) RETURN ...
//	count aggregate         MATCH (...) RETURN count(x) AS a LIMIT 1
//
// Explicitly NOT compiled here (→ ErrUnsupportedShape): live_topology
// queries, variable-length / quantified paths, ANY/ALL/K/W-SHORTEST, BFS,
// collect(), WITH/UNWIND pipelines, OPTIONAL MATCH, procedures, writes.
// Those are either live-only (native Memgraph) or deliberately out of the
// archive contract.
package cyphersql
