import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writeExposureArtifacts } from '../src/investigation/exposure-report.js'
import { exposureProfile } from '../src/investigation/public-tools.js'

vi.mock('../src/investigation/exposure-report.js', () => ({
  writeExposureArtifacts: vi.fn(),
}))

const mockWriteExposureArtifacts = vi.mocked(writeExposureArtifacts)

function graphBatchResult(queries: Array<Record<string, unknown>>): {
  content: Array<{ type: 'text'; text: string }>
  isError: false
} {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        schema: 'chain-insights.result.v1',
        tool: 'graph_query_batch',
        facts: { queries },
      }),
    }],
    isError: false,
  }
}

function expectNoInternalExposureFields(value: unknown): void {
  const serialized = JSON.stringify(value)
  for (const forbidden of [
    'source_backend',
    'evidence_relationship_type',
    'STAKES_IN',
    'HAS_EXPOSURE',
    'TARGETS_HOTKEY',
    'live_topology',
    'archive_topology',
    'core_exposure',
    'include_attachments',
    'stake_unit',
  ]) {
    expect(serialized).not.toContain(forbidden)
  }
}

describe('exposureProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps Bittensor alpha staking exposure into the generic public response without internals', async () => {
    const callTool = vi.fn().mockResolvedValue(graphBatchResult([
      {
        id: 'live_exposures',
        ok: true,
        results: [{
          account_address: '5Cold',
          owner_address: '5Cold',
          counterparty_address: '5Hot',
          venue: 'Bittensor',
          instrument_id: 'bittensor:subnet-lifecycle:19:2025-01',
          instrument_display_id: 'Subnet 19',
          instrument_type: 'subnet',
          instrument_lifecycle_id: 'subnet-19-2025-01',
          side: 'stake',
          quantity: '8.75',
          quantity_unit: '',
          notional: '',
          quote_unit: '',
          pricing_status: 'unpriced',
          opened: '10.5',
          closed: '2.25',
          increased: '1',
          reduced: '0.5',
          net_change: '8.75',
          event_count: 4,
          first_activity_timestamp: 1769126400000,
          last_activity_timestamp: 1769126500000,
          support_events: JSON.stringify([
            {
              event_time: 1769126400000,
              block_height: 8265058,
              tx_id: '8265058-1',
              action: 'stake_added',
              amount: '10.5',
            },
          ]),
          source_backend: 'memgraph_live',
          evidence_relationship_type: 'STAKES_IN',
        }],
      },
    ]))

    const result = await exposureProfile({ callTool } as never, {
      network: 'bittensor',
      account: '5Cold',
      instrument: 'Subnet 19',
    })

    expect(callTool).toHaveBeenCalledOnce()
    const args = callTool.mock.calls[0]?.[0].arguments
    expect(args.network).toBe('bittensor')
    expect(args.queries[0].query).toContain('USE live_topology')
    expect(args.queries[0].query).toContain('HAS_EXPOSURE')
    expect(args.queries[0].query).toContain('5Cold')
    expect(args.queries[0].query).toContain('Subnet 19')
    expect(args.queries[0].query).toContain('exposure.owner_address')
    expect(args.queries[0].query).toContain('exposure.counterparty_address')
    expect(args.queries[0].query).not.toContain('OPTIONAL MATCH')

    expect(result.structuredContent.schema).toBe('chain-insights.exposure_profile.v1')
    expect(result.structuredContent.tool).toBe('exposure_profile')
    expect(result.structuredContent.subject).toEqual({
      network: 'bittensor',
      account: '5Cold',
      role: 'account',
    })
    expect(result.structuredContent.summary).toMatchObject({
      exposure_count: 1,
      venues: ['Bittensor'],
      instruments: ['Subnet 19'],
      net_direction: 'mixed',
      first_activity_timestamp: 1769126400000,
      last_activity_timestamp: 1769126500000,
    })
    expect(Object.prototype.hasOwnProperty.call(result.structuredContent, 'graph')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(result.structuredContent, 'graph_data')).toBe(false)
    expect(result.structuredContent.exposures).toEqual([
      expect.objectContaining({
        venue: 'Bittensor',
        instrument: {
          id: 'bittensor:subnet-lifecycle:19:2025-01',
          display_name: 'Subnet 19',
          type: 'subnet',
          lifecycle_id: 'subnet-19-2025-01',
        },
        position: {
          side: 'stake',
          quantity: '8.75',
          pricing_status: 'unpriced',
        },
        changes: {
          opened: '10.5',
          closed: '2.25',
          increased: '1',
          reduced: '0.5',
          net_change: '8.75',
        },
        activity: {
          first_seen_timestamp: 1769126400000,
          last_seen_timestamp: 1769126500000,
          event_count: 4,
        },
        support: [
          {
            event_time: 1769126400000,
            block_height: 8265058,
            tx_id: '8265058-1',
            action: 'stake_added',
            amount: '10.5',
          },
        ],
      }),
    ])
    expect(result.structuredContent.caveats).toContain('Bittensor exposure quantity is unpriced because the source unit resolver has not proven a base or quote unit for this exposure.')
    expectNoInternalExposureFields(result.structuredContent)
  })

  it('maps Hyperliquid trading exposure into the same public response shape', async () => {
    const callTool = vi.fn().mockResolvedValue(graphBatchResult([
      {
        id: 'archive_exposures',
        ok: true,
        results: [{
          account_address: '0xTrader',
          owner_address: '0xTrader',
          counterparty_address: '',
          venue: 'Hyperliquid',
          instrument_id: 'hyperliquid:perp:BTC',
          instrument_display_id: 'BTC-PERP',
          instrument_type: 'perp',
          side: 'long',
          quantity: '0.42',
          quantity_unit: 'BTC',
          notional: '42000',
          quote_unit: 'USDC',
          pricing_status: 'priced',
          opened: '0.42',
          net_change: '0.42',
          carry_paid: '12.34',
          carry_received: '0',
          liquidation_distance: '18.5%',
          event_count: 2,
          first_activity_timestamp: 1769126400000,
          last_activity_timestamp: 1769126500000,
          support_events: JSON.stringify([
            {
              event_time: 1769126500000,
              order_id: 'order-1',
              trade_id: 'trade-1',
              fill_id: 'fill-1',
              action: 'fill',
              amount: '0.42',
              price: '100000',
            },
          ]),
          source_backend: 'starrocks_archive',
        }],
      },
    ]))

    const result = await exposureProfile({ callTool } as never, {
      network: 'hyperliquid',
      account: '0xTrader',
      instrument: 'BTC-PERP',
    })

    expect(result.structuredContent.summary).toMatchObject({
      exposure_count: 1,
      venues: ['Hyperliquid'],
      instruments: ['BTC-PERP'],
      net_direction: 'long',
    })
    expect(result.structuredContent.exposures).toEqual([
      expect.objectContaining({
        venue: 'Hyperliquid',
        instrument: {
          id: 'hyperliquid:perp:BTC',
          display_name: 'BTC-PERP',
          type: 'perp',
        },
        position: {
          side: 'long',
          quantity: '0.42',
          quantity_unit: 'BTC',
          notional: '42000',
          quote_unit: 'USDC',
          pricing_status: 'priced',
        },
        carry: {
          paid: '12.34',
          received: '0',
          quote_unit: 'USDC',
        },
        risk: {
          liquidation_distance: '18.5%',
          exit_pressure: 'unknown',
        },
        support: [
          {
            event_time: 1769126500000,
            order_id: 'order-1',
            trade_id: 'trade-1',
            fill_id: 'fill-1',
            action: 'fill',
            amount: '0.42',
            price: '100000',
          },
        ],
      }),
    ])
    expectNoInternalExposureFields(result.structuredContent)
  })

  it('deduplicates the same exposure returned by live and archive topology', async () => {
    const liveRow = {
      account_address: '0xTrader',
      owner_address: '0xTrader',
      counterparty_address: '',
      venue: 'Hyperliquid',
      instrument_id: 'hyperliquid:perp:ETH',
      instrument_display_id: 'ETH-PERP',
      instrument_type: 'perp',
      side: 'long',
      quantity: '1',
      quantity_unit: 'ETH',
      notional: '3000',
      quote_unit: 'USDC',
      pricing_status: 'priced',
      opened: '1',
      net_change: '1',
      event_count: 1,
      first_activity_timestamp: 1769126400000,
      last_activity_timestamp: 1769126500000,
      support_events: '[]',
    }
    const archiveRow = {
      ...liveRow,
      event_count: 3,
      opened: '1.5',
      closed: '0.5',
      net_change: '1',
      support_events: JSON.stringify([
        {
          event_time: 1769126500000,
          action: 'fill',
          amount: '1',
        },
      ]),
    }
    const callTool = vi.fn().mockResolvedValue(graphBatchResult([
      {
        id: 'live_exposures',
        ok: true,
        results: [liveRow],
      },
      {
        id: 'archive_exposures',
        ok: true,
        results: [archiveRow],
      },
    ]))

    const result = await exposureProfile({ callTool } as never, {
      network: 'hyperliquid',
      account: '0xTrader',
      instrument: 'ETH-PERP',
    })

    expect(result.structuredContent.summary.exposure_count).toBe(1)
    expect(result.structuredContent.exposures[0].activity.event_count).toBe(3)
    expect(result.structuredContent.exposures[0].changes.opened).toBe('1.5')
    expect(result.structuredContent.exposures[0].support).toEqual([
      {
        event_time: 1769126500000,
        action: 'fill',
        amount: '1',
      },
    ])
  })

  it('writes artifacts when writeArtifacts=true', async () => {
    const callTool = vi.fn().mockResolvedValue(graphBatchResult([
      {
        id: 'live_exposures',
        ok: true,
        results: [{
          account_address: '0xTrader',
          owner_address: '0xTrader',
          counterparty_address: '',
          venue: 'Hyperliquid',
          instrument_id: 'hyperliquid:perp:BTC',
          instrument_display_id: 'BTC-PERP',
          instrument_type: 'perp',
          side: 'long',
          quantity: '0.42',
          quantity_unit: 'BTC',
          notional: '42000',
          quote_unit: 'USDC',
          pricing_status: 'priced',
          opened: '0.50',
          closed: '0.08',
          increased: '0.50',
          reduced: '0.08',
          net_change: '0.42',
          carry_received: '3',
          carry_paid: '12',
          liquidation_distance: '18.5',
          exit_pressure: 'medium',
          event_count: 64,
          first_activity_timestamp: 1769126400000,
          last_activity_timestamp: 1769126500000,
          support_events: JSON.stringify([
            {
              event_time: 1769126500000,
              order_id: 'order-1',
              trade_id: 'trade-1',
              fill_id: 'fill-1',
              action: 'fill',
              amount: '0.42',
              price: '100000',
            },
          ]),
        }],
      },
    ]))

    const result = await exposureProfile({ callTool } as never, {
      network: 'hyperliquid',
      account: '0xTrader',
      writeArtifacts: true,
    })

    expect(mockWriteExposureArtifacts).toHaveBeenCalledTimes(1)
    expect(mockWriteExposureArtifacts).toHaveBeenCalledWith({
      toolName: 'exposure_profile',
      network: 'hyperliquid',
      subject: '0xTrader',
      summaryText: result.summaryText,
      structuredContent: result.structuredContent,
    })
  })
})
