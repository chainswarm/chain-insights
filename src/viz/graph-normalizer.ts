const PLACEHOLDER_GRAPH_LABELS = new Set(['Address'])

type GraphRecord = Record<string, unknown>

export type NormalizedGraphPayload = {
  schema: 'chain-insights.graph.v1'
  nodes: GraphRecord[]
  edges: GraphRecord[]
  flows: unknown[]
  edge_anchors: unknown[]
  [key: string]: unknown
}

function isRecord(value: unknown): value is GraphRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function displayLabels(rawLabels: string[], currentLabels: string[]): string[] {
  const candidates = currentLabels.length > 0 ? currentLabels : rawLabels
  return unique(candidates).filter((label) => !PLACEHOLDER_GRAPH_LABELS.has(label))
}

function hasLabel(labels: string[], expected: string): boolean {
  return labels.some((label) => label.toLowerCase() === expected)
}

function normalizeRole(role: unknown, labels: string[], addressType: unknown): string | null {
  if (role === 'source_exchange') return 'exchange'
  if (role === 'deposit_candidate') return 'deposit'
  if (typeof role === 'string' && role.length > 0) return role
  if (hasLabel(labels, 'exchange') || addressType === 'exchange') return 'exchange'
  if (addressType === 'deposit') return 'deposit'
  return null
}

function normalizeNode(node: unknown): GraphRecord {
  if (!isRecord(node)) return {}

  const rawLabels = unique([
    ...stringArray(node['raw_labels']),
    ...stringArray(node['labels']),
  ])
  const normalized: GraphRecord = {}
  for (const [key, value] of Object.entries(node)) {
    if ([
      'address_type',
      'risk_level',
      'pattern_flags',
      'raw_labels',
      'labels',
      'entity_kind',
      'role',
    ].includes(key)) continue
    normalized[key] = value
  }

  const address = normalized['address'] ?? normalized['id']
  if (typeof address === 'string') normalized['address'] = address
  normalized['labels'] = displayLabels(rawLabels, stringArray(node['labels']))
  const role = normalizeRole(node['role'], rawLabels, node['address_type'])
  if (role) normalized['role'] = role

  if (typeof node['risk_level'] === 'string') normalized['risk_level'] = node['risk_level']
  if (!Array.isArray(node['flags']) && Array.isArray(node['pattern_flags']) && node['pattern_flags'].length > 0) {
    normalized['flags'] = node['pattern_flags'].map(String)
  }

  return normalized
}

function normalizeEdge(edge: unknown): GraphRecord {
  if (!isRecord(edge)) return {}
  const normalized = { ...edge }
  if (typeof normalized['from_address'] !== 'string' && typeof normalized['source'] === 'string') {
    normalized['from_address'] = normalized['source']
  }
  if (typeof normalized['to_address'] !== 'string' && typeof normalized['target'] === 'string') {
    normalized['to_address'] = normalized['target']
  }
  return normalized
}

export function normalizeGraphPayload(payload: unknown): NormalizedGraphPayload {
  if (!isRecord(payload) || payload['schema'] !== 'chain-insights.graph.v1') {
    throw new Error('Unsupported graph payload schema')
  }

  return {
    ...payload,
    schema: 'chain-insights.graph.v1',
    nodes: Array.isArray(payload['nodes']) ? payload['nodes'].map(normalizeNode) : [],
    edges: Array.isArray(payload['edges']) ? payload['edges'].map(normalizeEdge) : [],
    flows: Array.isArray(payload['flows']) ? payload['flows'] : [],
    edge_anchors: Array.isArray(payload['edge_anchors']) ? payload['edge_anchors'] : [],
  }
}
