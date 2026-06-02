import { t as __exportAll } from "./rolldown-runtime-D7D4PA-g.mjs";
import { i as validateMcpEndpoint, n as LOCAL_LEGACY_MCP_ENDPOINT, t as LOCAL_GRAPH_MCP_ENDPOINT } from "./mcp-endpoint-QQ5Lbqc2.mjs";
import path from "node:path";
import os from "node:os";
import * as z from "zod";
//#region src/config/schema.ts
var schema_exports = /* @__PURE__ */ __exportAll({
	CONFIG_KEYS: () => CONFIG_KEYS,
	ConfigSchema: () => ConfigSchema,
	DEFAULT_CONFIG: () => DEFAULT_CONFIG,
	parseInvestigatorConfig: () => parseInvestigatorConfig
});
function endpointSchema(key) {
	return z.string().transform((value, ctx) => {
		try {
			return validateMcpEndpoint(value, key);
		} catch (err) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: err.message
			});
			return z.NEVER;
		}
	});
}
const ConfigSchema = z.object({
	mcpEndpoint: endpointSchema("mcpEndpoint").default(LOCAL_LEGACY_MCP_ENDPOINT),
	mcpAuthToken: z.string().optional(),
	graphMcpEndpoint: endpointSchema("graphMcpEndpoint").default(LOCAL_GRAPH_MCP_ENDPOINT),
	graphMcpAuthToken: z.string().optional(),
	graphMcpMode: z.enum(["paid", "debug"]).default("paid"),
	walletAddress: z.string().optional(),
	serverPort: z.number().int().min(1024).max(65535).default(4321),
	dataDir: z.string().default(path.join(os.homedir(), ".chain-insights")),
	version: z.string().default("1")
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
export { parseInvestigatorConfig as n, schema_exports as r, DEFAULT_CONFIG as t };

//# sourceMappingURL=schema-D_qwaQA5.mjs.map