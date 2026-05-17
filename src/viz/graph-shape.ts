type GraphShape = 'graph' | 'table'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function classifyGraphResultShape(rows: unknown): GraphShape {
  if (!Array.isArray(rows) || rows.length === 0) return 'table'

  return rows.some((row) => {
    if (!isRecord(row)) return false

    const hasSourceTarget = typeof row['source'] === 'string' && typeof row['target'] === 'string'
    const hasSrcDst = typeof row['src'] === 'string' && typeof row['dst'] === 'string'
    const hasPathTopology = Array.isArray(row['path'])
      || Array.isArray(row['nodes'])
      || Array.isArray(row['relationships'])

    return hasSourceTarget || hasSrcDst || hasPathTopology
  }) ? 'graph' : 'table'
}
