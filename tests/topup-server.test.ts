import { describe, expect, it } from 'vitest'

describe('wallet top-up browser page', () => {
  it('renders the local wallet address, balance endpoint, and MetaMask transfer flow', async () => {
    const { generateTopupPage } = await import('../src/wallet/topup-server.js')
    const html = generateTopupPage('0x0000000000000000000000000000000000000001')

    expect(html).toContain('0x0000000000000000000000000000000000000001')
    expect(html).toContain('/api/balance')
    expect(html).toContain('Current balance')
    expect(html).toContain('Base Network')
    expect(html).toContain('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
    expect(html).toContain('wallet_switchEthereumChain')
    expect(html).toContain('eth_sendTransaction')
  })
})
