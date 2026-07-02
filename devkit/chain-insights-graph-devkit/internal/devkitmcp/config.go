package devkitmcp

import "os"

type Config struct {
	ListenAddress    string
	MemgraphURI      string
	MemgraphUser     string
	MemgraphPassword string
}

func ConfigFromEnvironment() Config {
	return Config{
		ListenAddress:    getenv("DEVKIT_MCP_LISTEN_ADDRESS", ":8012"),
		MemgraphURI:      getenv("MEMGQL_BOLT_URI", "bolt://memgql:7687"),
		MemgraphUser:     os.Getenv("MEMGQL_BOLT_USER"),
		MemgraphPassword: os.Getenv("MEMGQL_BOLT_PASSWORD"),
	}
}

func getenv(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
