package main

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/chainswarm/chain-insights/devkit/chain-insights-graph-devkit/internal/devkitmcp"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	config := devkitmcp.ConfigFromEnvironment()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	runner, err := devkitmcp.NewMemgraphRunnerWithRetry(
		ctx,
		config,
		devkitmcp.RetryConfig{Attempts: 60, Delay: 2 * time.Second},
		logger,
	)
	if err != nil {
		logger.Error("devkit mcp startup failed", "operation", "devkit_mcp.start", "error", err)
		os.Exit(1)
	}
	defer runner.Close(context.Background())

	// facts runs directly against StarRocks via the translator (MemGQL
	// retired); topology stays on Memgraph.
	starRocks, err := devkitmcp.NewStarRocksRunner(config)
	if err != nil {
		logger.Error("devkit starrocks init failed", "operation", "devkit_mcp.start", "error", err)
		os.Exit(1)
	}
	defer starRocks.Close()
	dispatch := devkitmcp.NewDispatchRunner(runner, starRocks)

	logger.Info("devkit mcp listening", "operation", "devkit_mcp.start", "address", config.ListenAddress)
	if err := devkitmcp.Serve(config, dispatch); err != nil {
		logger.Error("devkit mcp stopped", "operation", "devkit_mcp.serve", "error", err)
		os.Exit(1)
	}
}
