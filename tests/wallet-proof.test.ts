import { describe, expect, it, vi } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { verifyMessage } from 'viem'
import { buildWalletProof, proofHostFromUrl, proofMessage } from '../src/mcp/wallet-proof.js'

const TEST_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const
const HOST = 'mcp.chain-insights.ai'
const NOW = new Date('2026-08-23T12:00:00.000Z')

describe('buildWalletProof', () => {
  it('signs cia-mcp-permit host unix for recover', async () => {
    const account = privateKeyToAccount(TEST_KEY)
    const header = await buildWalletProof({ account, host: HOST, now: NOW })
    const unix = Math.floor(NOW.getTime() / 1000)
    const [version, address, stamped, sig] = header.split(';')
    expect(version).toBe('v1')
    expect(address).toBe(account.address.toLowerCase())
    expect(stamped).toBe(String(unix))
    expect(sig.startsWith('0x')).toBe(false)

    const message = proofMessage(HOST, unix)
    expect(message).toBe(`cia-mcp-permit\n${HOST}\n${unix}`)

    const recovered = await verifyMessage({
      address: account.address,
      message,
      signature: `0x${sig}`,
    })
    expect(recovered).toBe(true)
  })

  it('proofHostFromUrl drops scheme and path', () => {
    expect(proofHostFromUrl('https://mcp.chain-insights.ai/mcp')).toBe(HOST)
    expect(proofHostFromUrl(new URL('http://127.0.0.1:8012/mcp'))).toBe('127.0.0.1:8012')
  })
})

describe('createWalletProofFetch', () => {
  it('attaches X-CIA-Wallet-Proof without a CIA quota gate', async () => {
    const { createWalletProofFetch } = await import('../src/mcp/wallet-proof.js')
    const account = privateKeyToAccount(TEST_KEY)
    const inner = vi.fn(async () => new Response('ok', { status: 200 }))
    const wrapped = createWalletProofFetch(account, inner, () => NOW)
    await wrapped('https://mcp.chain-insights.ai/mcp', { method: 'POST' })
    expect(inner).toHaveBeenCalledOnce()
    const init = inner.mock.calls[0]?.[1] as RequestInit
    const headers = new Headers(init.headers)
    const proof = headers.get('X-CIA-Wallet-Proof')
    const unix = Math.floor(NOW.getTime() / 1000)
    expect(proof).toMatch(new RegExp(`^v1;${account.address.toLowerCase()};${unix};`))
    expect(headers.get('X-Chain-Insights-Payer-Wallet')).toBeNull()
  })
})
