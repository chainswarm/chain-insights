import {
  generateArtifactHtml,
  getTopupUrl,
  startTopupServer as startCopiedTopupServer,
} from './mcp-proxy/topup-server.js'
import type { WalletData } from './mcp-proxy/types.js'
import type { PaymentWalletAccount } from './tools.js'

const FALLBACK_PRIVATE_KEY = '0x0000000000000000000000000000000000000000000000000000000000000001'

function toWalletData(account: PaymentWalletAccount | string): WalletData {
  if (typeof account === 'string') {
    return {
      address: account,
      privateKey: FALLBACK_PRIVATE_KEY,
      createdAt: new Date(0).toISOString(),
    }
  }

  return {
    address: account.address,
    privateKey: account.privateKey,
    createdAt: new Date(0).toISOString(),
  }
}

export { generateArtifactHtml, getTopupUrl }

export async function startTopupServer(account: PaymentWalletAccount | string): Promise<string> {
  return startCopiedTopupServer(toWalletData(account))
}
