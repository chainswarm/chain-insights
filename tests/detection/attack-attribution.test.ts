import { describe, expect, it } from 'vitest'
import { ATTRIBUTION_SEED_LABELS, bfsAttribution, type DownstreamNode } from '../../src/detection/detectors/attack-attribution.js'

// In-memory batched expander for the pure BFS core: given a frontier, return
// each src's downstream nodes tagged with their boundary flag.
function expander(edges: Record<string, string[]>, boundaries: string[] = []) {
  const bset = new Set(boundaries.map((b) => b.toLowerCase()))
  return async (frontier: string[]) => {
    const out = new Map<string, DownstreamNode[]>()
    for (const src of frontier) {
      const downstream = (edges[src] ?? []).map((address) => ({ address, boundary: bset.has(address.toLowerCase()) }))
      if (downstream.length) out.set(src, downstream)
    }
    return out
  }
}

describe('ATTRIBUTION_SEED_LABELS (label-governance Plan 3 D4 guard)', () => {
  // :Attributed is context, never a seed family (spec :744) — this detector's
  // seed set must stay exactly ['Scam'], the graph-expressible form of the
  // curated poisoning_duster/dusting_source/fake_token_contract seed
  // subtypes; :Attributed must never be added here.
  it('is exactly [\'Scam\'] and does not include Attributed', () => {
    expect(ATTRIBUTION_SEED_LABELS).toEqual(['Scam'])
  })
})

describe('bfsAttribution', () => {
  it('attributes downstream nodes to their reaching seed with the shortest hop', async () => {
    const out = await bfsAttribution(['seed'], expander({ seed: ['a', 'b'], a: ['c'], c: ['d'] }), 3)
    const byAddr = new Map(out.map((n) => [n.address, n]))
    expect(new Set(out.map((n) => n.address))).toEqual(new Set(['a', 'b', 'c', 'd']))
    expect(byAddr.get('a')?.hop).toBe(1)
    expect(byAddr.get('c')?.hop).toBe(2)
    expect(byAddr.get('d')?.hop).toBe(3)
    expect(byAddr.get('a')?.seed).toBe('seed')
  })

  it('does not emit the seed itself', async () => {
    const out = await bfsAttribution(['seed'], expander({ seed: ['a'] }), 2)
    expect(out.map((n) => n.address)).not.toContain('seed')
  })

  it('stops at boundary nodes: not attributed, not expanded through', async () => {
    const out = await bfsAttribution(['seed'], expander({ seed: ['exch'], exch: ['deep'] }, ['exch']), 3)
    expect(out.map((n) => n.address)).toEqual([]) // exch excluded, deep unreachable
  })

  it('respects the hop limit', async () => {
    const out = await bfsAttribution(['seed'], expander({ seed: ['a'], a: ['b'], b: ['c'] }), 1)
    expect(out.map((n) => n.address)).toEqual(['a'])
  })

  it('does not revisit a node reached by two paths', async () => {
    const out = await bfsAttribution(['seed'], expander({ seed: ['a', 'b'], a: ['shared'], b: ['shared'] }), 3)
    expect(out.filter((n) => n.address === 'shared')).toHaveLength(1)
  })

  it('expands the whole frontier in one call per hop', async () => {
    const calls: string[][] = []
    const wrapped = async (frontier: string[]) => {
      calls.push(frontier)
      return expander({ seed: ['a', 'b'], a: ['c'], b: ['d'] })(frontier)
    }
    await bfsAttribution(['seed'], wrapped, 2)
    // hop 1 expands [seed]; hop 2 expands [a, b] together — 2 calls, not 3.
    expect(calls.length).toBe(2)
    expect(new Set(calls[1])).toEqual(new Set(['a', 'b']))
  })
})
