// Public API surface for programmatic use.
// CLI users go through bin/cli.js → dist/cli.js.
export { loadConfig, saveConfig, resetConfigCache } from './config/index.js'
export type { InvestigatorConfig } from './config/schema.js'
export {
  encryptKey,
  decryptKey,
  isWalletConfigured,
  normalizeWalletPrivateKey,
  setWalletPrivateKey,
  walletAddressFromPrivateKey,
} from './wallet/index.js'
export {
  formatWalletBackupWarning,
  generateWalletPrivateKey,
  isWalletBackupConfirmed,
} from './wallet/create.js'
export {
  buildTopupInfo,
  formatWalletBalance,
  formatWalletBalanceResult,
  getBalanceEth,
  getBalanceUsdc,
  getWalletAccount,
  getWalletBalanceResult,
  getWalletBalanceText,
} from './wallet/tools.js'
export { generateArtifactHtml, getTopupUrl, startTopupServer } from './wallet/topup-server.js'
export { createMcpFetchClient } from './mcp/client.js'
