// src/monitor/render/mermaid.ts
// Bounded money-flow diagram (spec req 3: seeds → intermediaries → terminals,
// bounded to the significant paths). Pure over persisted trace docs.
import type { TraceV1Doc } from './trace-io.js'

export const DEFAULT_MERMAID_MAX_EDGES = 30

/** Address shown in a node: first 8 + … + last 6 chars for long addresses;
 *  strips characters Mermaid treats as syntax. Exported for tests. */
export function mermaidNodeText(address: string): string {
  const safe = address.replace(/["|[\]{}<>`]/g, '')
  return safe.length <= 16 ? safe : safe.slice(0, 8) + '…' + safe.slice(-6)
}

/** flowchart LR of the money flow, bounded to the maxEdges highest-value
 *  edges (deduped across docs by from->to; amounts merged max-wise). Seeds get
 *  a `seed` class, exchanges `exchange`, deposit candidates `deposit`.
 *  Returns the full fenced block content WITHOUT the ```mermaid fence. */
export function buildMermaidFlow(
  docs: TraceV1Doc[],
  seeds: string[],
  maxEdges: number = DEFAULT_MERMAID_MAX_EDGES,
): string {
  // Dedupe edges by from->to; the highest observed amount wins.
  const merged = new Map<string, { from: string; to: string; amount?: number; edgeType?: string }>()
  for (const doc of docs) {
    for (const edge of doc.edges) {
      const key = `${edge.from_address} ${edge.to_address}`
      const existing = merged.get(key)
      const amount = edge.amount_usd_sum
      const edgeType = edge.edge_type?.toLowerCase()
      if (!existing) {
        merged.set(key, { from: edge.from_address, to: edge.to_address, amount, edgeType })
      } else if (amount !== undefined && (existing.amount === undefined || amount > existing.amount)) {
        existing.amount = amount
      }
    }
  }
  const kept = [...merged.values()]
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
    .slice(0, maxEdges)

  // Address classification from seeds and doc metadata.
  const seedSet = new Set(seeds)
  const exchanges = new Set<string>()
  const deposits = new Set<string>()
  for (const doc of docs) {
    for (const a of doc.addresses) {
      if (a.is_exchange || a.roles.includes('exchange')) exchanges.add(a.address)
      if (a.roles.includes('candidate_deposit')) deposits.add(a.address)
    }
  }

  // Synthetic ids a0..aN in first-seen order — raw addresses never become ids.
  const ids = new Map<string, string>()
  const idOf = (address: string): string => {
    let id = ids.get(address)
    if (!id) ids.set(address, (id = `a${ids.size}`))
    return id
  }
  const lines = ['flowchart LR']
  const declared = new Set<string>()
  const declare = (address: string): string => {
    const id = idOf(address)
    if (!declared.has(id)) {
      declared.add(id)
      lines.push(`  ${id}["${mermaidNodeText(address)}"]`)
    }
    return id
  }
  const trailLinkStyles: string[] = []
  let linkIndex = 0
  for (const edge of kept) {
    const from = declare(edge.from)
    const to = declare(edge.to)
    // MONEY_TRAIL / TRAIL_ENDS_AT are the precomputed money-trail layer --
    // labeled and dashed so they read as their own layer, never as an
    // ordinary flow edge (D3/D4: distinct types, "money trail" wording).
    const isTrail = edge.edgeType === 'money_trail' || edge.edgeType === 'trail_ends_at'
    const trailWords = edge.edgeType === 'trail_ends_at' ? 'trail ends at' : isTrail ? 'money trail' : undefined
    const amountText = edge.amount !== undefined ? `$${edge.amount.toFixed(2)}` : ''
    const labelText = trailWords ? [trailWords, amountText].filter(Boolean).join(' ') : amountText
    const label = labelText ? `|"${labelText}"|` : ''
    lines.push(`  ${from} -->${label} ${to}`)
    if (isTrail) {
      trailLinkStyles.push(`  linkStyle ${linkIndex} stroke:#f97316,stroke-width:2px,stroke-dasharray:5 5`)
    }
    linkIndex += 1
  }
  lines.push(...trailLinkStyles)
  lines.push('  classDef seed fill:#fde68a,stroke:#b45309')
  lines.push('  classDef exchange fill:#bfdbfe,stroke:#1d4ed8')
  lines.push('  classDef deposit fill:#bbf7d0,stroke:#15803d')
  for (const [address, id] of ids) {
    if (seedSet.has(address)) lines.push(`  class ${id} seed`)
    else if (exchanges.has(address)) lines.push(`  class ${id} exchange`)
    else if (deposits.has(address)) lines.push(`  class ${id} deposit`)
  }
  return lines.join('\n')
}
