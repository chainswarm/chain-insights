package devkitmcp

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"
)

func TestNewMemgraphRunnerWithRetryRetriesUntilConnectivitySucceeds(t *testing.T) {
	attempts := 0
	runner, err := newMemgraphRunnerWithRetry(
		context.Background(),
		Config{MemgraphURI: "bolt://memgql:7688"},
		RetryConfig{Attempts: 3, Delay: 0},
		slog.Default(),
		func(context.Context, string, string, string) (*MemgraphRunner, error) {
			attempts++
			if attempts < 3 {
				return nil, errors.New("not ready")
			}
			return &MemgraphRunner{}, nil
		},
	)
	if err != nil {
		t.Fatalf("expected retry to succeed: %v", err)
	}
	if runner == nil {
		t.Fatal("expected runner")
	}
	if attempts != 3 {
		t.Fatalf("attempts mismatch: got %d want 3", attempts)
	}
}

func TestNewMemgraphRunnerWithRetryStopsWhenContextIsCanceled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	attempts := 0
	_, err := newMemgraphRunnerWithRetry(
		ctx,
		Config{MemgraphURI: "bolt://memgql:7688"},
		RetryConfig{Attempts: 3, Delay: time.Second},
		slog.Default(),
		func(context.Context, string, string, string) (*MemgraphRunner, error) {
			attempts++
			return nil, errors.New("not ready")
		},
	)
	if err == nil {
		t.Fatal("expected canceled context error")
	}
	if attempts != 0 {
		t.Fatalf("factory should not run after cancellation, got attempts=%d", attempts)
	}
}
