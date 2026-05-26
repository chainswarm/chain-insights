import { describe, expect, it } from 'vitest'

describe('wallet top-up browser page', () => {
  it('renders the copied infra MCP Apps top-up component', async () => {
    const { generateArtifactHtml } = await import('../src/wallet/topup-server.js')
    const html = generateArtifactHtml(
      '0x0000000000000000000000000000000000000001',
      'http://localhost:4500',
    )

    expect(html).toContain('0x0000000000000000000000000000000000000001')
    expect(html).toContain('MCP Apps protocol handshake')
    expect(html).toContain('ui/initialize')
    expect(html).toContain('http://localhost:4500/assets/logo.png')
    expect(html).toContain('var TOPUP_URL = "http://localhost:4500";')
    expect(html).toContain("fetch(TOPUP_URL + '/api/balance')")
    expect(html).toContain('id="gas"')
    expect(html).toContain('balance_eth')
    expect(html).toContain('Base ETH is used for one-time approval gas')
    expect(html).toContain('<svg')
    expect(html).toContain('Base Network')
    expect(html).not.toContain('$1.00 USDC = ~100 tool calls')
    expect(html).not.toContain('100 tool calls')
    expect(html).not.toContain('Connect MetaMask')
  })

  it('rejects invalid wallet addresses before rendering artifact HTML', async () => {
    const { generateArtifactHtml } = await import('../src/wallet/topup-server.js')

    expect(() => generateArtifactHtml('"><script>alert(1)</script>', 'http://localhost:4500')).toThrow(
      'Wallet address must be a valid 0x-prefixed 20-byte EVM address',
    )
  })

  it('serializes dynamic topup URLs safely for script contexts', async () => {
    const { generateArtifactHtml } = await import('../src/wallet/topup-server.js')
    const html = generateArtifactHtml(
      '0x0000000000000000000000000000000000000001',
      'http://localhost:4500/</script><script>alert(1)</script>',
    )

    expect(html).not.toContain('</script><script>alert(1)</script>')
    expect(html).toContain('\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e')
  })

  it('rejects invalid wallet addresses at topup server startup', async () => {
    const { startTopupServer } = await import('../src/wallet/topup-server.js')

    await expect(startTopupServer('not-an-evm-address')).rejects.toThrow(
      'Wallet address must be a valid 0x-prefixed 20-byte EVM address',
    )
  })

  it('rejects invalid wallet addresses at copied topup server startup', async () => {
    const { startTopupServer } = await import('../src/wallet/mcp-proxy/topup-server.js')

    await expect(startTopupServer('not-an-evm-address')).rejects.toThrow(
      'Wallet address must be a valid 0x-prefixed 20-byte EVM address',
    )
  })
})
