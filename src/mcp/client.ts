import { wrapFetchWithPaymentFromConfig } from '@x402/fetch'
import { ExactEvmScheme } from '@x402/evm'
import { privateKeyToAccount } from 'viem/accounts'
import type { InvestigatorConfig } from '../config/schema.js'

type FetchLike = typeof fetch
type FetchInput = Parameters<FetchLike>[0]
type FetchInit = Parameters<FetchLike>[1]

function createHeaderFetch(authToken: string, baseFetch: FetchLike): FetchLike {
  return (async (input: FetchInput, init?: FetchInit) => {
    const requestHeaders = input instanceof Request ? input.headers : undefined
    const headers = new Headers(init?.headers ?? requestHeaders)
    headers.set('X-MCP-Debug-Token', authToken)
    headers.set('Authorization', `Bearer ${authToken}`)

    return baseFetch(input, {
      ...init,
      headers,
    })
  }) as FetchLike
}

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
export function createMcpFetchClient(privateKey: `0x${string}`, authToken?: string) {
  const account = privateKeyToAccount(privateKey)
  const paymentFetch = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [
      {
        network: 'eip155:8453', // Base Mainnet — only supported chain in v1
        client: new ExactEvmScheme(account),
      },
    ],
  })
  return authToken ? createHeaderFetch(authToken, paymentFetch) : paymentFetch
}

/**
 * Creates a bearer/debug-token fetch for local GraphRAG MCP testing.
 *
 * GraphRAG public x402 debug bypass expects X-MCP-Debug-Token.
 * The private endpoint expects Authorization: Bearer <token>.
 * Sending both lets one config value work for public debug and private M2M endpoints.
 */
export function createMcpAuthFetchClient(authToken: string, baseFetch: FetchLike = fetch): FetchLike {
  return createHeaderFetch(authToken, baseFetch)
}

export async function createConfiguredMcpFetch(config: Pick<InvestigatorConfig, 'mcpAuthToken'>): Promise<FetchLike> {
  const authToken = config.mcpAuthToken?.trim()
  if (authToken) return createMcpAuthFetchClient(authToken)

  const { isWalletConfigured, decryptKey } = await import('../wallet/index.js')
  if (!(await isWalletConfigured())) {
    throw new Error(
      'Wallet not configured and mcpAuthToken is empty. ' +
      'Run `chain-insights config set mcpAuthToken <token>` for local GraphRAG debug bypass, ' +
      'or `chain-insights config set walletPrivateKey <key>` to enable paid x402 MCP calls.',
    )
  }

  const privateKey = await decryptKey()
  return createMcpFetchClient(privateKey as `0x${string}`)
}
