import { describe, expect, it } from 'vitest'
import { metaDexLookupArgs } from '../src/mcp/call-args.js'

describe('metaDexLookupArgs carries every argument the lookup admits', () => {
  it('passes address through, so `cia mcp call meta_dex_lookup address=0x…` reaches the address branch', () => {
    expect(
      metaDexLookupArgs({ network: 'robinhood', address: '0x3d6ea4e97b8ab9e1a1b4943febffe22d8c920091' })
    ).toEqual({ network: 'robinhood', address: '0x3d6ea4e97b8ab9e1a1b4943febffe22d8c920091' })
  })
  it('keeps name and reads pools=false as a boolean', () => {
    expect(metaDexLookupArgs({ network: 'robinhood', name: 'aero', pools: 'false' })).toEqual({
      network: 'robinhood',
      name: 'aero',
      pools: false,
    })
  })
})
