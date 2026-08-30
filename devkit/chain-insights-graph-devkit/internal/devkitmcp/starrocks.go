package devkitmcp

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/chainswarm/chain-insights/devkit/chain-insights-graph-devkit/internal/cypheradmit"
	"github.com/chainswarm/chain-insights/devkit/chain-insights-graph-devkit/internal/cyphersql"
	"github.com/go-sql-driver/mysql"
)

// StarRocksRunner executes facts queries by compiling them to StarRocks SQL
// (internal/cyphersql) and running against the devkit warehouse — mirroring
// the production graphrag-mcp facts path. MemGQL is no longer in the loop.
type StarRocksRunner struct {
	db *sql.DB
	// factsWindowStart is the recency-window floor (now - window days) applied
	// to address-kind queries; computed once at construction, in Go, per spec
	// D2 (bounds are never computed in SQL).
	factsWindowStart string
}

func NewStarRocksRunner(config Config) (*StarRocksRunner, error) {
	if config.FactsRecencyWindowDays <= 0 {
		return nil, fmt.Errorf("FACTS_RECENCY_WINDOW_DAYS must be positive, got %d", config.FactsRecencyWindowDays)
	}
	mc := mysql.Config{
		User:                 config.StarRocksUser,
		Passwd:               config.StarRocksPassword,
		Net:                  "tcp",
		Addr:                 fmt.Sprintf("%s:%d", config.StarRocksHost, config.StarRocksPort),
		DBName:               config.StarRocksDatabase,
		AllowNativePasswords: true,
		ParseTime:            true,
	}
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		return nil, fmt.Errorf("open devkit starrocks: %w", err)
	}
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(2)
	return &StarRocksRunner{
		db:               db,
		factsWindowStart: recencyWindowStartFor(time.Now().UTC(), config.FactsRecencyWindowDays),
	}, nil
}

// recencyWindowStartFor returns the window floor: now truncated to the day,
// minus windowDays, formatted "2006-01-02" (spec D2).
func recencyWindowStartFor(now time.Time, windowDays int) string {
	return now.Truncate(24*time.Hour).AddDate(0, 0, -windowDays).Format("2006-01-02")
}

// Run compiles and executes one facts query. It re-derives the predicate
// kind (defense in depth — the admission gate already ran): an address-kind
// query gets the recency-window floor via CompileWithWindow, a block_date or
// tx_id kind compiles plain, and a kind-less query fails closed with the
// remedy error before any warehouse access.
func (r *StarRocksRunner) Run(ctx context.Context, _ string, query string) (QueryResult, error) {
	compiled, err := r.compileForKind(query)
	if err != nil {
		return QueryResult{}, err
	}
	rows, err := r.db.QueryContext(ctx, compiled.SQL, compiled.Args...)
	if err != nil {
		return QueryResult{}, err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return QueryResult{}, err
	}
	colTypes, err := rows.ColumnTypes()
	if err != nil {
		return QueryResult{}, err
	}
	out := []map[string]any{}
	for rows.Next() {
		raw := make([]sql.RawBytes, len(cols))
		scan := make([]any, len(cols))
		for i := range raw {
			scan[i] = &raw[i]
		}
		if err := rows.Scan(scan...); err != nil {
			return QueryResult{}, err
		}
		row := make(map[string]any, len(cols))
		for i, col := range cols {
			row[col] = marshalCell(raw[i], colTypes[i].DatabaseTypeName())
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return QueryResult{}, err
	}
	return QueryResult{Rows: out}, nil
}

// compileForKind routes the query by its predicate kind (spec D1/D2): address
// → CompileWithWindow with the recency floor; block_date/tx_id → Compile
// plain (caller bounds and point lookups keep their semantics); none → fail
// closed with the remedy error.
func (r *StarRocksRunner) compileForKind(query string) (*cyphersql.Compiled, error) {
	kind, err := cypheradmit.FactsPredicateKind(query)
	if err != nil {
		return nil, err
	}
	if kind == cypheradmit.FactsPredicateAddress {
		return cyphersql.CompileWithWindow(query, r.factsWindowStart)
	}
	return cyphersql.Compile(query)
}

func (r *StarRocksRunner) Close() error { return r.db.Close() }

// marshalCell matches the production graphrag-mcp serialization: integer
// columns as numbers, DECIMAL/float and everything else as strings, NULL nil.
func marshalCell(b sql.RawBytes, dbType string) any {
	if b == nil {
		return nil
	}
	s := string(b)
	switch strings.ToUpper(dbType) {
	case "TINYINT", "SMALLINT", "INT", "INTEGER", "BIGINT", "LARGEINT":
		if n, err := strconv.ParseInt(s, 10, 64); err == nil {
			return n
		}
	}
	return s
}
