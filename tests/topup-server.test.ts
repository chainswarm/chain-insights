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
    expect(html).toContain('http://localhost:4500/api/balance')
    expect(html).toContain('<svg')
    expect(html).toContain('Base Network')
    expect(html).not.toContain('$1.00 USDC = ~100 tool calls')
    expect(html).not.toContain('100 tool calls')
    expect(html).not.toContain('Connect MetaMask')
  })
})
