import { describe, expect, it } from 'vitest'
import { bfsAttribution } from '../../src/detection/detectors/attack-attribution.js'

// In-memory adjacency for the pure BFS core.
function graph(edges: Record<string, string[]>, boundaries: string[] = []) {
  const bset = new Set(boundaries.map((b) => b.toLowerCase()))
  return {
    neighbors: async (a: string) => edges[a] ?? [],
    isBoundary: async (a: string) => bset.has(a.toLowerCase()),
  }
}

describe('bfsAttribution', () => {
  it('attributes downstream nodes to their reaching seed with the shortest hop', async () => {
    const g = graph({ seed: ['a', 'b'], a: ['c'], c: ['d'] })
    const out = await bfsAttribution(['seed'], g.neighbors, g.isBoundary, 3)
    const byAddr = new Map(out.map((n) => [n.address, n]))
    expect(new Set(out.map((n) => n.address))).toEqual(new Set(['a', 'b', 'c', 'd']))
    expect(byAddr.get('a')?.hop).toBe(1)
    expect(byAddr.get('c')?.hop).toBe(2)
    expect(byAddr.get('d')?.hop).toBe(3)
    expect(byAddr.get('a')?.seed).toBe('seed')
  })

  it('does not emit the seed itself', async () => {
    const g = graph({ seed: ['a'] })
    const out = await bfsAttribution(['seed'], g.neighbors, g.isBoundary, 2)
    expect(out.map((n) => n.address)).not.toContain('seed')
  })

  it('stops at boundary nodes: not attributed, not expanded through', async () => {
    const g = graph({ seed: ['exch'], exch: ['deep'] }, ['exch'])
    const out = await bfsAttribution(['seed'], g.neighbors, g.isBoundary, 3)
    expect(out.map((n) => n.address)).toEqual([]) // exch excluded, deep unreachable
  })

  it('respects the hop limit', async () => {
    const g = graph({ seed: ['a'], a: ['b'], b: ['c'] })
    const out = await bfsAttribution(['seed'], g.neighbors, g.isBoundary, 1)
    expect(out.map((n) => n.address)).toEqual(['a'])
  })

  it('does not revisit a node reached by two paths', async () => {
    const g = graph({ seed: ['a', 'b'], a: ['shared'], b: ['shared'] })
    const out = await bfsAttribution(['seed'], g.neighbors, g.isBoundary, 3)
    expect(out.filter((n) => n.address === 'shared')).toHaveLength(1)
  })
})
