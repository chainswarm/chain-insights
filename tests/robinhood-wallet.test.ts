import { describe, expect, it } from 'vitest'
import {
  CIA_TOKEN_ADDRESS,
  PUBLIC_ROBINHOOD_RPC_URLS,
  ROBINHOOD_CHAIN_ID,
  explorerAddressUrl,
  explorerTxUrl,
  formatCia,
  robinhoodChain,
  robinhoodRpcUrls,
} from '../src/wallet/robinhood.js'

describe('Robinhood Chain in the wallet layer', () => {
  it('robinhoodRpcUrls puts ROBINHOOD_RPC_URL first and drops its duplicate', () => {
    const cases: Array<{ env: NodeJS.ProcessEnv; want: string[] }> = [
      { env: {}, want: [...PUBLIC_ROBINHOOD_RPC_URLS] },
      { env: { ROBINHOOD_RPC_URL: '  ' }, want: [...PUBLIC_ROBINHOOD_RPC_URLS] },
      { env: { ROBINHOOD_RPC_URL: 'http://127.0.0.1:8545' }, want: ['http://127.0.0.1:8545', ...PUBLIC_ROBINHOOD_RPC_URLS] },
      { env: { ROBINHOOD_RPC_URL: 'https://rpc.ordofi.network' }, want: ['https://rpc.ordofi.network', 'https://rpc.mainnet.chain.robinhood.com'] },
    ]
    for (const { env, want } of cases) expect(robinhoodRpcUrls(env)).toEqual(want)
  })

  it('explorer links use robin.etherscan.io', () => {
    const tx = `0x${'ab12'.repeat(16)}`
    expect(explorerTxUrl(tx)).toBe(`https://robin.etherscan.io/tx/${tx}`)
    expect(explorerAddressUrl(CIA_TOKEN_ADDRESS)).toBe(`https://robin.etherscan.io/address/${CIA_TOKEN_ADDRESS}`)
    expect(robinhoodChain.id).toBe(ROBINHOOD_CHAIN_ID)
    expect(robinhoodChain.blockExplorers.default.url).toBe('https://robin.etherscan.io')
  })

  it('formats a $CIA amount with 18 decimals', () => {
    expect(formatCia(10n ** 18n)).toBe('1')
    expect(formatCia(320n * 10n ** 18n + 5n * 10n ** 17n)).toBe('320.5')
    expect(formatCia(1n)).toBe('0.000000000000000001')
  })
})
