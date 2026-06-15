package devkitmcp

import (
	"context"
	"fmt"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

type QueryResult struct {
	Rows []map[string]any `json:"rows"`
}

type QueryRunner interface {
	Run(context.Context, string, string) (QueryResult, error)
}

type MemgraphRunner struct {
	driver neo4j.DriverWithContext
}

func NewMemgraphRunner(ctx context.Context, uri string, user string, pass string) (*MemgraphRunner, error) {
	auth := neo4j.NoAuth()
	if user != "" {
		auth = neo4j.BasicAuth(user, pass, "")
	}
	driver, err := neo4j.NewDriverWithContext(uri, auth)
	if err != nil {
		return nil, fmt.Errorf("create memgraph driver uri=%s: %w", uri, err)
	}
	if err := driver.VerifyConnectivity(ctx); err != nil {
		_ = driver.Close(ctx)
		return nil, fmt.Errorf("verify memgraph connectivity uri=%s: %w", uri, err)
	}
	return &MemgraphRunner{driver: driver}, nil
}

func (runner *MemgraphRunner) Close(ctx context.Context) error {
	return runner.driver.Close(ctx)
}

func (runner *MemgraphRunner) Run(ctx context.Context, network string, query string) (QueryResult, error) {
	if network != "bittensor" {
		return QueryResult{}, fmt.Errorf("unsupported network %q", network)
	}
	result, err := neo4j.ExecuteQuery(
		ctx,
		runner.driver,
		query,
		nil,
		neo4j.EagerResultTransformer,
		neo4j.ExecuteQueryWithReadersRouting(),
	)
	if err != nil {
		return QueryResult{}, fmt.Errorf("run graph query network=%s: %w", network, err)
	}
	rows := make([]map[string]any, 0, len(result.Records))
	for _, record := range result.Records {
		row := map[string]any{}
		for _, key := range record.Keys {
			value, _ := record.Get(key)
			row[key] = value
		}
		rows = append(rows, row)
	}
	return QueryResult{Rows: rows}, nil
}
