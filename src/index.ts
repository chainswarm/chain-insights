// Public API surface for programmatic use.
// CLI users go through bin/cli.js → dist/cli.js.
export { loadConfig, saveConfig, resetConfigCache } from './config/index.js'
export { createApp } from './server/app.js'
export { startServer } from './server/index.js'
export type { InvestigatorConfig } from './config/schema.js'
export { encryptKey, decryptKey, isWalletConfigured } from './wallet/index.js'
export {
  buildTopupInfo,
  formatWalletBalance,
  getBalanceUsdc,
  getWalletAccount,
  getWalletBalanceText,
} from './wallet/tools.js'
export { generateArtifactHtml, getTopupUrl, startTopupServer } from './wallet/topup-server.js'
export { createMcpFetchClient } from './mcp/client.js'
export { generateVisualization } from './viz/index.js'
export type { GraphDataType, GraphNodeType, GraphEdgeType } from './viz/index.js'
