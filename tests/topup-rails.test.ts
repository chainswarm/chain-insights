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
    expect(page).toMatchSnapshot()
    expect(page).not.toContain('cdn.jsdelivr.net')
  })

  it('both rails serve one page: the same markup, style and script, only the text differs', async () => {
    const { generateTopupPage } = await import('../src/wallet/mcp-proxy/topup-server.js')
    // Each rail's own strings, in the order the page prints them.
    const text = {
      'base-usdc': [
        'Chain Insights — Fund Wallet',
        'Fund your wallet to use blockchain intelligence tools',
        'Base Network &middot; USDC',
        'USDC', 'balance_usdc',
        'Base ETH is used for one-time payment setup gas.',
        'Send Base USDC to the wallet address above.',
      ],
      'robinhood-cia': [
        'Chain Insights — Fund the subscription wallet',
        'Fund your wallet for the Chain Insights subscription',
        'Robinhood Chain &middot; $CIA',
        '$CIA', 'balance_cia',
        'Robinhood Chain ETH pays the gas of the two buy transactions.',
        'Send $CIA and a little ETH on Robinhood Chain to your own wallet. Then run <code>cia subscription buy --days N</code>.' +
          '<br>Robinhood Chain (chain ID 4663) &middot; $CIA <code>0x766bd6598182586beda76414dc5f8deb1530a213</code>' +
          '<br>This page shows your own address only. It signs nothing and sends nothing.',
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
    expect(page).toContain('Robinhood Chain (chain ID 4663)')
    expect(page).toContain('$CIA')
    expect(page).toContain('0x766bd6598182586beda76414dc5f8deb1530a213')
    expect(page).toContain(
      'Send $CIA and a little ETH on Robinhood Chain to your own wallet. Then run <code>cia subscription buy --days N</code>.'
    )
    expect(page).toContain(WALLET)
    expect(page.toLowerCase()).not.toContain(SINK)
    expect(page).not.toContain('cdn.jsdelivr.net')

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
