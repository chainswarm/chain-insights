package devkitmcp

import (
	"context"
	"fmt"
	"log/slog"
	"time"

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

type RetryConfig struct {
	Attempts int
	Delay    time.Duration
}

type memgraphRunnerFactory func(context.Context, string, string, string) (*MemgraphRunner, error)

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

func NewMemgraphRunnerWithRetry(ctx context.Context, config Config, retry RetryConfig, logger *slog.Logger) (*MemgraphRunner, error) {
	return newMemgraphRunnerWithRetry(ctx, config, retry, logger, NewMemgraphRunner)
}

func newMemgraphRunnerWithRetry(
	ctx context.Context,
	config Config,
	retry RetryConfig,
	logger *slog.Logger,
	factory memgraphRunnerFactory,
) (*MemgraphRunner, error) {
	attempts := retry.Attempts
	if attempts <= 0 {
		attempts = 1
	}
	delay := retry.Delay
	if delay < 0 {
		delay = 0
	}
	if logger == nil {
		logger = slog.Default()
	}

	var lastErr error
	for attempt := 1; attempt <= attempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return nil, fmt.Errorf("wait for memgraph connectivity uri=%s: %w", config.MemgraphURI, err)
		}
		runner, err := factory(ctx, config.MemgraphURI, config.MemgraphUser, config.MemgraphPassword)
		if err == nil {
			if attempt > 1 {
				logger.InfoContext(
					ctx,
					"memgraph connectivity ready",
					"operation", "devkit_mcp.memgraph_connect",
					"component", "graphrag-mcp-devkit",
					"attempt", attempt,
					"status", "success",
				)
			}
			return runner, nil
		}
		lastErr = err
		if attempt == attempts {
			break
		}
		logger.WarnContext(
			ctx,
			"memgraph connectivity not ready",
			"operation", "devkit_mcp.memgraph_connect",
			"component", "graphrag-mcp-devkit",
			"attempt", attempt,
			"status", "retrying",
			"error", err,
		)
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			return nil, fmt.Errorf("wait for memgraph connectivity uri=%s: %w", config.MemgraphURI, ctx.Err())
		case <-timer.C:
		}
	}
	return nil, fmt.Errorf("connect memgraph after %d attempts uri=%s: %w", attempts, config.MemgraphURI, lastErr)
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
