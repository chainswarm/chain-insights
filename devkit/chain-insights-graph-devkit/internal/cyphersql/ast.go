package cyphersql

// AST for the compiled archive_topology / facts Cypher subset. Only the
// node shapes here can be produced by the parser; anything else is rejected
// before an AST exists.

type query struct {
	scope    string // archive_topology | facts
	nodes    []nodePattern
	edges    []edgePattern // len == len(nodes)-1; edges[i] links nodes[i] -> nodes[i+1]
	where    boolExpr      // nil when absent
	distinct bool
	items    []returnItem
	orderBy  []orderItem
	limit    int
	hasLimit bool
}

type nodePattern struct {
	variable string
	label    string
	props    []propFilter // inline {k: v} equality filters
	pos      int
}

type propFilter struct {
	key   string
	value literal
	pos   int
}

type edgePattern struct {
	variable string
	relType  string
	reverse  bool // true for <-[]- (target/source columns swapped)
	pos      int
}

// returnItem is one RETURN projection. Exactly one of the fields is set.
type returnItem struct {
	alias string
	// property reference: variable.property
	prop *propertyRef
	// count(variable) or count(*)
	count *countExpr
	pos   int
}

type propertyRef struct {
	variable string
	property string
	pos      int
}

type countExpr struct {
	variable string // "" for count(*)
	pos      int
}

type orderItem struct {
	ref        propertyRef
	descending bool
}

// boolExpr is a WHERE expression tree: comparisons combined with AND/OR,
// plus IS [NOT] NULL.
type boolExpr interface{ isBoolExpr() }

type andExpr struct{ left, right boolExpr }
type orExpr struct{ left, right boolExpr }

type comparison struct {
	left  propertyRef
	op    tokenKind // tEq tNe tLt tLe tGt tGe
	value literal
	pos   int
}

type nullCheck struct {
	ref     propertyRef
	negated bool // IS NOT NULL
	pos     int
}

func (andExpr) isBoolExpr()    {}
func (orExpr) isBoolExpr()     {}
func (comparison) isBoolExpr() {}
func (nullCheck) isBoolExpr()  {}

// literal is a bound value (string or number). Never interpolated into SQL.
type literal struct {
	isString bool
	str      string
	num      string // raw numeric text
}
