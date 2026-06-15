package devkitmcp

import (
	"fmt"
	"regexp"
	"strings"
)

var disallowedQueryTerms = []string{
	"CREATE",
	"INSERT",
	"MERGE",
	"SET",
	"DELETE",
	"REMOVE",
	"DROP",
	"DETACH",
	"ADD",
	"CONNECT",
	"DISCONNECT",
	"ALTER",
	"TRUNCATE",
	"GRANT",
	"REVOKE",
}

func ValidateReadOnlyQuery(query string) error {
	if strings.TrimSpace(query) == "" {
		return fmt.Errorf("query is required")
	}
	for _, term := range disallowedQueryTerms {
		pattern := regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(term) + `\b`)
		if pattern.FindStringIndex(query) != nil {
			return fmt.Errorf("query uses disallowed operation %s", term)
		}
	}
	return nil
}
