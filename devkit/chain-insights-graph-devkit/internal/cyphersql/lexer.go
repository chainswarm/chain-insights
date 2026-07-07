package cyphersql

import (
	"fmt"
	"strings"
)

type tokenKind int

const (
	tEOF tokenKind = iota
	tIdent
	tString // string literal; Value holds the decoded content
	tNumber
	tLParen
	tRParen
	tLBrace
	tRBrace
	tLBracket
	tRBracket
	tColon
	tComma
	tDot
	tStar
	tEq
	tNe
	tLt
	tLe
	tGt
	tGe
	tArrowRight // ->
	tArrowLeft  // <-
	tPipe       // |
	tDash       // - (edge body delimiter)
)

type token struct {
	Kind  tokenKind
	Text  string // raw source text
	Value string // decoded value for tString
	Pos   int    // 1-based position in source
}

// lex tokenizes an input query, preserving string-literal values verbatim
// (so they can be bound as SQL args, never interpolated). It rejects
// comment sequences outright — the archive surface has no use for them and
// they are a classic injection vector.
func lex(src string) ([]token, error) {
	var toks []token
	i := 0
	n := len(src)
	emit := func(k tokenKind, text string, pos int) { toks = append(toks, token{Kind: k, Text: text, Pos: pos + 1}) }
	for i < n {
		c := src[i]
		switch {
		case c == ' ' || c == '\t' || c == '\n' || c == '\r':
			i++
		case c == '/' && i+1 < n && (src[i+1] == '/' || src[i+1] == '*'):
			return nil, newErr(ErrParse, i+1, "comments are not allowed")
		case c == '-' && i+1 < n && src[i+1] == '-':
			return nil, newErr(ErrParse, i+1, "comments are not allowed")
		case c == '\'' || c == '"' || c == '`':
			val, raw, next, err := scanString(src, i)
			if err != nil {
				return nil, err
			}
			toks = append(toks, token{Kind: tString, Text: raw, Value: val, Pos: i + 1})
			i = next
		case c == '(':
			emit(tLParen, "(", i)
			i++
		case c == ')':
			emit(tRParen, ")", i)
			i++
		case c == '{':
			emit(tLBrace, "{", i)
			i++
		case c == '}':
			emit(tRBrace, "}", i)
			i++
		case c == '[':
			emit(tLBracket, "[", i)
			i++
		case c == ']':
			emit(tRBracket, "]", i)
			i++
		case c == ':':
			emit(tColon, ":", i)
			i++
		case c == ',':
			emit(tComma, ",", i)
			i++
		case c == '.':
			emit(tDot, ".", i)
			i++
		case c == '*':
			emit(tStar, "*", i)
			i++
		case c == '|':
			emit(tPipe, "|", i)
			i++
		case c == '=':
			emit(tEq, "=", i)
			i++
		case c == '<':
			if i+1 < n && src[i+1] == '>' {
				emit(tNe, "<>", i)
				i += 2
			} else if i+1 < n && src[i+1] == '=' {
				emit(tLe, "<=", i)
				i += 2
			} else if i+1 < n && src[i+1] == '-' {
				emit(tArrowLeft, "<-", i)
				i += 2
			} else {
				emit(tLt, "<", i)
				i++
			}
		case c == '>':
			if i+1 < n && src[i+1] == '=' {
				emit(tGe, ">=", i)
				i += 2
			} else {
				emit(tGt, ">", i)
				i++
			}
		case c == '-':
			if i+1 < n && src[i+1] == '>' {
				emit(tArrowRight, "->", i)
				i += 2
			} else {
				emit(tDash, "-", i)
				i++
			}
		case c == '!':
			if i+1 < n && src[i+1] == '=' {
				emit(tNe, "!=", i)
				i += 2
			} else {
				return nil, newErr(ErrParse, i+1, "unexpected %q", string(c))
			}
		case isDigit(c):
			start := i
			i++
			for i < n && (isDigit(src[i]) || src[i] == '.') {
				i++
			}
			emit(tNumber, src[start:i], start)
		case isIdentStart(c):
			start := i
			i++
			for i < n && isIdentPart(src[i]) {
				i++
			}
			emit(tIdent, src[start:i], start)
		default:
			return nil, newErr(ErrParse, i+1, "unexpected character %q", string(c))
		}
	}
	toks = append(toks, token{Kind: tEOF, Pos: n + 1})
	return toks, nil
}

// scanString consumes a quoted string starting at src[start] (', ", or `)
// and returns the decoded value, raw text, next index, and any error. It
// handles backslash escapes and doubled-quote escapes; the decoded value is
// what gets bound as a SQL arg, so escaping in the SOURCE never reaches SQL.
func scanString(src string, start int) (value, raw string, next int, err error) {
	quote := src[start]
	var b strings.Builder
	i := start + 1
	n := len(src)
	for i < n {
		c := src[i]
		if c == '\\' && i+1 < n {
			nxt := src[i+1]
			switch nxt {
			case 'n':
				b.WriteByte('\n')
			case 't':
				b.WriteByte('\t')
			case 'r':
				b.WriteByte('\r')
			case '\\', '\'', '"', '`':
				b.WriteByte(nxt)
			default:
				// Preserve unknown escapes verbatim (backslash + char) so the
				// bound value is lossless; it is bound as an arg regardless.
				b.WriteByte('\\')
				b.WriteByte(nxt)
			}
			i += 2
			continue
		}
		if c == quote {
			if i+1 < n && src[i+1] == quote { // doubled-quote escape
				b.WriteByte(quote)
				i += 2
				continue
			}
			return b.String(), src[start : i+1], i + 1, nil
		}
		b.WriteByte(c)
		i++
	}
	return "", "", 0, newErr(ErrParse, start+1, "unterminated string literal")
}

func isDigit(c byte) bool      { return c >= '0' && c <= '9' }
func isIdentStart(c byte) bool { return c == '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') }
func isIdentPart(c byte) bool  { return isIdentStart(c) || isDigit(c) }

func (k tokenKind) String() string {
	switch k {
	case tEOF:
		return "EOF"
	case tIdent:
		return "identifier"
	case tString:
		return "string"
	case tNumber:
		return "number"
	default:
		return fmt.Sprintf("token(%d)", int(k))
	}
}
