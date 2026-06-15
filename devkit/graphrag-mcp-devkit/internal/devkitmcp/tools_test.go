package devkitmcp

import (
	"reflect"
	"testing"
)

func TestToolNames(t *testing.T) {
	t.Parallel()

	got := ToolNames()
	want := []string{"network_capabilities", "graph_query", "graph_query_batch"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("tool names mismatch: got %v want %v", got, want)
	}
}

func TestNetworkDocument(t *testing.T) {
	t.Parallel()

	doc := NetworkDocument()
	if len(doc.Networks) != 1 {
		t.Fatalf("network count = %d, want 1", len(doc.Networks))
	}
	network := doc.Networks[0]
	if network.Network != "bittensor" {
		t.Fatalf("network = %q, want bittensor", network.Network)
	}
	if network.FixtureWindow != "genesis..2025-12-31" {
		t.Fatalf("fixture window = %q", network.FixtureWindow)
	}
	for _, tool := range ToolNames() {
		if network.Tools[tool] != "available" {
			t.Fatalf("tool %s not available in network document", tool)
		}
	}
}
