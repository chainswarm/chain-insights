import { describe, expect, it } from 'vitest'
import { orderPaymentOptions, KNOWN_PAYMENT_ASSET_SYMBOLS, type PaymentOptionLike } from '../src/mcp/payment-asset-preference.js'

const symbols = {
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC',
  '0x5fc5360d0400a0fd4f2af552add042d716f1d168': 'USDG',
  '0x6e30a5f8fc61cd4e8550d2dd3cddea2a0196dc69': 'CHOICE',
}

const accepts: PaymentOptionLike[] = [
  { network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '100000' },
  { network: 'eip155:4663', asset: '0x5fc5360d0400A0Fd4F2aF552aDd042D716f1D168', amount: '100000' },
  { network: 'eip155:4663', asset: '0x6e30a5f8FC61cd4e8550d2Dd3CDDea2A0196DC69', amount: '102000000000000000' },
]

describe('orderPaymentOptions', () => {
  it('orders by preference symbols', () => {
    const ordered = orderPaymentOptions(accepts, 'CHOICE,USDC', symbols)
    expect(ordered.map((o) => symbols[o.asset.toLowerCase() as keyof typeof symbols])).toEqual(['CHOICE', 'USDC', 'USDG'])
  })

  it('empty preference keeps server order', () => {
    const ordered = orderPaymentOptions(accepts, '', symbols)
    expect(ordered).toEqual(accepts)
  })

  it('unknown preference entries are ignored', () => {
    const ordered = orderPaymentOptions(accepts, 'DOGE,USDG', symbols)
    expect(ordered.map((o) => symbols[o.asset.toLowerCase() as keyof typeof symbols])[0]).toEqual('USDG')
  })

  it('is case-insensitive for symbols and preserves server order among ties', () => {
    const ordered = orderPaymentOptions(accepts, 'choice', symbols)
    expect(ordered.map((o) => symbols[o.asset.toLowerCase() as keyof typeof symbols])).toEqual(['CHOICE', 'USDC', 'USDG'])
  })

  it('matches preference entries given as raw addresses, not just symbols', () => {
    const ordered = orderPaymentOptions(
      accepts,
      '0x6E30A5F8FC61CD4E8550D2DD3CDDEA2A0196DC69',
      symbols,
    )
    expect(ordered.map((o) => symbols[o.asset.toLowerCase() as keyof typeof symbols])[0]).toEqual('CHOICE')
  })

  it('does not mutate the input array', () => {
    const copy = accepts.map((option) => ({ ...option }))
    orderPaymentOptions(accepts, 'CHOICE,USDC', symbols)
    expect(accepts).toEqual(copy)
  })

  it('KNOWN_PAYMENT_ASSET_SYMBOLS covers Base USDC and Robinhood Chain USDG/CHOICE', () => {
    expect(KNOWN_PAYMENT_ASSET_SYMBOLS).toMatchObject(symbols)
  })
})
