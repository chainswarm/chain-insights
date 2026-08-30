import { describe, expect, it } from 'vitest'

describe('graph result shape detection', () => {
  it('treats aggregate schema rows as table-shaped', async () => {
    const { classifyGraphResultShape } = await import('../src/viz/graph-shape.js')

    expect(
      classifyGraphResultShape([
        { label: 'Address', count: 387504 },
        { label: 'Exchange', count: 17 },
      ])
    ).toBe('table')
  })

  it('treats explicit source target relationship rows as graph-shaped', async () => {
    const { classifyGraphResultShape } = await import('../src/viz/graph-shape.js')

    expect(
      classifyGraphResultShape([
        { source: '5Seed', target: '5Exchange', relationship_type: 'FLOWS_TO', amount_usd_sum: 12 },
      ])
    ).toBe('graph')
  })

  it('treats explicit src dst relationship rows as graph-shaped', async () => {
    const { classifyGraphResultShape } = await import('../src/viz/graph-shape.js')

    expect(
      classifyGraphResultShape([
        { src: '5Seed', dst: '5Exchange', relationship_type: 'FLOWS_TO', amount_usd_sum: 12 },
      ])
    ).toBe('graph')
  })

  it('treats path topology rows as graph-shaped', async () => {
    const { classifyGraphResultShape } = await import('../src/viz/graph-shape.js')

    expect(classifyGraphResultShape([{ path: [{ id: '5Seed' }, { id: '5Exchange' }] }])).toBe(
      'graph'
    )
  })

  it('treats node and relationship topology rows as graph-shaped', async () => {
    const { classifyGraphResultShape } = await import('../src/viz/graph-shape.js')

    expect(
      classifyGraphResultShape([
        {
          nodes: [{ id: '5Seed' }, { id: '5Exchange' }],
          relationships: [{ source: '5Seed', target: '5Exchange' }],
        },
      ])
    ).toBe('graph')
  })

  it('treats ambiguous address rows as table-shaped', async () => {
    const { classifyGraphResultShape } = await import('../src/viz/graph-shape.js')

    expect(classifyGraphResultShape([{ address: '5Seed', degree_in: 1, degree_out: 2 }])).toBe(
      'table'
    )
  })

  it('treats empty and non-array results as table-shaped', async () => {
    const { classifyGraphResultShape } = await import('../src/viz/graph-shape.js')

    expect(classifyGraphResultShape([])).toBe('table')
    expect(classifyGraphResultShape(null)).toBe('table')
    expect(classifyGraphResultShape({ source: '5Seed', target: '5Exchange' })).toBe('table')
  })
})
