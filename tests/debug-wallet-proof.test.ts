import { afterEach, describe, expect, it, vi } from 'vitest'
import { keccak256, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const testKey = keccak256(toHex('chain-insights debug proof test key'))
const walletConfigured = vi.hoisted(() => ({ value: true }))

vi.mock('../src/wallet/index.js', () => ({
  isWalletConfigured: vi.fn(async () => walletConfigured.value),
  decryptKey: vi.fn(async () => testKey),
}))

describe('debug mode and the wallet proof', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('debug mode with a wallet still attaches X-CIA-Wallet-Proof', async () => {
    const seen: Headers[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers))
      return new Response('{}')
    }))
    const { createConfiguredGraphMcpFetch } = await import('../src/mcp/client.js')
    const debugFetch = await createConfiguredGraphMcpFetch({ graphMcpMode: 'debug', graphMcpAuthToken: 'lab-token' })
    await debugFetch('https://mcp-staging.chain-insights.ai/mcp')

    expect(seen).toHaveLength(1)
    expect(seen[0].get('Authorization')).toBe('Bearer lab-token')
    const proof = seen[0].get('X-CIA-Wallet-Proof') ?? ''
    expect(proof.split(';').slice(0, 2)).toEqual(['v1', privateKeyToAccount(testKey).address.toLowerCase()])
  })
})
