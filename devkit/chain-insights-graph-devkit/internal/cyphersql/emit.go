package cyphersql

import (
	"fmt"
	"strings"
)

// Compiled is the result of translating one facts Cypher query.
type Compiled struct {
	SQL     string
	Args    []any
	Scope   string // facts
	Columns []string
}

// Compile translates a USE facts Cypher query into parameterized StarRocks
// SQL. All literal values become Args (bound via database/sql); identifiers
// come only from the mapping. Returns a typed error (errors.Is-friendly) for
// any shape outside the compiled subset.
func Compile(query string) (*Compiled, error) {
	q, err := parse(query)
	if err != nil {
		return nil, err
	}
	return emit(q)
}

// CompileWithWindow compiles like Compile and additionally appends a bare
// `partition_column >= ?` conjunct — the recency-window floor — when the
// query does not already bound the partition column. The column and its arg
// come from the edge mapping's partition metadata; the caller computes the
// window start (spec D2: bounds are computed in the caller, never
// DATE_SUB(...) in SQL). A caller-written block_date bound wins: it gets no
// second bound. The empty window compiles exactly like Compile.
func CompileWithWindow(query, windowStartDate string) (*Compiled, error) {
	q, err := parse(query)
	if err != nil {
		return nil, err
	}
	return emitWithWindow(q, windowStartDate)
}

// emitState threads the SQL build: node identity expressions, joined views,
// and bound args.
type emitState struct {
	q           *query
	nodeIDExpr  map[string]string // node var -> SQL expr yielding its join-key value
	nodeIDCol   map[string]string // node var -> the node-view COLUMN that expr represents
	nodeIDPos   map[string]int
	edgeAlias   map[string]string // edge var -> SQL alias
	joinedNode  map[string]string // node var -> joined node-view alias (when needed)
	nodeLabel   map[string]string // node var -> label
	from        []string
	joins       []string
	where       []string
	args        []any
	selectExprs []string
	aliasSeq    int
}

func emit(q *query) (*Compiled, error) {
	return emitWithWindow(q, "")
}

func emitWithWindow(q *query, windowStart string) (*Compiled, error) {
	s := &emitState{
		q:          q,
		nodeIDExpr: map[string]string{},
		nodeIDCol:  map[string]string{},
		nodeIDPos:  map[string]int{},
		edgeAlias:  map[string]string{},
		joinedNode: map[string]string{},
		nodeLabel:  map[string]string{},
	}
	// Reject implicit GROUP BY: mixing count()/sum() with a non-aggregate
	// projection needs GROUP BY semantics, which are out of facts scope.
	countItems, propItems := 0, 0
	for _, it := range q.items {
		if it.count != nil || it.sum != nil {
			countItems++
		} else {
			propItems++
		}
	}
	if countItems > 0 && propItems > 0 {
		return nil, newErr(ErrUnsupportedShape, q.items[0].pos, "grouped aggregation (count() with a grouping key) is not supported on facts; %s", supportedPatterns)
	}
	if err := s.planPattern(); err != nil {
		return nil, err
	}
	if err := s.applyInlineFilters(); err != nil {
		return nil, err
	}
	if q.where != nil {
		clause, err := s.emitBool(q.where)
		if err != nil {
			return nil, err
		}
		s.where = append(s.where, clause)
	}
	// Recency-window injection (spec D2): on an address-kind admission the
	// compiler appends one bare partition-column floor. The column comes from
	// the edge mapping's partition metadata — never a hardcoded string — and
	// the bound is skipped when the caller already bounds the partition
	// column (caller wins; lifetime reads stay lifetime).
	if windowStart != "" {
		if err := s.applyWindowFloor(windowStart); err != nil {
			return nil, err
		}
	}
	sel, cols, err := s.emitSelect()
	if err != nil {
		return nil, err
	}
	orderBy, err := s.emitOrderBy()
	if err != nil {
		return nil, err
	}

	var sb strings.Builder
	sb.WriteString("SELECT ")
	if q.distinct {
		sb.WriteString("DISTINCT ")
	}
	sb.WriteString(sel)
	sb.WriteString(" FROM ")
	sb.WriteString(strings.Join(s.from, " "))
	for _, j := range s.joins {
		sb.WriteString(" ")
		sb.WriteString(j)
	}
	if len(s.where) > 0 {
		sb.WriteString(" WHERE ")
		sb.WriteString(strings.Join(s.where, " AND "))
	}
	if orderBy != "" {
		sb.WriteString(" ORDER BY ")
		sb.WriteString(orderBy)
	}
	fmt.Fprintf(&sb, " LIMIT %d", q.limit)

	return &Compiled{SQL: sb.String(), Args: s.args, Scope: q.scope, Columns: cols}, nil
}

// applyWindowFloor appends the recency-window floor conjunct for the first
// edge that carries partition metadata, unless the query already bounds the
// partition column itself. A query without an edge (a standalone node has no
// partition column on facts) compiles unchanged.
func (s *emitState) applyWindowFloor(windowStart string) error {
	if len(s.q.edges) == 0 {
		return nil
	}
	em, err := mapping.resolveEdge(s.q.edges[0].relType, s.q.edges[0].pos)
	if err != nil {
		return err
	}
	if em.PartitionColumn == "" {
		return nil
	}
	if s.boundsPartitionColumn(s.q.edges[0].variable, em.PartitionColumn) {
		return nil // caller bound wins
	}
	alias := s.edgeAlias[s.q.edges[0].variable]
	s.where = append(s.where, fmt.Sprintf("`%s`.`%s` >= ?", alias, em.PartitionColumn))
	s.args = append(s.args, windowStart)
	return nil
}

// boundsPartitionColumn reports whether the WHERE tree already carries a
// comparison on the edge variable's partition column. Any comparison is a
// bound — the caller asked for that range, and the injected floor would
// narrow lifetime reads the caller explicitly requested.
func (s *emitState) boundsPartitionColumn(edgeVariable, partitionColumn string) bool {
	if edgeVariable == "" || s.q.where == nil {
		return false
	}
	var walk func(e boolExpr) bool
	walk = func(e boolExpr) bool {
		switch v := e.(type) {
		case andExpr:
			return walk(v.left) || walk(v.right)
		case orExpr:
			return walk(v.left) || walk(v.right)
		case comparison:
			return v.left.variable == edgeVariable &&
				strings.EqualFold(v.left.property, partitionColumn)
		}
		return false
	}
	return walk(s.q.where)
}

// planPattern establishes the FROM/JOIN backbone and each node's identity
// expression. Single node: FROM its view. Edge chain: FROM the edge views,
// joined on shared node ids; node identity comes from edge source/target
// columns (no node-view join unless a non-id property is used).
func (s *emitState) planPattern() error {
	if len(s.q.edges) == 0 {
		n := s.q.nodes[0]
		nm, err := mapping.resolveNode(n.label, n.pos)
		if err != nil {
			return err
		}
		// EndpointOnly labels (Address on facts) are served only as
		// relationship endpoints — a standalone single-node MATCH refuses
		// exactly as production does (prod emit.go:127-130).
		if nm.EndpointOnly {
			return newErr(ErrUnsupportedShape, n.pos,
				"label %q is served only as a relationship endpoint in the facts tier (facts = transfers only); match it through a TRANSFER pattern, or query the node on USE topology", n.label)
		}
		alias := s.newAlias("n")
		s.from = append(s.from, fmt.Sprintf("`%s` AS `%s`", nm.Table, alias))
		s.joinedNode[n.variable] = alias
		s.nodeLabel[n.variable] = n.label
		s.nodeIDExpr[n.variable] = fmt.Sprintf("`%s`.`%s`", alias, nm.IDColumn)
		s.nodeIDCol[n.variable] = nm.IDColumn
		s.nodeIDPos[n.variable] = n.pos
		return nil
	}
	// Edge chain. Alias each edge view; wire node ids from edge columns.
	var prevTargetExpr string
	for idx, e := range s.q.edges {
		em, err := mapping.resolveEdge(e.relType, e.pos)
		if err != nil {
			return err
		}
		alias := s.newAlias("e")
		s.edgeAlias[e.variable] = alias
		src, tgt := em.SourceColumn, em.TargetColumn
		if e.reverse {
			src, tgt = tgt, src
		}
		srcExpr := fmt.Sprintf("`%s`.`%s`", alias, src)
		tgtExpr := fmt.Sprintf("`%s`.`%s`", alias, tgt)
		if idx == 0 {
			s.from = append(s.from, fmt.Sprintf("`%s` AS `%s`", em.Table, alias))
		} else {
			// chain: this edge's source id must equal previous edge's target id
			s.joins = append(s.joins, fmt.Sprintf("JOIN `%s` AS `%s` ON %s = %s", em.Table, alias, srcExpr, prevTargetExpr))
		}
		// Bind node identity expressions. The edge's source/target column is
		// the JOIN KEY, which corresponds to a specific node-view column
		// (its id column, per the mapping's source/target labels). Track
		// both the expr and which node column it represents, so projecting a
		// DIFFERENT node property joins the node view rather than mis-reading
		// the join key.
		srcNM, err := mapping.resolveNode(em.SourceLabel, e.pos)
		if err != nil {
			return err
		}
		tgtNM, err := mapping.resolveNode(em.TargetLabel, e.pos)
		if err != nil {
			return err
		}
		srcCol, tgtCol := srcNM.IDColumn, tgtNM.IDColumn
		if e.reverse {
			srcCol, tgtCol = tgtCol, srcCol
			srcNM, tgtNM = tgtNM, srcNM
		}
		srcNode := s.q.nodes[idx]
		tgtNode := s.q.nodes[idx+1]
		if srcNode.variable != "" {
			s.nodeIDExpr[srcNode.variable] = srcExpr
			s.nodeIDCol[srcNode.variable] = srcCol
			s.nodeIDPos[srcNode.variable] = srcNode.pos
			srcLabel, err := bindEndpointLabel(srcNode.label, srcNM.Label, srcNode.pos)
			if err != nil {
				return err
			}
			s.nodeLabel[srcNode.variable] = srcLabel
		}
		s.nodeIDExpr[tgtNode.variable] = tgtExpr
		s.nodeIDCol[tgtNode.variable] = tgtCol
		s.nodeIDPos[tgtNode.variable] = tgtNode.pos
		tgtLabel, err := bindEndpointLabel(tgtNode.label, tgtNM.Label, tgtNode.pos)
		if err != nil {
			return err
		}
		s.nodeLabel[tgtNode.variable] = tgtLabel
		prevTargetExpr = tgtExpr
	}
	return nil
}

// ensureNodeView joins a node's own view (aliased) so its non-id properties
// can be projected/filtered, keyed on the node's identity expression.
func (s *emitState) ensureNodeView(variable string, pos int) (string, nodeMapping, error) {
	label := s.nodeLabel[variable]
	nm, err := mapping.resolveNode(label, pos)
	if err != nil {
		return "", nodeMapping{}, err
	}
	if alias, ok := s.joinedNode[variable]; ok {
		return alias, nm, nil
	}
	idExpr, ok := s.nodeIDExpr[variable]
	if !ok {
		return "", nodeMapping{}, newErr(ErrUnsupportedShape, pos, "reference to unbound node %q", variable)
	}
	alias := s.newAlias("nv")
	s.joins = append(s.joins, fmt.Sprintf("JOIN `%s` AS `%s` ON `%s`.`%s` = %s", nm.Table, alias, alias, nm.IDColumn, idExpr))
	s.joinedNode[variable] = alias
	return alias, nm, nil
}

// columnExprForProperty resolves variable.property to a SQL column
// expression. Node id property → the identity expression (no join). Node
// non-id property → join the node view. Edge property → the edge alias.
func (s *emitState) columnExprForProperty(variable, property string, pos int) (string, error) {
	if edgeAlias, ok := s.edgeAlias[variable]; ok {
		// find the edge mapping by matching variable
		for _, e := range s.q.edges {
			if e.variable == variable {
				em, _ := mapping.resolveEdge(e.relType, e.pos)
				col, err := em.column(property, pos)
				if err != nil {
					return "", err
				}
				return fmt.Sprintf("`%s`.`%s`", edgeAlias, col), nil
			}
		}
		return "", newErr(ErrUnknownIdentifier, pos, "edge %q not found", variable)
	}
	label, ok := s.nodeLabel[variable]
	if !ok {
		return "", newErr(ErrUnknownIdentifier, pos, "variable %q is not bound", variable)
	}
	nm, err := mapping.resolveNode(label, pos)
	if err != nil {
		return "", err
	}
	col, err := nm.column(property, pos)
	if err != nil {
		return "", err
	}
	// If the requested column is exactly the one the node's identity
	// expression already yields (its join key), use it directly — no join.
	if col == s.nodeIDCol[variable] {
		if idExpr, ok := s.nodeIDExpr[variable]; ok {
			return idExpr, nil
		}
	}
	alias, _, err := s.ensureNodeView(variable, pos)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("`%s`.`%s`", alias, col), nil
}

func (s *emitState) applyInlineFilters() error {
	for _, n := range s.q.nodes {
		for _, f := range n.props {
			if n.variable == "" {
				return newErr(ErrUnsupportedShape, f.pos, "inline property filter on an anonymous node is not supported")
			}
			expr, err := s.columnExprForProperty(n.variable, f.key, f.pos)
			if err != nil {
				return err
			}
			s.where = append(s.where, expr+" = ?")
			s.args = append(s.args, literalArg(f.value))
		}
	}
	return nil
}

func (s *emitState) emitBool(e boolExpr) (string, error) {
	switch v := e.(type) {
	case andExpr:
		l, err := s.emitBool(v.left)
		if err != nil {
			return "", err
		}
		r, err := s.emitBool(v.right)
		if err != nil {
			return "", err
		}
		return "(" + l + " AND " + r + ")", nil
	case orExpr:
		l, err := s.emitBool(v.left)
		if err != nil {
			return "", err
		}
		r, err := s.emitBool(v.right)
		if err != nil {
			return "", err
		}
		return "(" + l + " OR " + r + ")", nil
	case comparison:
		col, err := s.columnExprForProperty(v.left.variable, v.left.property, v.pos)
		if err != nil {
			return "", err
		}
		s.args = append(s.args, literalArg(v.value))
		return col + " " + sqlOp(v.op) + " ?", nil
	case nullCheck:
		col, err := s.columnExprForProperty(v.ref.variable, v.ref.property, v.pos)
		if err != nil {
			return "", err
		}
		if v.negated {
			return col + " IS NOT NULL", nil
		}
		return col + " IS NULL", nil
	default:
		return "", newErr(ErrUnsupportedShape, 0, "unsupported WHERE expression")
	}
}

func (s *emitState) emitSelect() (string, []string, error) {
	var parts []string
	var cols []string
	for i, item := range s.q.items {
		alias := item.alias
		var expr string
		switch {
		case item.count != nil:
			if item.count.variable == "" {
				expr = "COUNT(*)"
			} else if idExpr, ok := s.nodeIDExpr[item.count.variable]; ok {
				expr = "COUNT(" + idExpr + ")"
			} else if _, ok := s.edgeAlias[item.count.variable]; ok {
				// count of an edge variable → count rows
				expr = "COUNT(*)"
			} else {
				return "", nil, newErr(ErrUnknownIdentifier, item.pos, "count(%s): unbound variable", item.count.variable)
			}
			if alias == "" {
				alias = "count"
			}
		case item.sum != nil:
			c, err := s.columnExprForProperty(item.sum.ref.variable, item.sum.ref.property, item.sum.ref.pos)
			if err != nil {
				return "", nil, err
			}
			// StarRocks returns NULL for SUM() over an empty group;
			// openCypher/Memgraph sum() = 0 for the same case. COALESCE to
			// 0 so a bounded aggregate on a transfer-less address (or any
			// empty-group sum) matches Cypher semantics instead of
			// serving a NULL total beside count: 0.
			expr = "COALESCE(SUM(" + c + "), 0)"
			if alias == "" {
				alias = "sum"
			}
		case item.prop != nil:
			c, err := s.columnExprForProperty(item.prop.variable, item.prop.property, item.prop.pos)
			if err != nil {
				return "", nil, err
			}
			expr = c
			if alias == "" {
				alias = item.prop.property
			}
		default:
			return "", nil, newErr(ErrUnsupportedShape, item.pos, "unsupported RETURN item")
		}
		parts = append(parts, fmt.Sprintf("%s AS `%s`", expr, alias))
		cols = append(cols, alias)
		s.selectExprs = append(s.selectExprs, expr)
		_ = i
	}
	return strings.Join(parts, ", "), cols, nil
}

func (s *emitState) emitOrderBy() (string, error) {
	if len(s.q.orderBy) == 0 && len(s.q.edges) == 0 && !s.hasCount() {
		// deterministic tiebreak on the single node's id even without ORDER BY
	}
	var parts []string
	for _, o := range s.q.orderBy {
		col, err := s.columnExprForProperty(o.ref.variable, o.ref.property, o.ref.pos)
		if err != nil {
			return "", err
		}
		dir := "ASC"
		if o.descending {
			dir = "DESC"
		}
		parts = append(parts, col+" "+dir)
	}
	// Deterministic tiebreaker so truncated (LIMIT) result sets are stable.
	// Skip for pure aggregates. With DISTINCT, StarRocks requires every
	// ORDER BY term to appear in the SELECT list, so tiebreak on the
	// selected columns; otherwise tiebreak on the stable id column.
	if !s.hasCount() {
		if s.q.distinct {
			existing := map[string]bool{}
			for _, o := range s.q.orderBy {
				if col, err := s.columnExprForProperty(o.ref.variable, o.ref.property, o.ref.pos); err == nil {
					existing[col] = true
				}
			}
			for _, expr := range s.selectExprs {
				if !existing[expr] {
					parts = append(parts, expr+" ASC")
				}
			}
		} else if tie := s.tiebreakExpr(); tie != "" {
			parts = append(parts, tie+" ASC")
		}
	}
	return strings.Join(parts, ", "), nil
}

func (s *emitState) hasCount() bool {
	for _, it := range s.q.items {
		if it.count != nil {
			return true
		}
	}
	return false
}

// tiebreakExpr returns a stable id expression: the last node's identity for
// chains, or the single node's id column.
func (s *emitState) tiebreakExpr() string {
	last := s.q.nodes[len(s.q.nodes)-1]
	if last.variable != "" {
		if e, ok := s.nodeIDExpr[last.variable]; ok {
			return e
		}
	}
	first := s.q.nodes[0]
	if e, ok := s.nodeIDExpr[first.variable]; ok {
		return e
	}
	return ""
}

func (s *emitState) newAlias(prefix string) string {
	s.aliasSeq++
	return fmt.Sprintf("%s%d", prefix, s.aliasSeq)
}

func literalArg(l literal) any {
	if l.isString {
		return l.str
	}
	return l.num
}

func sqlOp(k tokenKind) string {
	switch k {
	case tEq:
		return "="
	case tNe:
		return "<>"
	case tLt:
		return "<"
	case tLe:
		return "<="
	case tGt:
		return ">"
	case tGe:
		return ">="
	default:
		return "="
	}
}

// bindEndpointLabel resolves an endpoint's node label, rejecting a caller label
// that CONTRADICTS the edge mapping's declared endpoint.
//
// The caller's label used to win unconditionally, so
// `MATCH (a:Address)-[t:TRANSFER]->(b:Asset) RETURN b.verified` bound the target
// to the Asset view and emitted a cross-table join
// (facts_assets_view x facts_transfers_view ON asset_contract = to_address) on a
// key the graph model never exposes — silently fusing asset attributes onto
// wallet flows (rbmk#473 endpoint-label-spoof-cross-join). The relationship
// mapping is authoritative about what its endpoints ARE; a caller may omit the
// label, but may not redefine it.
func bindEndpointLabel(callerLabel, declaredLabel string, pos int) (string, error) {
	if callerLabel == "" {
		return declaredLabel, nil
	}
	if declaredLabel == "" || strings.EqualFold(callerLabel, declaredLabel) {
		return callerLabel, nil
	}
	return "", fmt.Errorf("endpoint label %q contradicts the relationship's declared endpoint %q (at position %d)", callerLabel, declaredLabel, pos)
}
