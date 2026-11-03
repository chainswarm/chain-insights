import { afterAll, describe, expect, it } from 'vitest'

const WALLET = '0x0000000000000000000000000000000000000001'

describe('the Base top-up page and view stay as they were', () => {
  afterAll(async () => {
    const { stopTopupServer } = await import('../src/wallet/topup-server.js')
    await stopTopupServer()
  })

  it('the Base page is unchanged', async () => {
    const { startTopupServer } = await import('../src/wallet/mcp-proxy/topup-server.js')
    const url = await startTopupServer(WALLET)
    const page = await (await fetch(`${url}/`)).text()
    // The 0.73.1 snapshot, byte for byte: the wallet page is the baseline.
    expect(page).toMatchSnapshot()
  })

  it('both rails serve one page: the same markup, style and script, only the text differs', async () => {
    const { generateTopupPage } = await import('../src/wallet/mcp-proxy/topup-server.js')
    // Each rail's own strings, the same slot at the same index.
    const text = {
      'base-usdc': [
        '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', '0x2105',
        'Chain Insights — Fund Wallet',
        'Fund your wallet to use blockchain intelligence tools',
        'Base Network &middot; USDC',
        'class="currency">USDC<', 'balance_usdc',
        'Base ETH is used for one-time payment setup gas.',
        'Send Base USDC to the wallet address above.',
      ],
      'robinhood-cia': [
        '0x766bd6598182586beda76414dc5f8deb1530a213', '0x1237',
        'Chain Insights — Fund Subscription Wallet',
        'Fund your wallet to buy a Chain Insights subscription',
        'Robinhood Chain &middot; $CIA',
        'class="currency">$CIA<', 'balance_cia',
        'Robinhood Chain ETH is used for the buy transaction gas.',
        'Send $CIA and Robinhood Chain ETH to the wallet address above.',
      ],
    } as const
    const skeleton = (rail: keyof typeof text) => {
      let page = generateTopupPage(WALLET, rail)
      // Longest first, so a short string inside a sentence is not swapped early.
      const order = text[rail].map((value, i) => ({ value, i })).sort((a, b) => b.value.length - a.value.length)
      for (const { value, i } of order) {
        expect(page, `${rail} prints ${value}`).toContain(value)
        page = page.split(value).join(`<<text ${i}>>`)
      }
      return page
    }
    expect(skeleton('robinhood-cia')).toBe(skeleton('base-usdc'))
  })

  it('cia subscription topup opens the cia wallet topup page, only the network text differs', async () => {
    const { generateArtifactHtml } = await import('../src/wallet/topup-server.js')
    const url = 'http://localhost:4500'
    // Each rail's own strings, the same slot at the same index.
    const text = {
      'base-usdc': [
        'Fund your wallet with USDC on Base',
        'Base Network &middot; USDC',
        '</span> USDC<br>',
        'balance_usdc',
        'Base ETH is used for one-time payment setup gas.',
      ],
      'robinhood-cia': [
        'Fund your wallet with $CIA on Robinhood Chain',
        'Robinhood Chain &middot; $CIA',
        '</span> $CIA<br>',
        'balance_cia',
        'Robinhood Chain ETH is used for the buy transaction gas.',
      ],
    } as const
    const skeleton = (rail: keyof typeof text) => {
      let page = generateArtifactHtml(WALLET, url, rail)
      text[rail].forEach((value, i) => {
        expect(page, `${rail} prints ${value}`).toContain(value)
        page = page.split(value).join(`<<text ${i}>>`)
      })
      return page
    }
    expect(skeleton('robinhood-cia')).toBe(skeleton('base-usdc'))
    expect(generateArtifactHtml(WALLET, url, 'robinhood-cia').toLowerCase()).not.toContain(
      '0x67a8c068cc762e371706ea6c399178171f92810d'
    )
  })

  it('cia subscription topup serves the wallet page with the $CIA balance', async () => {
    const { startTopupServer, stopTopupServer } = await import('../src/wallet/topup-server.js')
    const url = await startTopupServer(WALLET, 'robinhood-cia')
    const page = await (await fetch(`${url}/`)).text()
    expect(page).toContain('Robinhood Chain &middot; $CIA')
    expect(page).toContain(`${url}/assets/logo.png`)
    await stopTopupServer()
  })

  it('the Base artifact page is unchanged', async () => {
    const { generateArtifactHtml } = await import('../src/wallet/topup-server.js')
    expect(generateArtifactHtml(WALLET, 'http://localhost:4500')).toMatchSnapshot()
  })

  it('the wallet_topup answer is unchanged', async () => {
    const { topupToolResult } = await import('../src/wallet/mcp-proxy/topup-server.js')
    expect(topupToolResult(WALLET)).toMatchSnapshot()
    expect(topupToolResult(null)).toMatchSnapshot()
  })
})

describe('the subscription top-up rail', () => {
  const SINK = '0x67a8c068cc762e371706ea6c399178171f92810d'

  it('subscription page names Robinhood Chain and $CIA and never the sink address', async () => {
    const { generateSubscriptionPage, startTopupServer } = await import('../src/wallet/mcp-proxy/topup-server.js')
    const page = generateSubscriptionPage(WALLET)
    expect(page).toContain('Robinhood Chain &middot; $CIA')
    expect(page).toContain('Send $CIA and Robinhood Chain ETH to the wallet address above.')
    expect(page).toContain(WALLET)
    expect(page.toLowerCase()).not.toContain(SINK)

    const baseUrl = await startTopupServer(WALLET)
    const railUrl = await startTopupServer(WALLET, 'robinhood-cia')
    expect(railUrl).not.toBe(baseUrl)
    const served = await (await fetch(`${railUrl}/`)).text()
    expect(served).toBe(page)
  })

  it('the subscription facts and terminal text name the wallet, never the sink', async () => {
    const { subscriptionTopupFacts, subscriptionTopupText } = await import('../src/subscription/topup.js')
    const facts = subscriptionTopupFacts(WALLET, 'http://localhost:4600')
    expect(facts).toEqual({
      wallet_address: WALLET,
      network: 'Robinhood Chain',
      chain_id: 4663,
      token: '$CIA',
      token_contract: '0x766bd6598182586beda76414dc5f8deb1530a213',
      gas_token: 'ETH',
      topup_url: 'http://localhost:4600',
    })
    const text = subscriptionTopupText(facts)
    expect(text).toContain(`Wallet:      ${WALLET}`)
    expect(text).toContain('▀')
    expect(text.toLowerCase()).not.toContain(SINK)
  })
})
