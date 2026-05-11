// Public API surface for programmatic use.
// CLI users go through bin/cli.js → dist/cli.js.
export { loadConfig, saveConfig, resetConfigCache } from './config/index.js'
export { getDb, initSchema, healthCheck } from './db/index.js'
export { createApp } from './server/app.js'
export { startServer } from './server/index.js'
export type { InvestigatorConfig } from './config/schema.js'
export { encryptKey, decryptKey, isWalletConfigured } from './wallet/index.js'
export { createMcpFetchClient } from './mcp/client.js'
