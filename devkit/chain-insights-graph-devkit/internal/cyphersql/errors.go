package cyphersql

import (
	"errors"
	"fmt"
)

// Typed sentinel errors let callers branch on failure class (e.g.
// ErrUnsupportedShape → HTTP 400, ErrLimitTooHigh → 400) via errors.Is.
var (
	// ErrUnsupportedShape means the query parsed as some Cypher but is not
	// in the compiled facts subset (a non-facts scope such as topology,
	// variable-length, collect, WITH, unknown clause, etc.). The message
	// names the supported patterns.
	ErrUnsupportedShape = errors.New("unsupported facts query shape")
	// ErrUnknownIdentifier means a label, relationship type, or property is
	// not in the mapping. Never passed through to SQL.
	ErrUnknownIdentifier = errors.New("unknown graph identifier")
	// ErrLimitRequired means the query has no LIMIT clause.
	ErrLimitRequired = errors.New("LIMIT is required")
	// ErrLimitTooHigh means the LIMIT exceeds maxLimit.
	ErrLimitTooHigh = errors.New("LIMIT exceeds maximum")
	// ErrOffsetForbidden means the query uses OFFSET (unbounded scans).
	ErrOffsetForbidden = errors.New("OFFSET is not supported")
	// ErrParse means the input is not valid Cypher this parser accepts.
	ErrParse = errors.New("cypher parse error")
)

// compileError wraps a sentinel with position + human context and supports
// errors.Is against the wrapped sentinel.
type compileError struct {
	sentinel error
	reason   string
	pos      int
}

func (e *compileError) Error() string {
	if e.pos > 0 {
		return fmt.Sprintf("%v: %s (at position %d)", e.sentinel, e.reason, e.pos)
	}
	return fmt.Sprintf("%v: %s", e.sentinel, e.reason)
}

func (e *compileError) Unwrap() error { return e.sentinel }

func newErr(sentinel error, pos int, format string, args ...any) *compileError {
	return &compileError{sentinel: sentinel, reason: fmt.Sprintf(format, args...), pos: pos}
}

const supportedPatterns = "supported facts shapes: single-node lookup/scan, " +
	"node-edge-node, fixed 1..5-hop facts edge chains (HAS_* enrichment), count() — " +
	"with WHERE (comparisons/AND/OR/IS [NOT] NULL), ORDER BY, and a required LIMIT<=1000"
