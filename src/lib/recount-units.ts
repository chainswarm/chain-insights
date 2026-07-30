/**
 * Client-side mirror of the server's billable-units walker (Go: countGraphValue).
 *
 * Recognizers are EXACT, matching the server's emitted shapes byte-for-byte:
 *   - node: a map with exactly 3 keys {id, labels, properties}, string `id` starting "n:"
 *   - edge: a map with exactly 5 keys {id, type, start, end, properties}, string `id` starting "r:"
 *   - path: a map with exactly 2 keys {nodes, relationships}
 * A recognized node/edge is counted and NOT recursed into. A path recurses into its
 * nodes and relationships. Any other object/array is walked without being counted.
 * Each row counts 1 (for the row itself) plus its discovered nodes and edges. No dedup.
 *
 * This recount is inflate-only: a crafted literal that imitates the node/edge shape only
 * inflates the caller's own bill (more units counted client-side than the server charged).
 * A real node emitted by the server always has the exact recognized shape, so it can never
 * be hidden from this recount — the server-reported billable_units can only be matched or
 * undercut here if the response literally doesn't contain what the server counted.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNode(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value)
  return keys.length === 3
    && typeof value['id'] === 'string'
    && (value['id'] as string).startsWith('n:')
    && 'labels' in value
    && 'properties' in value
}

function isEdge(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value)
  return keys.length === 5
    && typeof value['id'] === 'string'
    && (value['id'] as string).startsWith('r:')
    && 'type' in value
    && 'start' in value
    && 'end' in value
    && 'properties' in value
}

function isPath(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value)
  return keys.length === 2 && 'nodes' in value && 'relationships' in value
}

interface Counts {
  nodes: number
  edges: number
}

function countGraphValue(value: unknown, counts: Counts): void {
  if (Array.isArray(value)) {
    for (const item of value) countGraphValue(item, counts)
    return
  }

  if (!isRecord(value)) return

  if (isNode(value)) {
    counts.nodes += 1
    return
  }

  if (isEdge(value)) {
    counts.edges += 1
    return
  }

  if (isPath(value)) {
    countGraphValue(value['nodes'], counts)
    countGraphValue(value['relationships'], counts)
    return
  }

  for (const key of Object.keys(value)) countGraphValue(value[key], counts)
}

export function recountBillableUnits(
  results: Array<Record<string, unknown>>,
): { rows: number; nodes: number; edges: number; total: number } {
  const counts: Counts = { nodes: 0, edges: 0 }

  for (const row of results) {
    for (const value of Object.values(row)) countGraphValue(value, counts)
  }

  const rows = results.length
  return { rows, nodes: counts.nodes, edges: counts.edges, total: rows + counts.nodes + counts.edges }
}
