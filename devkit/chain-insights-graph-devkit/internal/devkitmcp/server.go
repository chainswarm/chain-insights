package devkitmcp

import (
	"encoding/json"
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func Serve(config Config, runner QueryRunner) error {
	return http.ListenAndServe(config.ListenAddress, NewHTTPHandler(runner))
}

func NewHTTPHandler(runner QueryRunner) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/metadata/networks", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(NetworkDocument())
	})
	mux.Handle("/mcp", mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server {
		return NewMCPServer(runner)
	}, &mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true}))
	return mux
}

func NewMCPServer(runner QueryRunner) *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{Name: "chain-insights-graph-devkit", Version: "0.1.0"}, nil)
	RegisterTools(server, runner)
	return server
}
