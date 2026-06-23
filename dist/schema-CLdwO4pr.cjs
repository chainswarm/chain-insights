const require_chunk = require("./chunk-CZWwpsFl.cjs");
const require_mcp_endpoint = require("./mcp-endpoint-Bt3atBRW.cjs");
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
	DEFAULT_CONFIG: () => DEFAULT_CONFIG,
	parseInvestigatorConfig: () => parseInvestigatorConfig
});
function endpointSchema(key) {
	return zod.string().transform((value, ctx) => {
		try {
			return require_mcp_endpoint.validateMcpEndpoint(value, key);
		} catch (err) {
			ctx.addIssue({
				code: zod.ZodIssueCode.custom,
				message: err.message
			});
			return zod.NEVER;
		}
	});
}
const ConfigSchema = zod.object({
	mcpEndpoint: endpointSchema("mcpEndpoint").default(require_mcp_endpoint.LOCAL_LEGACY_MCP_ENDPOINT),
	mcpAuthToken: zod.string().optional(),
	graphMcpEndpoint: endpointSchema("graphMcpEndpoint").default(require_mcp_endpoint.LOCAL_GRAPH_MCP_ENDPOINT),
	graphMcpAuthToken: zod.string().optional(),
	graphMcpMode: zod.enum(["paid", "debug"]).default("paid"),
	walletAddress: zod.string().optional(),
	serverPort: zod.number().int().min(1024).max(65535).default(4321),
	dataDir: zod.string().default(node_path.default.join(node_os.default.homedir(), ".chain-insights")),
	version: zod.string().default("1")
});
function formatConfigValidationError(error) {
	return error.issues.map((issue) => issue.message).join("\n");
}
function parseInvestigatorConfig(input) {
	const parsed = ConfigSchema.safeParse(input);
	if (parsed.success) return parsed.data;
	throw new Error(formatConfigValidationError(parsed.error));
}
const DEFAULT_CONFIG = parseInvestigatorConfig({});
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
Object.defineProperty(exports, "DEFAULT_CONFIG", {
	enumerable: true,
	get: function() {
		return DEFAULT_CONFIG;
	}
});
Object.defineProperty(exports, "parseInvestigatorConfig", {
	enumerable: true,
	get: function() {
		return parseInvestigatorConfig;
	}
});
Object.defineProperty(exports, "schema_exports", {
	enumerable: true,
	get: function() {
		return schema_exports;
	}
});
