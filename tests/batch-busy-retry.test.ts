import { describe, expect, it } from 'vitest'
import {
  BUSY_WAIT_MS,
  MAX_ROUNDS,
  busyMemberIds,
  mergeBatchAnswers,
  withBusyMemberRetry,
} from '../src/mcp/batch-busy-retry.js'

const ok = (id: string) => ({ id, ok: true, billable_units: 1, count: 1, results: [{ nonce: 1 }] })
const busy = (id: string) => ({
  id,
  ok: false,
  billable_units: 0,
  count: 0,
  error: 'chain_busy: this caller used its share of node calls this second. Retry after a short wait.',
  error_detail: { code: 'chain_busy', rule: 'calls_per_second_per_caller', class: 'capacity' },
})
const batch = (members: Record<string, unknown>[]) => {
  const completed = members.filter((m) => m.ok).length
  const structuredContent = {
    schema: 'chain-insights.result.v1',
    tool: 'graph_query_batch',
    facts: { batch: { count: members.length, completed, failed: members.length - completed, billable_units: completed }, queries: members },
  }
  return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent, isError: false }
}
const args = { network: 'robinhood', queries: [{ id: 'a', query: 'USE chain 1' }, { id: 'b', query: 'USE chain 2' }, { id: 'c', query: 'USE chain 3' }] }

describe('graph_query_batch chain_busy members', () => {
  it('names the busy members by id', () => {
    expect(busyMemberIds(batch([ok('a'), busy('b'), busy('c')]))).toEqual(['b', 'c'])
    expect(busyMemberIds(batch([ok('a')]))).toEqual([])
  })

  it('resends only the busy members after a wait and merges them back under their ids', async () => {
    const calls: Record<string, unknown>[] = []
    const waits: number[] = []
    const call = async (a: Record<string, unknown>) => {
      calls.push(a)
      return calls.length === 1 ? batch([ok('a'), busy('b'), busy('c')]) : batch([ok('b'), ok('c')])
    }
    const result = await withBusyMemberRetry(args, call, async (ms) => { waits.push(ms) })
    expect(calls).toHaveLength(2)
    expect((calls[1].queries as { id: string }[]).map((q) => q.id)).toEqual(['b', 'c'])
    expect(waits).toEqual([BUSY_WAIT_MS])
    const facts = (result.structuredContent as { facts: { batch: Record<string, number>; queries: { id: string; ok: boolean }[] } }).facts
    expect(facts.queries.map((q) => [q.id, q.ok])).toEqual([['a', true], ['b', true], ['c', true]])
    expect(facts.batch).toMatchObject({ completed: 3, failed: 0, billable_units: 3 })
    expect(JSON.parse((result.content![0] as { text: string }).text)).toEqual(result.structuredContent)
  })

  it('stops after MAX_ROUNDS and leaves a member that stays busy as the server returned it', async () => {
    let n = 0
    const call = async () => { n += 1; return n === 1 ? batch([ok('a'), busy('b'), busy('c')]) : batch([ok('b'), busy('c')]) }
    const result = await withBusyMemberRetry(args, call, async () => {})
    expect(n).toBe(1 + MAX_ROUNDS)
    expect(busyMemberIds(result)).toEqual(['c'])
    const facts = (result.structuredContent as { facts: { batch: Record<string, number> } }).facts
    expect(facts.batch).toMatchObject({ completed: 2, failed: 1 })
  })

  it('leaves a batch with no busy member untouched and makes no second call', async () => {
    let n = 0
    const first = batch([ok('a'), ok('b')])
    const result = await withBusyMemberRetry(args, async () => { n += 1; return first }, async () => {})
    expect(n).toBe(1)
    expect(result).toBe(first)
  })

  it('merge keeps a result whose shape it does not know', () => {
    const odd = { content: [], structuredContent: { facts: { query: {} } } }
    expect(mergeBatchAnswers(odd, batch([ok('b')]))).toBe(odd)
  })
})
