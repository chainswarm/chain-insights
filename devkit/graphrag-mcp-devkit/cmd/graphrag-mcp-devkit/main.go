package main

import (
	"encoding/json"
	"net/http"

	"github.com/chainswarm/chain-insights/devkit/graphrag-mcp-devkit/internal/devkitmcp"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/metadata/networks", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(devkitmcp.NetworkDocument())
	})
	_ = http.ListenAndServe(":8012", mux)
}
