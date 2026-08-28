package devkitmcp

import (
	"os"
	"strconv"
)

type Config struct {
	ListenAddress    string
	MemgraphURI      string
	MemgraphUser     string
	MemgraphPassword string
	// StarRocks warehouse for the facts scope, which runs directly against
	// StarRocks via the corpus-scoped translator (the devkit mirrors the
	// production graphrag-mcp two-scope model; MemGQL is retired).
	StarRocksHost     string
	StarRocksPort     int
	StarRocksUser     string
	StarRocksPassword string
	StarRocksDatabase string
	// FactsRecencyWindowDays is the recency-window floor auto-applied to
	// address-kind facts queries (spec D2): the compiled SQL gains a bare
	// `block_date >= now - window` bound. Mirrors the production config key
	// FACTS_RECENCY_WINDOW_DAYS, default 90. Zero/negative is rejected at
	// runner construction — a disabled floor would silently restore
	// full-history scans.
	FactsRecencyWindowDays int
}

func ConfigFromEnvironment() Config {
	return Config{
		ListenAddress: getenv("DEVKIT_MCP_LISTEN_ADDRESS", ":8012"),
		// MEMGRAPH_BOLT_URI preferred; MEMGQL_BOLT_URI dual-read one wave.
		MemgraphURI:       firstEnv("MEMGRAPH_BOLT_URI", "MEMGQL_BOLT_URI", "bolt://memgraph:7687"),
		MemgraphUser:      firstEnvNoDefault("MEMGRAPH_BOLT_USER", "MEMGQL_BOLT_USER"),
		MemgraphPassword:  firstEnvNoDefault("MEMGRAPH_BOLT_PASSWORD", "MEMGQL_BOLT_PASSWORD"),
		StarRocksHost:     getenv("STARROCKS_HOST", "starrocks"),
		StarRocksPort:     getenvInt("STARROCKS_PORT", 9030),
		StarRocksUser:     getenv("STARROCKS_USER", "root"),
		StarRocksPassword: os.Getenv("STARROCKS_PASSWORD"),
		StarRocksDatabase: getenv("STARROCKS_DATABASE", "bittensor"),
		// non-numeric falls back to 90 (getenvInt's contract); zero/negative
		// is rejected at NewStarRocksRunner.
		FactsRecencyWindowDays: getenvInt("FACTS_RECENCY_WINDOW_DAYS", 90),
	}
}

func getenv(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func getenvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

// firstEnv returns the first non-empty env var, else the fallback.
func firstEnv(preferred, deprecated, fallback string) string {
	if v := os.Getenv(preferred); v != "" {
		return v
	}
	if v := os.Getenv(deprecated); v != "" {
		return v
	}
	return fallback
}

func firstEnvNoDefault(preferred, deprecated string) string {
	if v := os.Getenv(preferred); v != "" {
		return v
	}
	return os.Getenv(deprecated)
}
