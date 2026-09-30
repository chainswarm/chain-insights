import { describe, expect, it, vi } from 'vitest'
import { addressRisk, queryBuilderContract } from '../src/investigation/public-tools.js'

// The graph stores per-label risk as three parallel lists on the address node,
// never as one `label_risk` property: `label_risk_labels`, `label_risk_levels`
// and `label_risk_updated_timestamps`. The address_profile query must project
// all three, or aml_address_risk reads a labelled address as unlabelled.

const ADDRESS = '0x00000000000000000000000000000000000000aa'

// The node as the sync writes it. There is no `label_risk` property.
const NODE: Record<string, unknown> = {
  address: ADDRESS,
  network: 'robinhood',
  labels: ['Scam', 'Sanctioned', 'Lazarus Group'],
  is_scam: true,
  is_sanctioned: true,
  label_risk_labels: ['Scam', 'Sanctioned', 'Lazarus Group'],
  label_risk_levels: ['high', 'critical', 'critical'],
  label_risk_updated_timestamps: [1700000000000, 1700000002000, 1700000001000],
  risk_level: 'UNSCORED',
}

// A graph that answers a `a.<property> AS <alias>` projection the way a real
// graph does: the stored value, or null for a property the node does not have.
function graphWithNode(node: Record<string, unknown>) {
  const queriesSeen: Array<{ id: string; query: string }> = []
  const callTool = vi.fn(
    async (req: {
      name: string
      arguments: { queries?: Array<{ id: string; query: string }> }
    }) => {
      const queries = (req.arguments.queries ?? []).map((q) => {
        queriesSeen.push(q)
        if (q.id !== 'address_profile') return { id: q.id, ok: true, results: [] }
        const row: Record<string, unknown> = {}
        for (const match of q.query.matchAll(/\ba\.(\w+) AS (\w+)/g)) {
          row[match[2]!] = node[match[1]!] ?? null
        }
        return { id: q.id, ok: true, results: [row] }
      })
      return {
        content: [{ type: 'text', text: JSON.stringify({ facts: { queries } }) }],
        isError: false,
      }
    }
  )
  return { callTool, queriesSeen }
}

describe('address_profile reads the three label_risk lists', () => {
  const { query } = queryBuilderContract.addressProfileQuery(ADDRESS)

  it('projects label_risk_labels, label_risk_levels and label_risk_updated_timestamps', () => {
    expect(query).toContain('a.label_risk_labels AS label_risk_labels')
    expect(query).toContain('a.label_risk_levels AS label_risk_levels')
    expect(query).toContain('a.label_risk_updated_timestamps AS label_risk_updated_timestamps')
  })

  it('no longer projects the retired label_risk property', () => {
    expect(query).not.toContain('a.label_risk AS label_risk')
    expect(query).not.toMatch(/a\.label_risk(?![_\w])/)
  })

  it('keeps the rest of the profile row and the LIMIT', () => {
    expect(query).toContain(`MATCH (a:Address {address: "${ADDRESS}"})`)
    expect(query).toContain('a.is_exchange AS is_exchange')
    expect(query).toContain('a.risk_score AS live_risk_score')
    expect(query).toContain('a.risk_level AS live_risk_level')
    expect(query.trim().endsWith('LIMIT 1')).toBe(true)
  })
})

describe('aml_address_risk over a graph that stores the three lists', () => {
  it('escalates on the strongest label when the ML verdict abstains', async () => {
    const graph = graphWithNode(NODE)
    const result = await addressRisk(graph as never, { address: ADDRESS, network: 'robinhood' })

    const facts = (result.structuredContent as { facts: { risk: Record<string, unknown> } }).facts
    expect(facts.risk).toMatchObject({ level: 'critical', ml_verdict: 'unscored' })
    const drivers = facts.risk['drivers'] as string[]
    expect(drivers.some((d) => d.includes('Labels:') && d.includes('Lazarus Group'))).toBe(true)
  })

  it('reports the labels in the risk sources, newest first', async () => {
    const graph = graphWithNode(NODE)
    const result = await addressRisk(graph as never, { address: ADDRESS, network: 'robinhood' })

    const facts = (result.structuredContent as { facts: { risk: Record<string, unknown> } }).facts
    const sources = facts.risk['sources'] as Array<Record<string, unknown>>
    const source = sources.find((entry) => entry['family'] === 'label_risk')
    expect(source).toMatchObject({ layer: 'topology', source: 'address_node' })
    const entries = (source ?? {})['labels'] as Array<Record<string, unknown>>
    const labels = entries.map((entry) => entry['label'])
    expect(labels).toEqual(['Sanctioned', 'Lazarus Group', 'Scam'])
  })

  it('reads an address with no label lists as unlabelled, never as an error', async () => {
    const { label_risk_labels, label_risk_levels, label_risk_updated_timestamps, ...bare } = NODE
    void label_risk_labels
    void label_risk_levels
    void label_risk_updated_timestamps
    const graph = graphWithNode({ ...bare, labels: [] })
    const result = await addressRisk(graph as never, { address: ADDRESS, network: 'robinhood' })

    const facts = (result.structuredContent as { facts: { risk: Record<string, unknown> } }).facts
    const sources = facts.risk['sources'] as Array<Record<string, unknown>>
    expect(sources.some((entry) => entry['family'] === 'label_risk')).toBe(false)
  })
})
