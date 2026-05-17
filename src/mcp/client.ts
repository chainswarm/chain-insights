import { wrapFetchWithPaymentFromConfig } from '@x402/fetch'
import { ExactEvmScheme } from '@x402/evm'
import { UptoEvmScheme } from '@x402/evm/upto/client'
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

function describePaymentRequiredResponse(response: Response, payerAddress?: string): string {
  const encoded = response.headers.get('payment-required')
  if (!encoded) return 'x402 payment failed: payment_required'

  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8')
    const parsed = JSON.parse(decoded) as {
      error?: unknown
      accepts?: Array<{ scheme?: unknown; network?: unknown; amount?: unknown; payTo?: unknown }>
    }
    const reason = typeof parsed.error === 'string' && parsed.error.trim() ? parsed.error.trim() : 'payment_required'
    const firstRequirement = Array.isArray(parsed.accepts) ? parsed.accepts[0] : undefined
    const payTo = typeof firstRequirement?.payTo === 'string' ? firstRequirement.payTo.trim() : ''
    if (payerAddress && payTo && payerAddress.toLowerCase() === payTo.toLowerCase()) {
      return 'Local payment wallet matches the MCP payTo address. Configure a separate payer wallet with USDC on Base; do not use the service recipient wallet as the client payment wallet.'
    }
    const details = [
      typeof firstRequirement?.scheme === 'string' ? `scheme=${firstRequirement.scheme}` : undefined,
      typeof firstRequirement?.network === 'string' ? `network=${firstRequirement.network}` : undefined,
      typeof firstRequirement?.amount === 'string' ? `amount=${firstRequirement.amount}` : undefined,
    ].filter(Boolean).join(' ')
    return details ? `x402 payment failed: ${reason} (${details})` : `x402 payment failed: ${reason}`
  } catch {
    return 'x402 payment failed: payment_required'
  }
}

function createPaymentFailureReportingFetch(baseFetch: FetchLike, payerAddress?: string): FetchLike {
  const reportingFetch = (async (input: FetchInput, init?: FetchInit) => {
    const response = await baseFetch(input, init)
    if (response.status !== 402) return response
    throw new Error(describePaymentRequiredResponse(response, payerAddress))
  }) as FetchLike
  return Object.assign(reportingFetch, baseFetch)
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
        network: 'eip155:8453', // Base Mainnet — dynamic MCP pricing uses the x402 upto scheme
        client: new UptoEvmScheme(account),
      },
      {
        network: 'eip155:8453', // Base Mainnet — only supported chain in v1
        client: new ExactEvmScheme(account),
      },
    ],
  })
  const reportingFetch = createPaymentFailureReportingFetch(paymentFetch, account.address)
  return authToken ? createHeaderFetch(authToken, reportingFetch) : reportingFetch
}

/**
 * Creates a bearer/debug-token fetch for local Graph MCP testing.
 *
 * The public x402 debug bypass expects X-MCP-Debug-Token.
 * Private endpoints commonly expect Authorization: Bearer <token>.
 * Sending both lets one config value work for public debug and private M2M endpoints.
 */
export function createMcpAuthFetchClient(authToken: string, baseFetch: FetchLike = fetch): FetchLike {
  return createHeaderFetch(authToken, baseFetch)
}

export function resolveGraphMcpEndpoint(config: Pick<InvestigatorConfig, 'graphMcpEndpoint' | 'mcpEndpoint'>): string {
  const graphEndpoint = config.graphMcpEndpoint?.trim()
  return graphEndpoint || config.mcpEndpoint
}

async function createConfiguredFetchWithToken(
  authToken: string | undefined,
  missingTokenName: string,
): Promise<FetchLike> {
  const normalizedAuthToken = authToken?.trim()
  if (normalizedAuthToken) return createMcpAuthFetchClient(normalizedAuthToken)

  const { isWalletConfigured, decryptKey } = await import('../wallet/index.js')
  if (!(await isWalletConfigured())) {
    throw new Error(
      `Wallet not configured and ${missingTokenName} is empty. ` +
      `Run \`chain-insights config set ${missingTokenName} <token>\` for local MCP debug bypass, ` +
      'or `chain-insights config set walletPrivateKey <key>` to enable paid x402 MCP calls.',
    )
  }

  const privateKey = await decryptKey()
  return createMcpFetchClient(privateKey as `0x${string}`)
}

export async function createConfiguredMcpFetch(config: Pick<InvestigatorConfig, 'mcpAuthToken'>): Promise<FetchLike> {
  return createConfiguredFetchWithToken(config.mcpAuthToken, 'mcpAuthToken')
}

export async function createConfiguredGraphMcpFetch(
  config: Pick<InvestigatorConfig, 'mcpAuthToken' | 'graphMcpAuthToken' | 'graphMcpMode'>,
): Promise<FetchLike> {
  if (config.graphMcpMode === 'debug') {
    const authToken = config.graphMcpAuthToken?.trim() || config.mcpAuthToken?.trim()
    if (!authToken) {
      throw new Error('Graph MCP debug mode requires graphMcpAuthToken. Run `cia debug on --token <token>`.')
    }
    return createMcpAuthFetchClient(authToken)
  }

  return createConfiguredFetchWithToken(undefined, 'walletPrivateKey')
}
