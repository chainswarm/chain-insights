import type { Account } from 'viem'

type FetchLike = typeof fetch
type FetchInput = Parameters<FetchLike>[0]
type FetchInit = Parameters<FetchLike>[1]

export const CIA_WALLET_PROOF_HEADER = 'X-CIA-Wallet-Proof'

export function proofMessage(host: string, unix: number): string {
  return `cia-mcp-permit\n${host}\n${unix}`
}

export function proofHostFromUrl(input: FetchInput): string {
  if (typeof input === 'string') {
    return new URL(input).host
  }
  if (input instanceof URL) {
    return input.host
  }
  return new URL(input.url).host
}

export async function buildWalletProof(opts: {
  account: Pick<Account, 'address' | 'signMessage'>
  host: string
  now?: Date
}): Promise<string> {
  if (!opts.account.signMessage) {
    throw new Error('wallet cannot sign a burnhole proof')
  }
  const unix = Math.floor((opts.now ?? new Date()).getTime() / 1000)
  const signature = await opts.account.signMessage({
    message: proofMessage(opts.host, unix),
  })
  const sigHex = signature.startsWith('0x') ? signature.slice(2) : signature
  return `v1;${opts.account.address.toLowerCase()};${unix};${sigHex}`
}

export function createWalletProofFetch(
  account: Pick<Account, 'address' | 'signMessage'>,
  baseFetch: FetchLike,
  now: () => Date = () => new Date(),
): FetchLike {
  return (async (input: FetchInput, init?: FetchInit) => {
    if (!account.signMessage) {
      return baseFetch(input, init)
    }
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    headers.set(
      CIA_WALLET_PROOF_HEADER,
      await buildWalletProof({ account, host: proofHostFromUrl(input), now: now() }),
    )
    return baseFetch(input, { ...init, headers })
  }) as FetchLike
}
