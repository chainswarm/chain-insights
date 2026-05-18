const require_chunk = require("./chunk-CZWwpsFl.cjs");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_os = require("node:os");
node_os = require_chunk.__toESM(node_os, 1);
let zod = require("zod");
zod = require_chunk.__toESM(zod, 1);
//#region src/config/schema.ts
var schema_exports = /* @__PURE__ */ require_chunk.__exportAll({
	CONFIG_KEYS: () => CONFIG_KEYS,
	ConfigSchema: () => ConfigSchema,
	DEFAULT_CONFIG: () => DEFAULT_CONFIG
});
const ConfigSchema = zod.object({
	mcpEndpoint: zod.string().url().default("http://localhost:4000"),
	mcpAuthToken: zod.string().optional(),
	graphMcpEndpoint: zod.string().default("https://staging-mcp.chain-insights.ai/mcp"),
	graphMcpAuthToken: zod.string().optional(),
	graphMcpMode: zod.enum(["paid", "debug"]).default("paid"),
	walletAddress: zod.string().optional(),
	serverPort: zod.number().int().min(1024).max(65535).default(4321),
	dataDir: zod.string().default(node_path.default.join(node_os.default.homedir(), ".chain-insights")),
	version: zod.string().default("1")
});
const DEFAULT_CONFIG = ConfigSchema.parse({});
const CONFIG_KEYS = [
	"mcpEndpoint",
	"mcpAuthToken",
	"graphMcpEndpoint",
	"graphMcpAuthToken",
	"graphMcpMode",
	"walletAddress",
	"serverPort",
	"dataDir",
	"version"
];
//#endregion
Object.defineProperty(exports, "ConfigSchema", {
	enumerable: true,
	get: function() {
		return ConfigSchema;
	}
});
Object.defineProperty(exports, "DEFAULT_CONFIG", {
	enumerable: true,
	get: function() {
		return DEFAULT_CONFIG;
	}
});
Object.defineProperty(exports, "schema_exports", {
	enumerable: true,
	get: function() {
		return schema_exports;
	}
});
