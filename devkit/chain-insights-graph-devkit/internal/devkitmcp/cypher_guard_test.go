package devkitmcp

import "testing"

func TestValidateReadOnlyQuery(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		query   string
		wantErr bool
	}{
		{name: "read", query: "USE live_topology MATCH (i:Identity) RETURN i LIMIT 1"},
		{name: "empty", query: "  ", wantErr: true},
		{name: "write", query: "MATCH (i) DELETE i", wantErr: true},
		{name: "catalog", query: "DROP GRAPH live_topology", wantErr: true},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			err := ValidateReadOnlyQuery(test.query)
			if test.wantErr && err == nil {
				t.Fatalf("expected error")
			}
			if !test.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}
