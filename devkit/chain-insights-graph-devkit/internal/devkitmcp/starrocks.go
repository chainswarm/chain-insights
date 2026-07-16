package devkitmcp

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"

	"github.com/chainswarm/chain-insights/devkit/chain-insights-graph-devkit/internal/cyphersql"
	"github.com/go-sql-driver/mysql"
)

// StarRocksRunner executes facts queries by compiling them to StarRocks SQL
// (internal/cyphersql) and running against the devkit warehouse — mirroring
// the production graphrag-mcp facts path. MemGQL is no longer in the loop.
type StarRocksRunner struct {
	db *sql.DB
}

func NewStarRocksRunner(config Config) (*StarRocksRunner, error) {
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
	return &StarRocksRunner{db: db}, nil
}

func (r *StarRocksRunner) Run(ctx context.Context, _ string, query string) (QueryResult, error) {
	compiled, err := cyphersql.Compile(query)
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
