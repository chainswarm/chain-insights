import { describe, expect, it } from 'vitest'
import { buildMermaidFlow, mermaidNodeText } from '../../../src/monitor/render/mermaid.js'
import type { TraceV1Doc } from '../../../src/monitor/render/trace-io.js'

const doc = (edges: TraceV1Doc['edges'], addresses: TraceV1Doc['addresses'] = []): TraceV1Doc => ({
  schema: 'chain-insights.trace.v1', tool: 'aml_trace_victim_funds',
  network: 'bittensor', addresses, edges, paths: [],
})

describe('buildMermaidFlow', () => {
  it('renders a flowchart LR with seed, intermediary and exchange nodes', () => {
    const out = buildMermaidFlow([doc(
      [
        { edge_id: 'e1', from_address: 'seedAAAAAAAAAAAAAAAA', to_address: 'hop1', amount_usd_sum: 100 },
        { edge_id: 'e2', from_address: 'hop1', to_address: 'exch1', amount_usd_sum: 90 },
      ],
      [{ address: 'exch1', roles: ['exchange'] }],
    )], ['seedAAAAAAAAAAAAAAAA'])
    expect(out.startsWith('flowchart LR')).toBe(true)
    expect(out).toContain('-->')
    expect(out).toContain('class a0 seed')
    expect(out).toMatch(/class a\d+ exchange/)
    expect(out).not.toContain('seedAAAAAAAAAAAAAAAA[')  // ids are synthetic
  })

  it('bounds output to the maxEdges highest-value edges', () => {
    const edges = Array.from({ length: 50 }, (_, i) => ({
      edge_id: `e${i}`, from_address: `src${i}`, to_address: `dst${i}`, amount_usd_sum: i,
    }))
    const out = buildMermaidFlow([doc(edges)], [], 10)
    expect(out.split('\n').filter((l) => l.includes('-->')).length).toBe(10)
    expect(out).toContain('$49')   // highest-value edge kept
    expect(out).not.toContain('$0.00') // lowest dropped
  })

  it('dedupes edges across docs (max amount wins)', () => {
    const out = buildMermaidFlow([
      doc([{ edge_id: 'e1', from_address: 'a', to_address: 'b', amount_usd_sum: 5 }]),
      doc([{ edge_id: 'e1', from_address: 'a', to_address: 'b', amount_usd_sum: 8 }]),
    ], [])
    expect(out.split('\n').filter((l) => l.includes('-->')).length).toBe(1)
    expect(out).toContain('$8.00')
  })

  it('produces valid mermaid: no raw special characters in node labels', () => {
    const out = buildMermaidFlow([doc([
      { edge_id: 'e1', from_address: 'a"b|c[d]e', to_address: 'x', amount_usd_sum: 1 },
    ])], [])
    for (const line of out.split('\n')) {
      const nodes = line.match(/a\d+\["([^"]*)"\]/g) ?? []
      for (const node of nodes) {
        const label = /\["([^"]*)"\]/.exec(node)?.[1] ?? ''
        expect(label).not.toMatch(/["|[\]{}<>`]/)
      }
    }
    expect(mermaidNodeText('a"b|c[d]e')).not.toMatch(/["|[\]{}<>`]/)
  })

  it('shortens long addresses in labels', () => {
    const addr = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
    expect(mermaidNodeText(addr)).toBe(addr.slice(0, 8) + '…' + addr.slice(-6))
    expect(mermaidNodeText('short')).toBe('short')
  })

  it('styles MONEY_TRAIL edges as a distinct labeled/dashed layer ("money trail" wording)', () => {
    const out = buildMermaidFlow([doc([
      { edge_id: 'e1', from_address: 'seedAAAAAAAAAAAAAAAA', to_address: 'hop1', amount_usd_sum: 100, edge_type: 'MONEY_TRAIL' },
    ])], ['seedAAAAAAAAAAAAAAAA'])
    expect(out).toContain('money trail')
    expect(out).toMatch(/linkStyle 0 .*stroke-dasharray/)
  })

  it('styles TRAIL_ENDS_AT edges distinctly, labeled "trail ends at" (seed to venue shortcut)', () => {
    const out = buildMermaidFlow([doc([
      { edge_id: 'e1', from_address: 'seedAAAAAAAAAAAAAAAA', to_address: 'venue1', amount_usd_sum: 100, edge_type: 'TRAIL_ENDS_AT' },
    ])], ['seedAAAAAAAAAAAAAAAA'])
    expect(out).toContain('trail ends at')
    expect(out).toMatch(/linkStyle 0 .*stroke-dasharray/)
  })

  it('does not apply trail styling to plain flow edges', () => {
    const out = buildMermaidFlow([doc([
      { edge_id: 'e1', from_address: 'a', to_address: 'b', amount_usd_sum: 5 },
    ])], [])
    expect(out).not.toContain('linkStyle')
    expect(out).not.toContain('money trail')
  })
})
