import { wrapFetchWithPaymentFromConfig } from '@x402/fetch'
import { ExactEvmScheme } from '@x402/evm'
import { privateKeyToAccount } from 'viem/accounts'

/**
 * Creates an x402-payment-wrapped fetch function for the Chain Insights MCP.
 * Payments are made in USDC on Base Mainnet (eip155:8453).
 *
 * The factory is pure — no side effects, no state, no caching.
 * If called with an invalid private key format, viem throws — the error propagates.
 *
 * @param privateKey - 0x-prefixed EVM private key (decrypted from wallet.json)
 * @returns A fetch-compatible function that auto-handles HTTP 402 payment challenges
 */
export function createMcpFetchClient(privateKey: `0x${string}`) {
  const account = privateKeyToAccount(privateKey)
  return wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [
      {
        network: 'eip155:8453', // Base Mainnet — only supported chain in v1
        client: new ExactEvmScheme(account),
      },
    ],
  })
}
