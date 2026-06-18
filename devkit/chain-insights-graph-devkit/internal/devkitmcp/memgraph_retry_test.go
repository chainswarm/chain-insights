package devkitmcp

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j/db"
)

func TestRecordRowToleratesMismatchedKeysAndValues(t *testing.T) {
	row, err := recordRow(&db.Record{
		Keys:   []string{"row_count", "extra"},
		Values: []any{1},
	})
	if err != nil {
		t.Fatalf("expected mismatched record to map without panic: %v", err)
	}
	if row["row_count"] != 1 {
		t.Fatalf("row_count = %#v, want 1", row["row_count"])
	}
	if row["extra"] != nil {
		t.Fatalf("extra = %#v, want nil", row["extra"])
	}
}

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
