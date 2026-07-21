package cypheradmit

import (
	"errors"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

const maxStarRocksBackedGraphLimit = 1000

// maxGraphQueryBytes bounds a single graph_query/graph_query_batch entry.
// Far above any legitimate investigative query; a cheap DoS guard ahead of
// tokenization and backend planning.
const maxGraphQueryBytes = 32 * 1024

// allowedLeadingClauses is the read-clause allowlist for the first
// significant token of a query. The blocked-keyword deny-list admits unknown
// clauses by omission (FOREACH, SHOW, USING all passed it); requiring a known
// read opener rejects unrecognized clause forms by default.
var allowedLeadingClauses = map[string]struct{}{
	"MATCH":    {},
	"OPTIONAL": {},
	"RETURN":   {},
	"WITH":     {},
	"UNWIND":   {},
	"USE":      {},
	"EXPLAIN":  {},
	"PROFILE":  {},
}

var (
	blockedKeywords = map[string]struct{}{
		"ADD":        {},
		"ALTER":      {},
		"CALL":       {},
		"CONNECT":    {},
		"CREATE":     {},
		"DELETE":     {},
		"DETACH":     {},
		"DISCONNECT": {},
		"DROP":       {},
		"EXPORT":     {},
		"GRANT":      {},
		"IMPORT":     {},
		"INSERT":     {},
		"LOAD":       {},
		"MERGE":      {},
		"REMOVE":     {},
		"REVOKE":     {},
		"SET":        {},
		"TRUNCATE":   {},
		"UNADD":      {},
		"UPDATE":     {},
	}
)

var (
	// Only `USE facts` compiles to StarRocks now; `USE topology` runs natively
	// on Memgraph and is never StarRocks-backed.
	starRocksBackedGraphNames = map[string]struct{}{
		"FACTS": {},
	}
	starRocksAggregateFunctions = map[string]struct{}{
		"AVG":   {},
		"COUNT": {},
		"MAX":   {},
		"MIN":   {},
		"SUM":   {},
	}
	addressMapPredicatePattern   = regexp.MustCompile(`(?is)\{\s*` + "`?" + `address` + "`?" + `\s*:`)
	addressWherePredicatePattern = regexp.MustCompile(`(?is)\bWHERE\b.*(?:\.\s*` + "`?" + `address` + "`?" + `|\b` + "`?" + `address` + "`?" + `)\s*(?:=|IN\b)`)
	rangeWherePredicatePattern   = regexp.MustCompile(`(?is)\bWHERE\b.*\b(?:activity_date|block_date|block_height|block_timestamp|period_start_date|price_date|last_seen_timestamp|first_seen_timestamp)\b\s*(?:=|<|>|<=|>=|BETWEEN\b|IN\b)`)
	// txIDWherePredicatePattern recognizes tx_id equality/IN as an indexed
	// predicate — the TRANSFER edge's natural row-level key alongside address
	// endpoint equality (facts_transfers_view has no address-map-literal
	// surface since tx_id is an edge property, not a node id).
	txIDWherePredicatePattern = regexp.MustCompile(`(?is)\bWHERE\b.*(?:\.\s*` + "`?" + `tx_id` + "`?" + `|\b` + "`?" + `tx_id` + "`?" + `)\s*(?:=|IN\b)`)
)

type cypherToken struct {
	text            string
	start           int
	end             int
	precededByDot   bool
	precededByColon bool
	followedByColon bool
}

func ValidateReadOnlyCypher(query string) (string, error) {
	trimmed := strings.TrimSpace(query)
	if trimmed == "" {
		return "", errors.New("query cannot be empty")
	}
	if len(trimmed) > maxGraphQueryBytes {
		return "", errors.New("query too large: maximum 32768 bytes per query")
	}
	tokens := cypherTokens(trimmed)
	if isEmptyCypher(trimmed, tokens) {
		return "", errors.New("query cannot be empty")
	}
	aliases := declaredAliases(trimmed, tokens)
	if containsBlockedKeyword(trimmed, tokens, aliases) {
		return "", errors.New("Write operations are not permitted")
	}
	if _, ok := allowedLeadingClauses[tokens[0].text]; !ok {
		return "", errors.New("query must start with a read clause (MATCH, OPTIONAL MATCH, RETURN, WITH, UNWIND, USE, EXPLAIN, PROFILE)")
	}
	if err := requireSingleStatement(trimmed); err != nil {
		return "", err
	}
	return trimmed, nil
}

// requireSingleStatement rejects a top-level semicolon that is followed by
// anything significant: one request executes one statement. Semicolons inside
// strings, backtick identifiers, and comments are not separators; a trailing
// semicolon (plus whitespace/comments) stays legal.
func requireSingleStatement(query string) error {
	for i := 0; i < len(query); {
		switch query[i] {
		case '\'', '"':
			i = scanQuoted(query, i, query[i])
		case '`':
			i = scanBacktick(query, i)
		case '/':
			if i+1 < len(query) && query[i+1] == '/' {
				i = scanLineComment(query, i+2)
				continue
			}
			if i+1 < len(query) && query[i+1] == '*' {
				i = scanBlockComment(query, i+2)
				continue
			}
			i++
		case ';':
			if !onlyInsignificantContent(query[i+1:]) {
				return errors.New("query must be a single statement: content after ';' is not permitted")
			}
			return nil
		default:
			i++
		}
	}
	return nil
}

// onlyInsignificantContent reports whether the remainder holds only
// whitespace, comments, and further trailing semicolons.
func onlyInsignificantContent(remainder string) bool {
	for i := 0; i < len(remainder); {
		switch {
		case unicode.IsSpace(rune(remainder[i])) || remainder[i] == ';':
			i++
		case remainder[i] == '/' && i+1 < len(remainder) && remainder[i+1] == '/':
			i = scanLineComment(remainder, i+2)
		case remainder[i] == '/' && i+1 < len(remainder) && remainder[i+1] == '*':
			i = scanBlockComment(remainder, i+2)
		default:
			return false
		}
	}
	return true
}

func ValidateReadOnlyGraphQuery(query string) (string, error) {
	validated, err := ValidateReadOnlyCypher(query)
	if err != nil {
		return "", err
	}
	if err := validateGraphQueryCostShape(validated); err != nil {
		return "", err
	}
	return validated, nil
}

func cypherTokens(query string) []cypherToken {
	var tokens []cypherToken
	precededByDot := false
	precededByColon := false
	inTypeExpression := false

	for i := 0; i < len(query); {
		switch query[i] {
		case '\'', '"':
			i = scanQuoted(query, i, query[i])
			precededByDot = false
			precededByColon = false
			inTypeExpression = false
		case '`':
			i = scanBacktick(query, i)
			precededByDot = false
			precededByColon = false
			inTypeExpression = false
		case '/':
			if i+1 < len(query) && query[i+1] == '/' {
				i = scanLineComment(query, i+2)
				precededByDot = false
				precededByColon = false
				inTypeExpression = false
				continue
			}
			if i+1 < len(query) && query[i+1] == '*' {
				i = scanBlockComment(query, i+2)
				precededByDot = false
				precededByColon = false
				inTypeExpression = false
				continue
			}
			i++
			precededByDot = false
			precededByColon = false
			inTypeExpression = false
		case '.':
			i++
			precededByDot = true
			precededByColon = false
			inTypeExpression = false
		case ':':
			i++
			precededByDot = false
			precededByColon = true
			inTypeExpression = true
		case '|', '&':
			i++
			if inTypeExpression {
				precededByColon = true
			} else {
				precededByColon = false
			}
			precededByDot = false
		default:
			if isTokenStart(rune(query[i])) {
				start := i
				i++
				for i < len(query) && isTokenPart(rune(query[i])) {
					i++
				}
				tokens = append(tokens, cypherToken{
					text:            strings.ToUpper(query[start:i]),
					start:           start,
					end:             i,
					precededByDot:   precededByDot,
					precededByColon: precededByColon,
					followedByColon: followedByColon(query, i),
				})
				precededByDot = false
				precededByColon = false
				continue
			}
			if !unicode.IsSpace(rune(query[i])) {
				precededByDot = false
				precededByColon = false
				inTypeExpression = false
			} else if inTypeExpression {
				precededByDot = false
				precededByColon = true
			}
			i++
		}
	}

	return tokens
}

func scanQuoted(query string, start int, quote byte) int {
	for i := start + 1; i < len(query); i++ {
		if query[i] == '\\' {
			i++
			continue
		}
		if query[i] == quote {
			if i+1 < len(query) && query[i+1] == quote {
				i++
				continue
			}
			return i + 1
		}
	}
	return len(query)
}

func scanBacktick(query string, start int) int {
	for i := start + 1; i < len(query); i++ {
		if query[i] == '`' {
			if i+1 < len(query) && query[i+1] == '`' {
				i++
				continue
			}
			return i + 1
		}
	}
	return len(query)
}

func scanLineComment(query string, start int) int {
	for i := start; i < len(query); i++ {
		if query[i] == '\n' || query[i] == '\r' {
			return i + 1
		}
	}
	return len(query)
}

func scanBlockComment(query string, start int) int {
	for i := start; i+1 < len(query); i++ {
		if query[i] == '*' && query[i+1] == '/' {
			return i + 2
		}
	}
	return len(query)
}

func containsBlockedKeyword(query string, tokens []cypherToken, aliases map[string]struct{}) bool {
	for i, token := range tokens {
		if _, ok := blockedKeywords[token.text]; !ok {
			continue
		}
		if isNonClauseContext(query, tokens, i, aliases) {
			continue
		}
		return true
	}
	return false
}

func isEmptyCypher(query string, tokens []cypherToken) bool {
	return len(tokens) == 0 || strings.TrimSpace(strings.TrimRight(query, ";")) == ""
}

func validateGraphQueryCostShape(query string) error {
	tokens := cypherTokens(query)
	aliases := declaredAliases(query, tokens)
	if !usesStarRocksBackedGraph(tokens) {
		return nil
	}
	hasIndexedPredicate := hasStarRocksIndexedPredicate(query)
	finalLimit, hasLimit, err := finalLiteralLimit(query, tokens, aliases)
	if err != nil {
		return err
	}
	if hasLimit && finalLimit > maxStarRocksBackedGraphLimit {
		return errors.New("StarRocks-backed graph query LIMIT exceeds maximum 1000")
	}
	if hasGlobalAggregateFunction(query, tokens, aliases) && !hasIndexedPredicate {
		return errors.New("StarRocks-backed aggregate graph queries require an indexed predicate")
	}
	// facts_transfers_view is a full transfer-history table (unlike the
	// smaller per-address dimension views): a LIMIT alone still forces an
	// unindexed scan to find the first LIMIT rows. Row-select TRANSFER
	// queries require an indexed predicate even when LIMIT is present.
	if usesStarRocksTransferEdge(tokens) && !hasIndexedPredicate {
		return errors.New("StarRocks-backed TRANSFER graph queries require an indexed predicate (address equality on either endpoint, or tx_id)")
	}
	if !hasLimit && !hasIndexedPredicate {
		return errors.New("StarRocks-backed graph queries require an explicit LIMIT or indexed predicate")
	}
	return nil
}

// usesStarRocksTransferEdge reports whether the query's relationship pattern
// references the TRANSFER edge type (a `:TRANSFER` token in rel-type
// position). Purely lexical, like the rest of this file's cost-shape gate —
// it does not consult the cyphersql mapping.
func usesStarRocksTransferEdge(tokens []cypherToken) bool {
	for _, token := range tokens {
		if token.text == "TRANSFER" && token.precededByColon {
			return true
		}
	}
	return false
}

func usesStarRocksBackedGraph(tokens []cypherToken) bool {
	for index, token := range tokens {
		if token.text != "USE" {
			continue
		}
		if index+1 >= len(tokens) {
			continue
		}
		if _, ok := starRocksBackedGraphNames[tokens[index+1].text]; ok {
			return true
		}
	}
	return false
}

// QueryTier classifies a query by the backend it targets, for timeout/billing
// purposes. It reuses usesStarRocksBackedGraph so the two classifications
// (cost-shape validation and tier selection) can never disagree.
type QueryTier string

const (
	QueryTierLive      QueryTier = "live"
	QueryTierStarRocks QueryTier = "starrocks"
)

// ClassifyQueryTier returns the tier a query targets based on its USE clause.
// A query with no USE clause, or an unrecognized graph name, classifies as
// live — matching existing execution behavior where an unrecognized USE
// clause is not treated as StarRocks-backed either.
func ClassifyQueryTier(query string) QueryTier {
	if usesStarRocksBackedGraph(cypherTokens(query)) {
		return QueryTierStarRocks
	}
	return QueryTierLive
}

func hasStarRocksIndexedPredicate(query string) bool {
	return addressMapPredicatePattern.MatchString(query) ||
		addressWherePredicatePattern.MatchString(query) ||
		rangeWherePredicatePattern.MatchString(query) ||
		txIDWherePredicatePattern.MatchString(query)
}

func hasGlobalAggregateFunction(query string, tokens []cypherToken, aliases map[string]struct{}) bool {
	for _, token := range tokens {
		if _, ok := starRocksAggregateFunctions[token.text]; !ok {
			continue
		}
		if token.precededByDot || token.precededByColon || token.followedByColon {
			continue
		}
		if hasFunctionCallAfter(query, token.end) {
			return true
		}
	}
	return false
}

func hasFunctionCallAfter(query string, tokenEnd int) bool {
	for index := tokenEnd; index < len(query); index++ {
		if unicode.IsSpace(rune(query[index])) {
			continue
		}
		return query[index] == '('
	}
	return false
}

func finalLiteralLimit(query string, tokens []cypherToken, aliases map[string]struct{}) (int, bool, error) {
	for i, token := range tokens {
		if token.text != "LIMIT" || isNonClauseContext(query, tokens, i, aliases) {
			continue
		}
		if hasLimitExpressionAfter(query, token.end) && !hasLaterClauseBoundary(query, tokens, aliases, i) {
			limit, err := parseLiteralLimitAfter(query, token.end)
			if err != nil {
				return 0, true, err
			}
			return limit, true, nil
		}
	}
	return 0, false, nil
}

func parseLiteralLimitAfter(query string, start int) (int, error) {
	index := start
	for index < len(query) {
		switch query[index] {
		case ' ', '\t', '\n', '\r':
			index++
		case '/':
			if index+1 < len(query) && query[index+1] == '*' {
				index = scanBlockComment(query, index+2)
				continue
			}
			return 0, errors.New("StarRocks-backed graph query LIMIT must be a literal integer")
		default:
			goto parseLimit
		}
	}
	return 0, errors.New("StarRocks-backed graph query LIMIT must be a literal integer")

parseLimit:
	if index >= len(query) || query[index] < '0' || query[index] > '9' {
		return 0, errors.New("StarRocks-backed graph query LIMIT must be a literal integer")
	}
	end := index
	for end < len(query) && query[end] >= '0' && query[end] <= '9' {
		end++
	}
	limit, err := strconv.Atoi(query[index:end])
	if err != nil {
		return 0, errors.New("StarRocks-backed graph query LIMIT must be a literal integer")
	}
	for index = end; index < len(query); {
		switch query[index] {
		case ' ', '\t', '\n', '\r', ';':
			index++
		case '/':
			if index+1 < len(query) && query[index+1] == '/' {
				return limit, nil
			}
			if index+1 < len(query) && query[index+1] == '*' {
				index = scanBlockComment(query, index+2)
				continue
			}
			return 0, errors.New("StarRocks-backed graph query LIMIT must be a literal integer")
		default:
			return 0, errors.New("StarRocks-backed graph query LIMIT must be a literal integer")
		}
	}
	return limit, nil
}

func declaredAliases(query string, tokens []cypherToken) map[string]struct{} {
	aliases := map[string]struct{}{}
	for i := 1; i < len(tokens); i++ {
		if tokens[i-1].text == "AS" && onlyWhitespace(query[tokens[i-1].end:tokens[i].start]) {
			aliases[tokens[i].text] = struct{}{}
		}
	}
	return aliases
}

func isNonClauseContext(query string, tokens []cypherToken, index int, aliases map[string]struct{}) bool {
	token := tokens[index]
	if token.precededByDot {
		return true
	}
	if token.precededByColon || token.followedByColon {
		return true
	}
	if index > 0 &&
		(tokens[index-1].text == "AS" ||
			tokens[index-1].text == "RETURN" ||
			tokens[index-1].text == "WITH" ||
			tokens[index-1].text == "WHERE" ||
			tokens[index-1].text == "BY") &&
		onlyWhitespace(query[tokens[index-1].end:token.start]) {
		return true
	}
	if _, ok := aliases[token.text]; ok && isAliasReadExpressionContext(query, tokens, index) {
		return true
	}
	return false
}

func isTokenStart(r rune) bool {
	return r == '_' || unicode.IsLetter(r)
}

func isTokenPart(r rune) bool {
	return r == '_' || unicode.IsLetter(r) || unicode.IsDigit(r)
}

func followedByColon(query string, start int) bool {
	for i := start; i < len(query); i++ {
		if unicode.IsSpace(rune(query[i])) {
			continue
		}
		return query[i] == ':'
	}
	return false
}

func hasLimitExpressionAfter(query string, start int) bool {
	for i := start; i < len(query); {
		switch query[i] {
		case ' ', '\t', '\n', '\r', ';':
			i++
		case '/':
			if i+1 < len(query) && query[i+1] == '/' {
				return false
			}
			if i+1 < len(query) && query[i+1] == '*' {
				i = scanBlockComment(query, i+2)
				continue
			}
			return true
		default:
			return true
		}
	}
	return false
}

func hasLaterClauseBoundary(query string, tokens []cypherToken, aliases map[string]struct{}, index int) bool {
	for i := index + 1; i < len(tokens); i++ {
		if isNonClauseContext(query, tokens, i, aliases) {
			continue
		}
		if isClauseBoundary(tokens[i].text) {
			return true
		}
	}
	return false
}

func isAliasReadExpressionContext(query string, tokens []cypherToken, index int) bool {
	for i := index - 1; i >= 0; i-- {
		if isStructuralNonClauseContext(query, tokens, i) {
			continue
		}
		switch tokens[i].text {
		case "WHERE", "BY", "ORDER":
			return true
		case "MATCH", "RETURN", "WITH", "UNION":
			return false
		}
		if _, ok := blockedKeywords[tokens[i].text]; ok {
			return false
		}
	}
	return false
}

func isClauseBoundary(token string) bool {
	switch token {
	case "MATCH", "RETURN", "WITH", "UNION":
		return true
	default:
		_, ok := blockedKeywords[token]
		return ok
	}
}

func isStructuralNonClauseContext(query string, tokens []cypherToken, index int) bool {
	token := tokens[index]
	if token.precededByDot {
		return true
	}
	if token.precededByColon || token.followedByColon {
		return true
	}
	return index > 0 &&
		(tokens[index-1].text == "AS" ||
			tokens[index-1].text == "RETURN" ||
			tokens[index-1].text == "WITH" ||
			tokens[index-1].text == "WHERE" ||
			tokens[index-1].text == "BY") &&
		onlyWhitespace(query[tokens[index-1].end:tokens[index].start])
}

func onlyWhitespace(text string) bool {
	for _, r := range text {
		if !unicode.IsSpace(r) {
			return false
		}
	}
	return true
}
