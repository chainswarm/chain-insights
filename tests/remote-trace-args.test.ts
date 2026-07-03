import { describe, it, expect } from 'vitest'
import { buildTraceVictimFundsRemoteArgs } from '../src/investigation/remote-trace-args.js'

describe('buildTraceVictimFundsRemoteArgs', () => {
  const base = { victimAddresses: '5Vic', network: 'bittensor' }

  it('forwards the contract-allowed args incident_timestamp_ms and max_hops as numbers', () => {
    const args = buildTraceVictimFundsRemoteArgs({ ...base, incidentTimestampMs: '1700000000000', maxHops: '4' })
    expect(args).toMatchObject({
      victim_addresses: '5Vic',
      network: 'bittensor',
      incident_timestamp_ms: 1700000000000,
      max_hops: 4,
    })
  })

  it('forwards known_suspect_addresses and topology_scope when present', () => {
    const args = buildTraceVictimFundsRemoteArgs({ ...base, knownSuspectAddresses: '5Sus', topologyScope: 'archive_topology' })
    expect(args).toMatchObject({ known_suspect_addresses: '5Sus', topology_scope: 'archive_topology' })
  })

  it('omits every optional arg when none are provided', () => {
    expect(buildTraceVictimFundsRemoteArgs(base)).toEqual({ victim_addresses: '5Vic', network: 'bittensor' })
  })

  it('rejects --per-address-limit with --remote (local-recipe only)', () => {
    expect(() => buildTraceVictimFundsRemoteArgs({ ...base, perAddressLimit: '5' })).toThrow(/per-address-limit.*local/i)
  })

  it('rejects --min-amount-sum with --remote (local-recipe only)', () => {
    expect(() => buildTraceVictimFundsRemoteArgs({ ...base, minAmountSum: '1000' })).toThrow(/min-amount-sum.*local/i)
  })

  it('names both local-only flags when both are passed', () => {
    expect(() => buildTraceVictimFundsRemoteArgs({ ...base, perAddressLimit: '5', minAmountSum: '1000' })).toThrow(
      /--per-address-limit and --min-amount-sum/,
    )
  })

  it('throws on a malformed numeric flag', () => {
    expect(() => buildTraceVictimFundsRemoteArgs({ ...base, maxHops: 'abc' })).toThrow(/Invalid number/)
  })
})
