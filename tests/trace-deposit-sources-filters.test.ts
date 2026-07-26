import { describe, expect, it, vi } from 'vitest'
import { traceDepositSources } from '../src/investigation/public-tools.js'

type BatchQuery = { id: string; query: string }

function clientWithRows(rowsPerDepth: Record<string, Array<Record<string, unknown>>>) {
  const captured: BatchQuery[] = []
  return {
    captured,
    callTool: vi.fn(async (req: { arguments: { queries: BatchQuery[] } }) => {
      captured.push(...req.arguments.queries)
      const queries = req.arguments.queries.map((q) => ({ id: q.id, ok: true, results: rowsPerDepth[q.id] ?? [] }))
      return { content: [{ type: 'text', text: JSON.stringify({ facts: { queries } }) }], isError: false }
    }),
  }
}

const config = { dataDir: '/tmp/ci-test', serverPort: 4321 }

describe('aml_trace_deposit_sources filters', () => {
  it('applies min_amount_sum and time window to the reverse query', async () => {
    const remote = clientWithRows({ seed_address_exists_1: [{ address: 'net:0xdep' }] })
    await traceDepositSources(remote as never, config, {
      depositAddresses: 'net:0xdep',
      network: 'bittensor',
      maxHops: 1,
      minAmountSum: 25,
      timeRange: { from_ms: 1715500000000 },
      writeArtifacts: false,
    })
    const reverse = remote.captured.find((q) => q.id === 'reverse_deposit_sources_1')
    expect(reverse!.query).toContain('r1.amount_usd_sum >= 25')
    expect(reverse!.query).toContain('r1.first_seen_timestamp >= 1715500000000 OR r1.last_seen_timestamp >= 1715500000000')
  })

  it('warns when a depth saturates the 500-row limit', async () => {
    const row = { source_address: 'net:0xsrc', deposit_address: 'net:0xdep', hop: 1, addresses: ['net:0xsrc', 'net:0xdep'], path_nodes: [], edge_props: [] }
    const remote = clientWithRows({
      seed_address_exists_1: [{ address: 'net:0xdep' }],
      reverse_deposit_sources_1: Array.from({ length: 500 }, () => ({ ...row })),
    })
    const result = await traceDepositSources(remote as never, config, {
      depositAddresses: 'net:0xdep',
      network: 'bittensor',
      maxHops: 1,
      writeArtifacts: false,
    })
    const warnings = (result.structuredContent as { warnings: string[] }).warnings
    expect(warnings.some((w) => w.includes('reverse_deposit_sources_1') && w.includes('500'))).toBe(true)
  })

  // Regression coverage for chain-insights#208.
  it('emits a reverse query that does not require the upstream source to be an exchange', async () => {
    // Pins the defect at the query-builder level: the pre-fix WHERE clause
    // contained `source.is_exchange IS NULL`, which restricted the entire
    // backward traversal to non-exchange-funded paths and (via the
    // now-removed reverseDepositSourceRowUsesExchange client-side filter)
    // silently dropped every exchange-funded path the query DID find. The
    // fixed query must not constrain the reported source's exchange status
    // at all -- it is classified in the result, never filtered out.
    const remote = clientWithRows({ seed_address_exists_1: [{ address: 'net:0xdep' }] })
    await traceDepositSources(remote as never, config, {
      depositAddresses: 'net:0xdep',
      network: 'bittensor',
      maxHops: 1,
      writeArtifacts: false,
    })
    const reverse = remote.captured.find((q) => q.id === 'reverse_deposit_sources_1')
    // source.is_exchange is still PROJECTED (RETURN ... source.is_exchange AS
    // source_is_exchange) so the result can classify it -- only the WHERE
    // clause must no longer constrain it.
    expect(reverse!.query).not.toContain('source.is_exchange IS NULL')
    expect(reverse!.query).not.toContain('source.is_exchange IS NOT NULL')
  })

  it('a deposit whose funders are all non-exchange returns upstream sources (not "no upstream sources")', async () => {
    const nonExchangeRow = {
      source_address: 'net:0xnonexchange',
      source_is_exchange: null,
      deposit_address: 'net:0xdep',
      deposit_is_exchange: null,
      hop: 1,
      addresses: ['net:0xnonexchange', 'net:0xdep'],
      path_nodes: [{ address: 'net:0xnonexchange', is_exchange: null }, { address: 'net:0xdep', is_exchange: null }],
      edge_props: [{ amount_usd_sum: 500, tx_count: 3 }],
    }
    const remote = clientWithRows({
      seed_address_exists_1: [{ address: 'net:0xdep' }],
      reverse_deposit_sources_1: [nonExchangeRow],
    })
    const result = await traceDepositSources(remote as never, config, {
      depositAddresses: 'net:0xdep',
      network: 'bittensor',
      maxHops: 1,
      writeArtifacts: false,
    })
    const content = result.structuredContent as {
      summary: { path_count: number; candidate_suspect_count: number; exchange_count: number }
      paths: Array<Record<string, unknown>>
      warnings: string[]
    }
    expect(content.summary.path_count).toBe(1)
    expect(content.summary.candidate_suspect_count).toBe(1)
    expect(content.summary.exchange_count).toBe(0)
    expect(content.warnings).not.toContain('No upstream sources were connected in the queried topology.')
  })

  // Pins the verified real-world defect (chain-insights#208 repro): an
  // exchange-funded upstream source was entirely dropped by the client-side
  // reverseDepositSourceRowUsesExchange filter, so a deposit funded ONLY by
  // an exchange produced path_count: 0 and the false "no upstream sources
  // were connected" warning -- even though the graph query found a real,
  // reportable funding path. Fails against pre-fix code for the right
  // reason: the row is present in the mocked results but was discarded.
  it('an exchange-funded upstream source is returned, not dropped, and is not reported as "no upstream sources"', async () => {
    const exchangeRow = {
      source_address: 'net:0xexchange',
      source_is_exchange: true,
      deposit_address: 'net:0xdep',
      deposit_is_exchange: null,
      hop: 1,
      addresses: ['net:0xexchange', 'net:0xdep'],
      path_nodes: [{ address: 'net:0xexchange', is_exchange: true, labels: ['Binance, exchange'] }, { address: 'net:0xdep', is_exchange: null }],
      edge_props: [{ amount_usd_sum: 750000, tx_count: 9 }],
    }
    const remote = clientWithRows({
      seed_address_exists_1: [{ address: 'net:0xdep' }],
      reverse_deposit_sources_1: [exchangeRow],
    })
    const result = await traceDepositSources(remote as never, config, {
      depositAddresses: 'net:0xdep',
      network: 'bittensor',
      maxHops: 1,
      writeArtifacts: false,
    })
    const content = result.structuredContent as {
      summary: { path_count: number; candidate_suspect_count: number; exchange_count: number }
      paths: Array<Record<string, unknown>>
      exchange_exposure: Array<Record<string, unknown>>
      addresses: Array<{ address: string; roles: string[] }>
      warnings: string[]
    }
    expect(content.summary.path_count).toBe(1)
    expect(content.summary.exchange_count).toBe(1)
    // Not counted/classified as a suspect candidate -- exchange hot wallets
    // stay terminal and are never suspect/intermediate/deposit candidates.
    expect(content.summary.candidate_suspect_count).toBe(0)
    expect(content.exchange_exposure).toHaveLength(1)
    expect(content.exchange_exposure[0]).toMatchObject({ address: 'net:0xexchange' })
    const exchangeAddress = content.addresses.find((entry) => entry.address === 'net:0xexchange')
    expect(exchangeAddress?.roles).toContain('exchange')
    expect(exchangeAddress?.roles).not.toContain('candidate_suspect')
    expect(content.warnings).not.toContain('No upstream sources were connected in the queried topology.')
  })

  it('returns both exchange-funded and non-exchange upstream sources for the same deposit, distinguishing exchange as a subset', async () => {
    const nonExchangeRow = {
      source_address: 'net:0xnonexchange',
      source_is_exchange: false,
      deposit_address: 'net:0xdep',
      hop: 1,
      addresses: ['net:0xnonexchange', 'net:0xdep'],
      path_nodes: [{ address: 'net:0xnonexchange', is_exchange: false }, { address: 'net:0xdep', is_exchange: null }],
      edge_props: [{ amount_usd_sum: 100, tx_count: 1 }],
    }
    const exchangeRow = {
      source_address: 'net:0xexchange',
      source_is_exchange: true,
      deposit_address: 'net:0xdep',
      hop: 1,
      addresses: ['net:0xexchange', 'net:0xdep'],
      path_nodes: [{ address: 'net:0xexchange', is_exchange: true }, { address: 'net:0xdep', is_exchange: null }],
      edge_props: [{ amount_usd_sum: 200, tx_count: 1 }],
    }
    const remote = clientWithRows({
      seed_address_exists_1: [{ address: 'net:0xdep' }],
      reverse_deposit_sources_1: [nonExchangeRow, exchangeRow],
    })
    const result = await traceDepositSources(remote as never, config, {
      depositAddresses: 'net:0xdep',
      network: 'bittensor',
      maxHops: 1,
      writeArtifacts: false,
    })
    const content = result.structuredContent as {
      summary: { path_count: number; candidate_suspect_count: number; exchange_count: number }
    }
    expect(content.summary.path_count).toBe(2)
    expect(content.summary.candidate_suspect_count).toBe(1)
    expect(content.summary.exchange_count).toBe(1)
  })

  it('reports partial query failures as a warning instead of a false "no upstream sources" claim', async () => {
    const captured: BatchQuery[] = []
    const remote = {
      captured,
      callTool: vi.fn(async (req: { arguments: { queries: BatchQuery[] } }) => {
        captured.push(...req.arguments.queries)
        const queries = req.arguments.queries.map((q) => {
          if (q.id === 'seed_address_exists_1') return { id: q.id, ok: true, results: [{ address: 'net:0xdep' }] }
          if (q.id.startsWith('reverse_deposit_sources_')) return { id: q.id, ok: false, error: 'cross_shard_unsafe_predicate: timeout' }
          return { id: q.id, ok: true, results: [] }
        })
        return { content: [{ type: 'text', text: JSON.stringify({ facts: { queries } }) }], isError: false }
      }),
    }
    const result = await traceDepositSources(remote as never, config, {
      depositAddresses: 'net:0xdep',
      network: 'bittensor',
      maxHops: 1,
      writeArtifacts: false,
    })
    const content = result.structuredContent as { summary: { path_count: number }; warnings: string[] }
    expect(content.summary.path_count).toBe(0)
    expect(content.warnings).not.toContain('No upstream sources were connected in the queried topology.')
    expect(content.warnings.some((w) => w.includes('failed') && w.includes('reverse_deposit_sources_1'))).toBe(true)
  })
})
