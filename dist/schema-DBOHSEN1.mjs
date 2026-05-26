import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import path from "node:path";
import os from "node:os";
import * as z from "zod";
//#region src/config/schema.ts
var schema_exports = /* @__PURE__ */ __exportAll({
	CONFIG_KEYS: () => CONFIG_KEYS,
	ConfigSchema: () => ConfigSchema,
	DEFAULT_CONFIG: () => DEFAULT_CONFIG
});
const ConfigSchema = z.object({
	mcpEndpoint: z.string().url().default("http://localhost:4000"),
	mcpAuthToken: z.string().optional(),
	graphMcpEndpoint: z.string().default(process.env.GRAPH_MCP_ENDPOINT ?? "https://staging-mcp.chain-insights.ai/mcp"),
	graphMcpAuthToken: z.string().optional(),
	graphMcpMode: z.enum(["paid", "debug"]).default("paid"),
	walletAddress: z.string().optional(),
	serverPort: z.number().int().min(1024).max(65535).default(4321),
	dataDir: z.string().default(path.join(os.homedir(), ".chain-insights")),
	version: z.string().default("1")
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
export { DEFAULT_CONFIG as n, schema_exports as r, ConfigSchema as t };

//# sourceMappingURL=schema-DBOHSEN1.mjs.map