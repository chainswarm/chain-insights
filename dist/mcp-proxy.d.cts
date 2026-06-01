//#region src/mcp/proxy.d.ts
type McpProxyMode = 'workspace' | 'stateless';
declare function resolveMcpProxyMode(env?: NodeJS.ProcessEnv): McpProxyMode;
/**
 * Core proxy logic — exported so tests can inject dependencies directly.
 * The IIFE at the bottom calls this with real dependencies.
 *
 * stdout purity: NEVER write to stdout in this file. Use console.error() or process.stderr.write() only.
 * All diagnostic output goes to console.error() or process.stderr.write().
 */
declare function createProxy(): Promise<void>;
//#endregion
export { McpProxyMode, createProxy, resolveMcpProxyMode };
//# sourceMappingURL=mcp-proxy.d.cts.map