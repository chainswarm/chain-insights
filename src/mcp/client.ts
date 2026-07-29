import { wrapFetchWithPaymentFromConfig } from '@x402/fetch'
import { ExactEvmScheme } from '@x402/evm'
import { UptoEvmScheme, type UptoEvmSchemeConfigByChainId } from '@x402/evm/upto/client'
import { privateKeyToAccount } from 'viem/accounts'
import type { InvestigatorConfig } from '../config/schema.js'
import { prepareWalletForPaidCalls, resolveMaxAutoApprovalUnits, PERMIT2_ADDRESS, USDC_ADDRESS } from '../wallet/tools.js'
import { orderPaymentOptions, KNOWN_PAYMENT_ASSET_SYMBOLS, type PaymentOptionLike } from './payment-asset-preference.js'

type FetchLike = typeof fetch
type FetchInput = Parameters<FetchLike>[0]
type FetchInit = Parameters<FetchLike>[1]

// Robinhood Chain — second EVM network accepted for x402 Permit2 payments
// alongside Base Mainnet. The x402 SDK builds its own bare RPC client per
// chain ID from this config (no viem chain-registry entry is needed: it
// never imports `viem/chains`, it just does `createPublicClient({transport:
// http(rpcUrl)})` keyed by CAIP-2 chain ID).
export const ROBINHOOD_CHAIN_ID = 4663
export const ROBINHOOD_NETWORK = 'eip155:4663'
export const ROBINHOOD_RPC_URL = 'https://rpc.mainnet.chain.robinhood.com'

const EVM_SCHEME_OPTIONS: UptoEvmSchemeConfigByChainId = {
  [ROBINHOOD_CHAIN_ID]: { rpcUrl: ROBINHOOD_RPC_URL },
}

/**
 * Reads the operator's payment-asset preference order (env
 * CHAIN_INSIGHTS_PAYMENT_ASSET_PREFERENCE, comma-separated symbols or
 * addresses). Empty/unset keeps server order.
 */
export function resolvePaymentAssetPreference(env: NodeJS.ProcessEnv = process.env): string {
  return env['CHAIN_INSIGHTS_PAYMENT_ASSET_PREFERENCE']?.trim() ?? ''
}

/**
 * Wraps `fetch` so that a 402 response's `accepts` offers are re-ordered by
 * the operator's payment-asset preference before the x402 client's default
 * selector (which always picks `accepts[0]`) runs. Must wrap the raw
 * transport `fetch` passed into `wrapFetchWithPaymentFromConfig`, not the
 * result of it, since the x402 client parses `accepts` from the first 402
 * response it sees.
 */
function createAssetPreferenceReorderingFetch(baseFetch: FetchLike, preference: string): FetchLike {
  if (!preference) return baseFetch
  return (async (input: FetchInput, init?: FetchInit) => {
    const response = await baseFetch(input, init)
    if (response.status !== 402) return response
    const encoded = response.headers.get('payment-required')
    if (!encoded) return response

    let parsed: { accepts?: PaymentOptionLike[] } & Record<string, unknown>
    try {
      parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
    } catch {
      return response
    }
    if (!Array.isArray(parsed.accepts) || parsed.accepts.length === 0) return response

    const reordered = orderPaymentOptions(parsed.accepts, preference, KNOWN_PAYMENT_ASSET_SYMBOLS)
    const reencoded = Buffer.from(JSON.stringify({ ...parsed, accepts: reordered })).toString('base64')
    const headers = new Headers(response.headers)
    headers.set('payment-required', reencoded)
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }) as FetchLike
}

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
  asset?: string
}

function paymentRequirementFromResponse(response: Response): PaymentRequirementDetails | null {
  const encoded = response.headers.get('payment-required')
  if (!encoded) return null

  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8')
    const parsed = JSON.parse(decoded) as {
      error?: unknown
      accepts?: Array<{ scheme?: unknown; network?: unknown; amount?: unknown; payTo?: unknown; asset?: unknown }>
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
      asset: typeof firstRequirement?.asset === 'string' ? firstRequirement.asset.trim() : undefined,
    }
  } catch {
    return null
  }
}

/**
 * True only for the one combination this client can auto-approve today:
 * USDC on Base, via the existing Base-only `wallet/tools.ts` allowance flow.
 * A requirement with no `asset` at all predates multi-asset 402 offers and
 * is treated as that same legacy USDC-on-Base case.
 */
function isAutoApprovableBaseUsdc(requirement: PaymentRequirementDetails): boolean {
  if (requirement.network !== 'eip155:8453') return false
  if (!requirement.asset) return true
  return requirement.asset.toLowerCase() === USDC_ADDRESS.toLowerCase()
}

/**
 * Clear, actionable error for the case the auto-approval flow does not cover:
 * a Permit2 allowance is missing for a non-Base-USDC asset (e.g. USDG/CHOICE
 * on Robinhood Chain) and the server did not offer a gas-sponsored approval
 * extension. Names the token, the canonical Permit2 address, and the exact
 * approval call so the operator can run it manually.
 */
function describePermit2ApprovalNeededError(requirement: PaymentRequirementDetails): string {
  const token = requirement.asset ?? 'the payment token'
  const networkSuffix = requirement.network ? ` on ${requirement.network}` : ''
  return (
    `Payment requires a one-time Permit2 approval for token ${token}${networkSuffix} before paid calls can settle, ` +
    'and gas-sponsored approval is not available for this asset. ' +
    `Approve the canonical Permit2 contract ${PERMIT2_ADDRESS} to spend ${token} by calling ` +
    `approve(${PERMIT2_ADDRESS}, <amount>) on the token contract, then retry the call.`
  )
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
      if (!isAutoApprovableBaseUsdc(requirement)) {
        throw new PaymentRequiredError(describePermit2ApprovalNeededError(requirement))
      }
      try {
        await prepareWalletForPaidCalls({
          account: paymentWallet,
          // The endpoint dictates requirement.amountUnits; cap it so a hostile
          // endpoint cannot drive an unbounded Permit2 approval / wallet drain.
          maxApprovalUnits: resolveMaxAutoApprovalUnits(),
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
 * Payments are made in USDC on Base Mainnet (eip155:8453) or, when the
 * server offers it and the operator prefers it, a Permit2 asset on
 * Robinhood Chain (eip155:4663) — see ROBINHOOD_NETWORK.
 *
 * The factory is pure — no side effects, no state, no caching.
 * If called with an invalid private key format, viem throws — the error propagates.
 *
 * @param privateKey - 0x-prefixed EVM private key (decrypted from wallet.json)
 * @returns A fetch-compatible function that auto-handles HTTP 402 payment challenges
 */
export function createMcpFetchClient(privateKey: `0x${string}`, authToken?: string) {
  const account = privateKeyToAccount(privateKey)
  // Shared across both networks: EVM_SCHEME_OPTIONS is keyed by chain ID, so
  // it only supplies an RPC URL for Robinhood Chain (4663) and leaves Base
  // (8453) exactly as before (no RPC configured — gas-sponsored approval
  // stays unavailable there too, unchanged from prior behavior).
  const uptoScheme = new UptoEvmScheme(account, EVM_SCHEME_OPTIONS)
  const paymentFetch = wrapFetchWithPaymentFromConfig(
    createAssetPreferenceReorderingFetch(fetch, resolvePaymentAssetPreference()),
    {
      schemes: [
        {
          network: 'eip155:8453', // Base Mainnet — dynamic MCP pricing uses the x402 upto scheme
          client: uptoScheme,
        },
        {
          network: 'eip155:8453', // Base Mainnet — only supported chain in v1
          client: new ExactEvmScheme(account),
        },
        {
          network: ROBINHOOD_NETWORK, // Robinhood Chain — Permit2-only (upto scheme), same client instance
          client: uptoScheme,
        },
      ],
    },
  )
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

export function resolveGraphMcpEndpoint(config: Pick<InvestigatorConfig, 'graphMcpEndpoint'>): string {
  return config.graphMcpEndpoint.trim()
}

async function createConfiguredGraphPaidOrFreeFetch(): Promise<FetchLike> {
  const { isWalletConfigured, decryptKey } = await import('../wallet/index.js')
  if (!(await isWalletConfigured())) {
    return createPaymentFailureReportingFetch(fetch)
  }

  const privateKey = await decryptKey()
  return createMcpFetchClient(privateKey as `0x${string}`)
}

export async function createConfiguredGraphMcpFetch(
  config: Pick<InvestigatorConfig, 'graphMcpAuthToken' | 'graphMcpMode'>,
): Promise<FetchLike> {
  if (config.graphMcpMode === 'debug') {
    const authToken = config.graphMcpAuthToken?.trim()
    if (!authToken) {
      throw new Error('Chain Insights Graph debug mode requires graphMcpAuthToken. Run `cia access-key set <key>` or `cia debug on --token <token>`.')
    }
    return createMcpAuthFetchClient(authToken)
  }

  return createConfiguredGraphPaidOrFreeFetch()
}
