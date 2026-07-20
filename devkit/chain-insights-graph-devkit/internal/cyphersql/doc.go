// Package cyphersql (devkit lite backend, independent copy — parity-pinned
// to the production graphrag-mcp translator by shared conformance fixtures,
// NOT by shared source, per the devkit IP boundary) compiles the CORPUS-SCOPED
// subset of Cypher that the Chain Insights AML builders and documented recipes
// emit for the USE facts scope into parameterized StarRocks SQL (MySQL wire
// protocol). It exists because the Memgraph Zero / MemGQL federation layer was
// retired (see docs/architecture/decisions/2026-07-06-* and the retirement
// spec): the unified topology scope now runs directly against Memgraph (full
// native Cypher, unified recent+historical, handled elsewhere and NEVER
// compiled to SQL), while facts runs directly against StarRocks through this
// translator.
//
// Design (judge-panel, 2026-07-06): a hand-rolled recursive-descent parser
// → AST → shape-directed planner → parameterized SQL emitter. Zero new
// module dependencies. The accepted grammar is exactly the facts corpus; any
// shape outside it — including any non-facts scope such as `USE topology` —
// fails loud with a typed error, never a wrong or unsafe SQL string.
//
// # Safety invariants (all enforced, all tested)
//
//   - Facts-only: only `USE facts` compiles. `USE topology` (and any other
//     scope) returns ErrUnsupportedShape — topology is a native Memgraph
//     concern and never reaches SQL.
//   - Read-only: only MATCH ... [WHERE] ... RETURN [ORDER BY] [LIMIT]. No
//     writes, no CALL, no catalog/admin, no multi-statement.
//   - Injection-closed: every literal value is a bound `?` argument via
//     database/sql; identifiers (views, columns) come ONLY from the
//     embedded mapping resolver — never from user text.
//   - LIMIT required and capped at maxLimit (1000); OFFSET forbidden.
//   - Deterministic ordering: the mapped id column is appended as the final
//     ORDER BY tiebreaker so truncated result sets are stable.
//
// # Coverage table (grafted auditability — reject-by-default)
//
// Supported shape families (the ONLY things that compile):
//
//	single-node lookup      MATCH (n:Label {id: "x"}) RETURN n.p AS a ...
//	single-node scan+where  MATCH (n:Label) WHERE ... RETURN ... ORDER BY ... LIMIT k
//	node-edge-node (1 hop)  MATCH (a:L)-[r:REL]->(b:L) [WHERE ...] RETURN ...
//	fixed k-hop facts chain MATCH (a:Address)-[:HAS_*]->(n)-...-(t) [WHERE ...] RETURN ...
//	facts edge lookup       MATCH (a:Address)-[:HAS_*]->(f:Label) RETURN ...
//	count aggregate         MATCH (...) RETURN count(x) AS a LIMIT 1
//
// Explicitly NOT compiled here (→ ErrUnsupportedShape): topology-scope
// queries, money-flow FLOWS_TO traversal, variable-length / quantified
// paths, ANY/ALL/K/W-SHORTEST, BFS, collect(), WITH/UNWIND pipelines,
// OPTIONAL MATCH, procedures, writes. Those are either topology-only (native
// Memgraph) or deliberately out of the facts contract.
package cyphersql
