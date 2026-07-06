package cyphersql

import "strings"

const maxLimit = 1000

type parser struct {
	toks []token
	i    int
}

func parse(src string) (*query, error) {
	toks, err := lex(src)
	if err != nil {
		return nil, err
	}
	p := &parser{toks: toks}
	return p.parseQuery()
}

func (p *parser) cur() token  { return p.toks[p.i] }
func (p *parser) next() token { t := p.toks[p.i]; p.i++; return t }
func (p *parser) at(k tokenKind) bool {
	return p.cur().Kind == k
}

// keyword reports whether the current token is the given case-insensitive
// keyword (an identifier).
func (p *parser) keyword(kw string) bool {
	return p.cur().Kind == tIdent && strings.EqualFold(p.cur().Text, kw)
}

func (p *parser) expect(k tokenKind, what string) (token, error) {
	if p.cur().Kind != k {
		return token{}, newErr(ErrParse, p.cur().Pos, "expected %s, got %q", what, p.cur().Text)
	}
	return p.next(), nil
}

func (p *parser) expectKeyword(kw string) error {
	if !p.keyword(kw) {
		return newErr(ErrParse, p.cur().Pos, "expected %s, got %q", kw, p.cur().Text)
	}
	p.next()
	return nil
}

func (p *parser) parseQuery() (*query, error) {
	q := &query{limit: -1}
	// USE <scope>
	if err := p.expectKeyword("USE"); err != nil {
		return nil, err
	}
	scopeTok, err := p.expect(tIdent, "topology scope")
	if err != nil {
		return nil, err
	}
	q.scope = scopeTok.Text
	if q.scope != "archive_topology" && q.scope != "facts" {
		return nil, newErr(ErrUnsupportedShape, scopeTok.Pos, "cyphersql compiles archive_topology/facts only, not %q (%s)", q.scope, supportedPatterns)
	}
	// MATCH pattern
	if err := p.expectKeyword("MATCH"); err != nil {
		return nil, err
	}
	if err := p.parseMatch(q); err != nil {
		return nil, err
	}
	// optional WHERE
	if p.keyword("WHERE") {
		p.next()
		expr, err := p.parseBoolExpr()
		if err != nil {
			return nil, err
		}
		q.where = expr
	}
	// Reject WITH/UNWIND pipelines with a typed error (out of archive scope).
	if p.keyword("WITH") || p.keyword("UNWIND") {
		return nil, newErr(ErrUnsupportedShape, p.cur().Pos, "%s pipelines are not supported on archive; %s", strings.ToUpper(p.cur().Text), supportedPatterns)
	}
	// RETURN
	if err := p.expectKeyword("RETURN") ; err != nil {
		return nil, err
	}
	if err := p.parseReturn(q); err != nil {
		return nil, err
	}
	// optional ORDER BY
	if p.keyword("ORDER") {
		p.next()
		if err := p.expectKeyword("BY"); err != nil {
			return nil, err
		}
		if err := p.parseOrderBy(q); err != nil {
			return nil, err
		}
	}
	// reject SKIP/OFFSET explicitly
	if p.keyword("SKIP") || p.keyword("OFFSET") {
		return nil, newErr(ErrOffsetForbidden, p.cur().Pos, "%s is not supported", p.cur().Text)
	}
	// LIMIT (required)
	if !p.keyword("LIMIT") {
		return nil, newErr(ErrLimitRequired, p.cur().Pos, "every archive query must end with LIMIT <= %d", maxLimit)
	}
	p.next()
	limTok, err := p.expect(tNumber, "LIMIT value")
	if err != nil {
		return nil, err
	}
	lim, err := parseIntStrict(limTok.Text)
	if err != nil || lim < 0 {
		return nil, newErr(ErrParse, limTok.Pos, "invalid LIMIT %q", limTok.Text)
	}
	if lim > maxLimit {
		return nil, newErr(ErrLimitTooHigh, limTok.Pos, "LIMIT %d exceeds maximum %d", lim, maxLimit)
	}
	q.limit = lim
	q.hasLimit = true
	if !p.at(tEOF) {
		return nil, newErr(ErrUnsupportedShape, p.cur().Pos, "unexpected trailing input %q (%s)", p.cur().Text, supportedPatterns)
	}
	return q, nil
}

func (p *parser) parseMatch(q *query) error {
	n, err := p.parseNode()
	if err != nil {
		return err
	}
	q.nodes = append(q.nodes, n)
	// An edge begins with '-' (forward: -[...]->)  or '<-' (reverse: <-[...]-).
	for p.at(tDash) || p.at(tArrowLeft) {
		e, err := p.parseEdge()
		if err != nil {
			return err
		}
		nn, err := p.parseNode()
		if err != nil {
			return err
		}
		q.edges = append(q.edges, e)
		q.nodes = append(q.nodes, nn)
	}
	if len(q.edges) > maxChainHops {
		return newErr(ErrUnsupportedShape, q.nodes[0].pos, "chain length %d exceeds the %d-hop maximum", len(q.edges), maxChainHops)
	}
	return nil
}

func (p *parser) parseNode() (nodePattern, error) {
	n := nodePattern{pos: p.cur().Pos}
	if _, err := p.expect(tLParen, "("); err != nil {
		return n, err
	}
	if p.at(tIdent) {
		n.variable = p.next().Text
	}
	if p.at(tColon) {
		p.next()
		lbl, err := p.expect(tIdent, "node label")
		if err != nil {
			return n, err
		}
		n.label = lbl.Text
	}
	if p.at(tLBrace) {
		props, err := p.parseInlineProps()
		if err != nil {
			return n, err
		}
		n.props = props
	}
	if _, err := p.expect(tRParen, ")"); err != nil {
		return n, err
	}
	return n, nil
}

func (p *parser) parseInlineProps() ([]propFilter, error) {
	if _, err := p.expect(tLBrace, "{"); err != nil {
		return nil, err
	}
	var props []propFilter
	for {
		key, err := p.expect(tIdent, "property name")
		if err != nil {
			return nil, err
		}
		if _, err := p.expect(tColon, ":"); err != nil {
			return nil, err
		}
		val, err := p.parseLiteral()
		if err != nil {
			return nil, err
		}
		props = append(props, propFilter{key: key.Text, value: val, pos: key.Pos})
		if p.at(tComma) {
			p.next()
			continue
		}
		break
	}
	if _, err := p.expect(tRBrace, "}"); err != nil {
		return nil, err
	}
	return props, nil
}

// parseEdge parses -[var:REL]-> (forward) or <-[var:REL]- (reverse).
// Variable-length ([*..], [*BFS ...]) is rejected as unsupported.
func (p *parser) parseEdge() (edgePattern, error) {
	e := edgePattern{pos: p.cur().Pos}
	if p.at(tArrowLeft) { // <-[ ... ]-  (reverse)
		e.reverse = true
		p.next()
	} else if p.at(tDash) { // -[ ... ]->  (forward)
		p.next()
	} else {
		return e, newErr(ErrParse, p.cur().Pos, "expected an edge, got %q", p.cur().Text)
	}
	if _, err := p.expect(tLBracket, "["); err != nil {
		return e, err
	}
	if p.at(tIdent) {
		e.variable = p.next().Text
	}
	if _, err := p.expect(tColon, ":"); err != nil {
		return e, err
	}
	rel, err := p.expect(tIdent, "relationship type")
	if err != nil {
		return e, err
	}
	e.relType = rel.Text
	// Reject variable-length / quantified / shortest-path traversal.
	if p.at(tStar) {
		return e, newErr(ErrUnsupportedShape, p.cur().Pos, "variable-length/shortest-path traversal is not supported on archive; use fixed-hop patterns (%s)", supportedPatterns)
	}
	if _, err := p.expect(tRBracket, "]"); err != nil {
		return e, err
	}
	// closing direction
	if e.reverse {
		if !p.at(tDash) {
			return e, newErr(ErrUnsupportedShape, p.cur().Pos, "reverse edge must close with '-'")
		}
		p.next()
	} else {
		if !p.at(tArrowRight) {
			return e, newErr(ErrUnsupportedShape, p.cur().Pos, "only directed edges (-[]->/<-[]-) are supported")
		}
		p.next()
	}
	return e, nil
}

const maxChainHops = 5

func (p *parser) parseReturn(q *query) error {
	if p.keyword("DISTINCT") {
		q.distinct = true
		p.next()
	}
	for {
		item, err := p.parseReturnItem()
		if err != nil {
			return err
		}
		q.items = append(q.items, item)
		if p.at(tComma) {
			p.next()
			continue
		}
		break
	}
	return nil
}

func (p *parser) parseReturnItem() (returnItem, error) {
	item := returnItem{pos: p.cur().Pos}
	// Reject non-count aggregate/expression forms with a typed error.
	if p.keyword("CASE") {
		return item, newErr(ErrUnsupportedShape, p.cur().Pos, "CASE expressions are not supported on archive; %s", supportedPatterns)
	}
	if p.keyword("sum") || p.keyword("avg") || p.keyword("min") || p.keyword("max") || p.keyword("collect") {
		return item, newErr(ErrUnsupportedShape, p.cur().Pos, "the %s() aggregate is not supported on archive (only count()); %s", p.cur().Text, supportedPatterns)
	}
	if p.keyword("count") {
		p.next()
		if _, err := p.expect(tLParen, "("); err != nil {
			return item, err
		}
		ce := &countExpr{pos: p.cur().Pos}
		if p.at(tStar) {
			p.next()
		} else {
			v, err := p.expect(tIdent, "count argument")
			if err != nil {
				return item, err
			}
			ce.variable = v.Text
		}
		if _, err := p.expect(tRParen, ")"); err != nil {
			return item, err
		}
		item.count = ce
	} else {
		ref, err := p.parsePropertyRef()
		if err != nil {
			return item, err
		}
		item.prop = &ref
	}
	// optional AS alias
	if p.keyword("AS") {
		p.next()
		a, err := p.expect(tIdent, "alias")
		if err != nil {
			return item, err
		}
		item.alias = a.Text
	}
	return item, nil
}

func (p *parser) parsePropertyRef() (propertyRef, error) {
	v, err := p.expect(tIdent, "variable")
	if err != nil {
		return propertyRef{}, err
	}
	if _, err := p.expect(tDot, "."); err != nil {
		return propertyRef{}, newErr(ErrUnsupportedShape, v.Pos, "only variable.property projections are supported (%s)", supportedPatterns)
	}
	prop, err := p.expect(tIdent, "property")
	if err != nil {
		return propertyRef{}, err
	}
	return propertyRef{variable: v.Text, property: prop.Text, pos: v.Pos}, nil
}

func (p *parser) parseOrderBy(q *query) error {
	for {
		ref, err := p.parsePropertyRef()
		if err != nil {
			return err
		}
		item := orderItem{ref: ref}
		if p.keyword("DESC") {
			item.descending = true
			p.next()
		} else if p.keyword("ASC") {
			p.next()
		}
		q.orderBy = append(q.orderBy, item)
		if p.at(tComma) {
			p.next()
			continue
		}
		break
	}
	return nil
}

// WHERE expression: OR has lowest precedence, then AND, then primaries.
func (p *parser) parseBoolExpr() (boolExpr, error) { return p.parseOr() }

func (p *parser) parseOr() (boolExpr, error) {
	left, err := p.parseAnd()
	if err != nil {
		return nil, err
	}
	for p.keyword("OR") {
		p.next()
		right, err := p.parseAnd()
		if err != nil {
			return nil, err
		}
		left = orExpr{left: left, right: right}
	}
	return left, nil
}

func (p *parser) parseAnd() (boolExpr, error) {
	left, err := p.parsePrimary()
	if err != nil {
		return nil, err
	}
	for p.keyword("AND") {
		p.next()
		right, err := p.parsePrimary()
		if err != nil {
			return nil, err
		}
		left = andExpr{left: left, right: right}
	}
	return left, nil
}

func (p *parser) parsePrimary() (boolExpr, error) {
	if p.at(tLParen) {
		p.next()
		expr, err := p.parseOr()
		if err != nil {
			return nil, err
		}
		if _, err := p.expect(tRParen, ")"); err != nil {
			return nil, err
		}
		return expr, nil
	}
	ref, err := p.parsePropertyRef()
	if err != nil {
		return nil, err
	}
	if p.keyword("IS") {
		p.next()
		negated := false
		if p.keyword("NOT") {
			negated = true
			p.next()
		}
		if err := p.expectKeyword("NULL"); err != nil {
			return nil, err
		}
		return nullCheck{ref: ref, negated: negated, pos: ref.pos}, nil
	}
	op := p.cur().Kind
	switch op {
	case tEq, tNe, tLt, tLe, tGt, tGe:
		p.next()
		val, err := p.parseLiteral()
		if err != nil {
			return nil, err
		}
		return comparison{left: ref, op: op, value: val, pos: ref.pos}, nil
	default:
		return nil, newErr(ErrUnsupportedShape, p.cur().Pos, "unsupported WHERE operator %q (%s)", p.cur().Text, supportedPatterns)
	}
}

func (p *parser) parseLiteral() (literal, error) {
	switch p.cur().Kind {
	case tString:
		t := p.next()
		return literal{isString: true, str: t.Value}, nil
	case tNumber:
		t := p.next()
		return literal{num: t.Text}, nil
	default:
		return literal{}, newErr(ErrUnsupportedShape, p.cur().Pos, "expected a string or number literal, got %q (no expressions/functions in values)", p.cur().Text)
	}
}

func parseIntStrict(s string) (int, error) {
	n := 0
	if s == "" {
		return 0, newErr(ErrParse, 0, "empty number")
	}
	for i := 0; i < len(s); i++ {
		if !isDigit(s[i]) {
			return 0, newErr(ErrParse, 0, "non-integer %q", s)
		}
		n = n*10 + int(s[i]-'0')
	}
	return n, nil
}
