import { wrapFetchWithPaymentFromConfig } from '@x402/fetch'
import { ExactEvmScheme } from '@x402/evm'
import { UptoEvmScheme } from '@x402/evm/upto/client'
import { privateKeyToAccount } from 'viem/accounts'
import type { InvestigatorConfig } from '../config/schema.js'
import { prepareWalletForPaidCalls } from '../wallet/tools.js'

type FetchLike = typeof fetch
type FetchInput = Parameters<FetchLike>[0]
type FetchInit = Parameters<FetchLike>[1]

export class PaymentRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentRequiredError'
  }
}

export function applyMcpAuthHeaders(headers: Headers, authToken: string): Headers {
  headers.set('X-MCP-Debug-Token', authToken)
  headers.set('X-MCP-Test-Key', authToken)
  headers.set('X-Chain-Insights-Test-Key', authToken)
  headers.set('Authorization', `Bearer ${authToken}`)
  return headers
}

function createHeaderFetch(authToken: string, baseFetch: FetchLike): FetchLike {
  return (async (input: FetchInput, init?: FetchInit) => {
    const requestHeaders = input instanceof Request ? input.headers : undefined
    const headers = new Headers(init?.headers ?? requestHeaders)
    applyMcpAuthHeaders(headers, authToken)

    return baseFetch(input, {
      ...init,
      headers,
    })
  }) as FetchLike
}

export const PAYMENT_NEXT_STEPS =
  'Next steps: run `chain-insights wallet ready` to check funding and finish one-time payment setup, ' +
  'run `chain-insights wallet topup` if it says the wallet needs USDC, ' +
  'or `chain-insights access-key set <key>` if you have been given test access.'

interface PaymentRequirementDetails {
  reason: string
  scheme?: string
  network?: string
  amount?: string
  amountUnits?: bigint
  payTo?: string
}

function paymentRequirementFromResponse(response: Response): PaymentRequirementDetails | null {
  const encoded = response.headers.get('payment-required')
  if (!encoded) return null

  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8')
    const parsed = JSON.parse(decoded) as {
      error?: unknown
      accepts?: Array<{ scheme?: unknown; network?: unknown; amount?: unknown; payTo?: unknown }>
    }
    const reason = typeof parsed.error === 'string' && parsed.error.trim() ? parsed.error.trim() : 'payment_required'
    const firstRequirement = Array.isArray(parsed.accepts) ? parsed.accepts[0] : undefined
    const amount = typeof firstRequirement?.amount === 'string' ? firstRequirement.amount.trim() : undefined
    return {
      reason,
      scheme: typeof firstRequirement?.scheme === 'string' ? firstRequirement.scheme : undefined,
      network: typeof firstRequirement?.network === 'string' ? firstRequirement.network : undefined,
      amount,
      amountUnits: amount && /^\d+$/.test(amount) ? BigInt(amount) : undefined,
      payTo: typeof firstRequirement?.payTo === 'string' ? firstRequirement.payTo.trim() : undefined,
    }
  } catch {
    return null
  }
}

function describePaymentRequiredResponse(response: Response, payerAddress?: string): string {
  const requirement = paymentRequirementFromResponse(response)
  if (!requirement) return `Payment required — this tool costs USDC on Base via x402 micropayments. ${PAYMENT_NEXT_STEPS}`

  try {
    const { reason, payTo } = requirement
    if (payerAddress && payTo && payerAddress.toLowerCase() === payTo.toLowerCase()) {
      return 'Local payment wallet matches the MCP payTo address. Configure a separate payer wallet with USDC on Base; do not use the service recipient wallet as the client payment wallet.'
    }
    const details = [
      requirement.scheme ? `scheme=${requirement.scheme}` : undefined,
      requirement.network ? `network=${requirement.network}` : undefined,
      requirement.amount ? `amount=${requirement.amount}` : undefined,
    ].filter(Boolean).join(' ')
    const message = details ? `x402 payment failed: ${reason} (${details})` : `x402 payment failed: ${reason}`
    if (reason.includes('allowance_required')) {
      return `${message}. The payment wallet needs one-time setup before paid MCP calls can settle. Run \`chain-insights wallet ready\`; Base ETH is used for the setup gas.`
    }
    if (reason === 'payment_required') {
      return `${message}. ${PAYMENT_NEXT_STEPS}`
    }
    return `${message}. ${PAYMENT_NEXT_STEPS}`
  } catch {
    return `Payment required — this tool costs USDC on Base via x402 micropayments. ${PAYMENT_NEXT_STEPS}`
  }
}

function createPaymentFailureReportingFetch(
  baseFetch: FetchLike,
  payerAddress?: string,
  paymentWallet?: { address: `0x${string}`; privateKey: `0x${string}` },
): FetchLike {
  const reportingFetch = (async (input: FetchInput, init?: FetchInit) => {
    const response = await baseFetch(input, init)
    if (response.status !== 402) return response
    const requirement = paymentRequirementFromResponse(response)
    if (paymentWallet && requirement?.reason.includes('allowance_required')) {
      try {
        await prepareWalletForPaidCalls({
          account: paymentWallet,
          ...(requirement.amountUnits === undefined ? {} : { minimumApprovalUnits: requirement.amountUnits }),
        })
      } catch (err) {
        throw new PaymentRequiredError(
          'Payment setup is not ready yet. Run `chain-insights wallet ready` and try again. ' +
          `${(err as Error).message}`,
        )
      }
      const retryResponse = await baseFetch(input, init)
      if (retryResponse.status !== 402) return retryResponse
      throw new PaymentRequiredError(describePaymentRequiredResponse(retryResponse, payerAddress))
    }
    throw new PaymentRequiredError(describePaymentRequiredResponse(response, payerAddress))
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
  const reportingFetch = createPaymentFailureReportingFetch(
    paymentFetch,
    account.address,
    { address: account.address, privateKey },
  )
  return authToken ? createHeaderFetch(authToken, reportingFetch) : reportingFetch
}

/**
 * Creates a bearer/debug-token fetch for local Chain Insights Graph testing.
 *
 * Chain Insights Graph deployments accept test access through the public debug header,
 * staging test-key headers, or Authorization: Bearer depending on the route.
 * Sending all supported auth headers lets one config value work across hosted
 * MCP calls, metadata reads, and private M2M endpoints.
 *
 * Wraps with 402 interception so that if the server still requires payment
 * (e.g. token not accepted for paid tools), the user sees actionable guidance
 * instead of a generic transport error.
 */
export function createMcpAuthFetchClient(authToken: string, baseFetch: FetchLike = fetch): FetchLike {
  const headerFetch = createHeaderFetch(authToken, baseFetch)
  return createPaymentFailureReportingFetch(headerFetch)
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
      'Hosted access is not configured. ' +
      'Run `chain-insights access-key set <key>` for invited test access. ' +
      'For wallet-paid access, run `chain-insights wallet import <private-key>` once, then run `chain-insights wallet ready`; ' +
      'run `chain-insights wallet topup` if it says the wallet needs funds.',
    )
  }

  const privateKey = await decryptKey()
  return createMcpFetchClient(privateKey as `0x${string}`)
}

async function createConfiguredGraphPaidOrFreeFetch(): Promise<FetchLike> {
  const { isWalletConfigured, decryptKey } = await import('../wallet/index.js')
  if (!(await isWalletConfigured())) {
    return createPaymentFailureReportingFetch(fetch)
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
      throw new Error('Chain Insights Graph debug mode requires graphMcpAuthToken. Run `cia access-key set <key>` or `cia debug on --token <token>`.')
    }
    return createMcpAuthFetchClient(authToken)
  }

  return createConfiguredGraphPaidOrFreeFetch()
}
