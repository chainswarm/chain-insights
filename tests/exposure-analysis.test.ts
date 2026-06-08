import { describe, expect, it, vi } from 'vitest'
import {
  exposureCarry,
  exposureCorrelation,
  exposureCrowding,
  exposureExitPressure,
  exposureExplain,
  exposureQuality,
} from '../src/investigation/public-tools.js'

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

function exposureRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    account_address: '0xTrader',
    owner_address: '0xTrader',
    counterparty_address: '',
    venue: 'Hyperliquid',
    instrument_id: 'hyperliquid:perp:BTC',
    instrument_display_id: 'BTC-PERP',
    instrument_type: 'perp',
    instrument_lifecycle_id: 'perp-BTC',
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
    source_backend: 'starrocks_archive',
    evidence_relationship_type: 'HAS_EXPOSURE',
    ...overrides,
  }
}

function profileBatch(rows: Array<Record<string, unknown>>) {
  return graphBatchResult([
    { id: 'live_exposures', ok: true, results: rows },
    { id: 'archive_exposures', ok: true, results: rows },
  ])
}

function marketBatch(rows: Array<Record<string, unknown>>) {
  return graphBatchResult([
    { id: 'live_market_exposures', ok: true, results: rows },
    { id: 'archive_market_exposures', ok: true, results: rows },
  ])
}

function expectNoInternalFields(value: unknown): void {
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

describe('generic exposure analysis tools', () => {
  it('scores exposure_quality from generic exposure rows', async () => {
    const callTool = vi.fn().mockResolvedValue(profileBatch([exposureRow()]))

    const result = await exposureQuality({ callTool } as never, {
      network: 'hyperliquid',
      account: '0xTrader',
      limit: 10,
    })

    expect(result.structuredContent.schema).toBe('chain-insights.exposure_quality.v1')
    expect(result.structuredContent.tool).toBe('exposure_quality')
    expect(result.structuredContent.summary.score).toBeGreaterThan(50)
    expect(result.structuredContent.components.pricing_coverage_ratio).toBe(1)
    expect(result.summaryText).toContain('Exposure quality')
    expectNoInternalFields(result.structuredContent)
  })

  it('summarizes exposure_carry across venue-native carry fields', async () => {
    const callTool = vi.fn().mockResolvedValue(profileBatch([exposureRow()]))

    const result = await exposureCarry({ callTool } as never, {
      network: 'hyperliquid',
      account: '0xTrader',
    })

    expect(result.structuredContent.schema).toBe('chain-insights.exposure_carry.v1')
    expect(result.structuredContent.summary).toMatchObject({
      carry_received: '3',
      carry_paid: '12',
      net_carry: '-9',
    })
    expect(result.structuredContent.venues[0]).toMatchObject({
      venue: 'Hyperliquid',
      exposure_count: 1,
    })
    expectNoInternalFields(result.structuredContent)
  })

  it('measures exposure_crowding for a market, subnet, hotkey, or strategy instrument', async () => {
    const callTool = vi.fn().mockResolvedValue(marketBatch([
      exposureRow({ account_address: '0xA', side: 'long' }),
      exposureRow({ account_address: '0xB', side: 'long', event_count: 8 }),
      exposureRow({ account_address: '0xC', side: 'short', event_count: 6, net_change: '-0.2' }),
    ]))

    const result = await exposureCrowding({ callTool } as never, {
      network: 'hyperliquid',
      instrument: 'BTC-PERP',
      limit: 25,
    })

    expect(result.structuredContent.schema).toBe('chain-insights.exposure_crowding.v1')
    expect(result.structuredContent.summary).toMatchObject({
      exposure_count: 3,
      leading_side: 'long',
    })
    expect(result.structuredContent.sides.map((row) => row.side)).toContain('long')
    expectNoInternalFields(result.structuredContent)
  })

  it('explains exposure_exit_pressure for Bittensor-style staking exposure too', async () => {
    const callTool = vi.fn().mockResolvedValue(profileBatch([
      exposureRow({
        venue: 'Bittensor',
        instrument_id: 'bittensor:subnet:19:hotkey:5hot',
        instrument_display_id: 'SN19 5hot',
        instrument_type: 'subnet',
        instrument_lifecycle_id: '',
        side: 'stake',
        quantity_unit: '',
        notional: '',
        quote_unit: '',
        pricing_status: 'unpriced',
        liquidation_distance: '',
        exit_pressure: 'high',
      }),
    ]))

    const result = await exposureExitPressure({ callTool } as never, {
      network: 'bittensor',
      account: '5cold',
      venue: 'Bittensor',
    })

    expect(result.structuredContent.schema).toBe('chain-insights.exposure_exit_pressure.v1')
    expect(result.structuredContent.summary.pressure_level).toBe('high')
    expect(result.structuredContent.pressure_bands).toContainEqual({
      band: 'high',
      exposure_count: 1,
    })
    expect(result.structuredContent.caveats.join(' ')).toContain('unpriced')
    expectNoInternalFields(result.structuredContent)
  })

  it('compares exposure_correlation against explicit candidate accounts', async () => {
    const callTool = vi.fn()
      .mockResolvedValueOnce(profileBatch([exposureRow()]))
      .mockResolvedValueOnce(profileBatch([exposureRow({ account_address: '0xFollower', owner_address: '0xFollower' })]))

    const result = await exposureCorrelation({ callTool } as never, {
      network: 'hyperliquid',
      account: '0xTrader',
      candidateAccounts: '0xFollower',
    })

    expect(result.structuredContent.schema).toBe('chain-insights.exposure_correlation.v1')
    expect(result.structuredContent.relationships[0]).toMatchObject({
      account: '0xFollower',
      overlap_ratio: 1,
    })
    expect(result.structuredContent.relationships[0].warning).toContain('not proof')
    expectNoInternalFields(result.structuredContent)
  })

  it('builds exposure_explain lifecycle evidence from the generic support sample', async () => {
    const callTool = vi.fn().mockResolvedValue(profileBatch([exposureRow()]))

    const result = await exposureExplain({ callTool } as never, {
      network: 'hyperliquid',
      account: '0xTrader',
      instrument: 'BTC-PERP',
      positionId: 'pos-1',
    })

    expect(result.structuredContent.schema).toBe('chain-insights.exposure_explain.v1')
    expect(result.structuredContent.summary).toMatchObject({
      explained_instrument: 'BTC-PERP',
      side: 'long',
    })
    expect(result.structuredContent.lifecycle.position_id).toBe('pos-1')
    expect(result.structuredContent.evidence[0]).toMatchObject({
      order_id: 'order-1',
      trade_id: 'trade-1',
      fill_id: 'fill-1',
      action: 'fill',
    })
    expectNoInternalFields(result.structuredContent)
  })
})
