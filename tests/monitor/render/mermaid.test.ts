import { describe, expect, it } from 'vitest'
import { buildMermaidFlow, mermaidNodeText } from '../../../src/monitor/render/mermaid.js'
import type { MonitorCase } from '../../../src/monitor/cases.js'

const CASE: MonitorCase = {
  case_id: 'c1', type: 'stolen-funds', network: 'bittensor',
  seeds: ['seedAAAAAAAAAAAAAAAA', '5Short'], status: 'open', created_at_timestamp: 1000,
}

describe('buildMermaidFlow (seed set)', () => {
  it('renders a flowchart LR with one node per seed', () => {
    const out = buildMermaidFlow(CASE)
    expect(out.startsWith('flowchart LR')).toBe(true)
    expect(out).toContain('a0["seedAAAA…AAAAAA"]')
    expect(out).toContain('a1["5Short"]')
    expect(out).toContain('classDef seed')
    expect(out).toContain('class a0,a1 seed')
  })

  it('bounds output to the maxNodes largest seed set', () => {
    const big = { ...CASE, seeds: Array.from({ length: 50 }, (_, i) => `seed${i}`) }
    const out = buildMermaidFlow(big, 10)
    expect(out.split('\n').filter((l) => /a\d+\[/.test(l))).toHaveLength(10)
    expect(out).not.toContain('seed49')
  })

  it('produces valid mermaid: no raw special characters in node labels', () => {
    const out = buildMermaidFlow({ ...CASE, seeds: ['a"b|c[d]e'] })
    for (const line of out.split('\n')) {
      const nodes = line.match(/a\d+\["([^"]*)"\]/g) ?? []
      for (const node of nodes) {
        const label = /\["([^"]*)"\]/.exec(node)?.[1] ?? ''
        expect(label).not.toMatch(/["|[\]{}<>`]/)
      }
    }
    expect(mermaidNodeText('a"b|c[d]e')).not.toMatch(/["|[\]{}<>`]/)
  })

  it('shortens long addresses in labels and keeps short ones verbatim', () => {
    const addr = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
    expect(mermaidNodeText(addr)).toBe(addr.slice(0, 8) + '…' + addr.slice(-6))
    expect(mermaidNodeText('short')).toBe('short')
  })
})