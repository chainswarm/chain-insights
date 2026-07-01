import { describe, expect, it, vi } from 'vitest'
import { addressRisk, traceDepositSources, traceSuspectFunds, traceVictimFunds } from '../src/investigation/public-tools.js'

type BatchQuery = { id: string; query: string }

const config = { dataDir: '/tmp/ci-test', serverPort: 4321 }

// Every resolve_member_address_N query gets an empty result: no :Address node
// found, so the raw input never resolves to an identity_id (R2). Callers must
// report it as unresolved, not silently trace it as a raw-address identity_id.
function unresolvingClient(extra: (id: string) => { id: string; ok: boolean; results: Array<Record<string, unknown>> } | undefined = () => undefined) {
  return {
    callTool: vi.fn(async (req: { name: string; arguments: { queries?: BatchQuery[] } }) => {
      // AC12's archive-retry hint probes network_capabilities (no queries arg).
      if (req.name === 'network_capabilities') {
        return { content: [{ type: 'text', text: JSON.stringify({ networks: [] }) }], isError: false }
      }
      const queries = (req.arguments.queries ?? []).map((q) => {
        if (q.id.startsWith('resolve_member_address_')) return { id: q.id, ok: true, results: [] }
        return extra(q.id) ?? { id: q.id, ok: true, results: [] }
      })
      return { content: [{ type: 'text', text: JSON.stringify({ facts: { queries } }) }], isError: false }
    }),
  }
}

describe('R2/R3: unresolved seed addresses are reported, never silently traced', () => {
  it('aml_trace_victim_funds reports an unresolved victim address (AC5)', async () => {
    const remote = unresolvingClient()
    const result = await traceVictimFunds(remote as never, config, {
      victimAddresses: '5UnknownVictim',
      network: 'bittensor',
      writeArtifacts: false,
    })
    const content = result.structuredContent as { unresolved: string[]; summary: { seed_count: number; unresolved_count: number } }
    expect(content.unresolved).toEqual(['5UnknownVictim'])
    expect(content.summary.seed_count).toBe(0)
    expect(content.summary.unresolved_count).toBe(1)
    expect(result.summaryText).toContain('Unresolved (no matching Identity/Address): 5UnknownVictim')
  })

  it('aml_trace_suspect_funds reports an unresolved suspect address (AC5)', async () => {
    const remote = unresolvingClient()
    const result = await traceSuspectFunds(remote as never, config, {
      suspectAddresses: '5UnknownSuspect',
      network: 'bittensor',
      writeArtifacts: false,
    })
    const content = result.structuredContent as { unresolved: string[] }
    expect(content.unresolved).toEqual(['5UnknownSuspect'])
  })

  it('aml_trace_deposit_sources reports an unresolved deposit address without querying reverse sources (AC5)', async () => {
    const remote = unresolvingClient()
    const result = await traceDepositSources(remote as never, config, {
      depositAddresses: '5UnknownDeposit',
      network: 'bittensor',
      maxHops: 1,
      writeArtifacts: false,
    })
    const content = result.structuredContent as { unresolved: string[]; summary: { seed_count: number; unresolved_count: number } }
    expect(content.unresolved).toEqual(['5UnknownDeposit'])
    expect(content.summary.seed_count).toBe(0)
    expect(content.summary.unresolved_count).toBe(1)
    // No reverse_deposit_sources_* query should have been issued for a seed set with 0 resolved deposits.
    const issuedIds = remote.callTool.mock.calls.flatMap((call) => ((call[0] as { arguments: { queries?: BatchQuery[] } }).arguments.queries ?? []).map((q) => q.id))
    expect(issuedIds.some((id) => id.startsWith('reverse_deposit_sources_'))).toBe(false)
  })

  it('aml_address_risk reports an unresolved address explicitly instead of weak/empty enrichment (AC10)', async () => {
    const remote = unresolvingClient()
    const result = await addressRisk(remote as never, {
      address: '5UnknownAddr',
      network: 'bittensor',
    })
    expect(result.summaryText).toContain('Unresolved: no Identity/Address found for "5UnknownAddr"')
    const facts = (result.structuredContent as { facts: { unresolved: string[] } }).facts
    expect(facts.unresolved).toEqual(['5UnknownAddr'])
  })

  it('aml_trace_victim_funds traces resolved seeds and lists unresolved ones (AC9: mixed resolved/unresolved)', async () => {
    const remote = {
      callTool: vi.fn(async (req: { arguments: { queries: BatchQuery[] } }) => {
        const queries = req.arguments.queries.map((q) => {
          if (q.id === 'resolve_member_address_1') return { id: q.id, ok: true, results: [{ identity_id: 'bittensor:0xresolved' }] }
          if (q.id.startsWith('resolve_member_address_')) return { id: q.id, ok: true, results: [] }
          return { id: q.id, ok: true, results: [] }
        })
        return { content: [{ type: 'text', text: JSON.stringify({ facts: { queries } }) }], isError: false }
      }),
    }
    const result = await traceVictimFunds(remote as never, config, {
      victimAddresses: ['5KnownVictim', '5UnknownVictim'],
      network: 'bittensor',
      writeArtifacts: false,
    })
    const content = result.structuredContent as { unresolved: string[]; summary: { seed_count: number; unresolved_count: number } }
    expect(content.unresolved).toEqual(['5UnknownVictim'])
    expect(content.summary.seed_count).toBe(1)
    expect(content.summary.unresolved_count).toBe(1)
  })
})
