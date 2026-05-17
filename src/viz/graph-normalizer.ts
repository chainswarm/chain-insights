const GRAPH_TYPE_LABELS = new Set(['address', 'exchange', 'miner', 'validator', 'hotkey', 'subnet', 'ipaddress'])
const SOURCE_ADDRESS_TYPES = new Set(['substrate', 'evm'])
const FLOW_EDGE_TYPES = new Set(['flows_to', 'transfer', 'transfer_to', 'transfers_to'])

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
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function lowerSnake(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

function isGraphTypeLabel(label: string): boolean {
  return GRAPH_TYPE_LABELS.has(lowerSnake(label).replaceAll('_', ''))
}

function displayLabels(node: GraphRecord): string[] {
  return unique(stringArray(node['labels'])).filter((label) => !isGraphTypeLabel(label))
}

function systemLabels(node: GraphRecord): string[] {
  return unique([
    ...stringArray(node['system_labels']),
    ...stringArray(node['graph_labels']),
    ...stringArray(node['raw_labels']),
    ...stringArray(node['labels']).filter(isGraphTypeLabel),
  ])
}

function normalizeRoles(node: GraphRecord): string[] {
  const roles = stringArray(node['roles'])
  const role = typeof node['role'] === 'string' ? node['role'] : ''
  if (role === 'source_exchange') roles.push('exchange')
  else if (role) roles.push(role)

  const display = stringArray(node['labels']).map(lowerSnake)
  if (systemLabels(node).some((label) => lowerSnake(label) === 'exchange') || display.includes('exchange')) {
    roles.push('exchange')
  }

  return unique(roles.map(lowerSnake).filter(Boolean))
}

function normalizeNodeType(node: GraphRecord): string {
  if (typeof node['node_type'] === 'string' && node['node_type'].trim()) {
    return lowerSnake(node['node_type'])
  }
  if (typeof node['address'] === 'string' || typeof node['id'] === 'string') return 'address'
  const labels = systemLabels(node)
  if (labels.length > 0) return lowerSnake(labels[0]!)
  return 'unknown'
}

function normalizeNode(node: unknown): GraphRecord {
  if (!isRecord(node)) return {}

  const normalized: GraphRecord = {}
  for (const [key, value] of Object.entries(node)) {
    if (
      [
        'address_type',
        'address_subtypes',
        'entity_kind',
        'graph_labels',
        'labels',
        'node_type',
        'pattern_flags',
        'raw_labels',
        'role',
        'roles',
        'system_labels',
        'type',
      ].includes(key)
    ) {
      continue
    }
    normalized[key] = value
  }

  const id = typeof node['id'] === 'string' ? node['id'] : typeof node['address'] === 'string' ? node['address'] : undefined
  if (id) normalized['id'] = id

  const address = typeof node['address'] === 'string' ? node['address'] : id
  if (address) normalized['address'] = address

  normalized['node_type'] = normalizeNodeType(node)
  normalized['labels'] = displayLabels(node)

  if (typeof node['address_type'] === 'string' && SOURCE_ADDRESS_TYPES.has(node['address_type'])) {
    normalized['address_type'] = node['address_type']
  }

  const addressSubtypes = unique(stringArray(node['address_subtypes']))
  if (addressSubtypes.length > 0) normalized['address_subtypes'] = addressSubtypes

  const roles = normalizeRoles(node)
  if (roles.length > 0) normalized['roles'] = roles

  if (!Array.isArray(node['flags']) && Array.isArray(node['pattern_flags']) && node['pattern_flags'].length > 0) {
    normalized['flags'] = node['pattern_flags'].map(String)
  }

  return normalized
}

function normalizeEdgeType(edge: GraphRecord): string {
  const rawType =
    typeof edge['edge_type'] === 'string' && edge['edge_type'].trim()
      ? edge['edge_type']
      : typeof edge['type'] === 'string' && edge['type'].trim()
        ? edge['type']
        : typeof edge['relationship_type'] === 'string' && edge['relationship_type'].trim()
          ? edge['relationship_type']
          : 'related_to'
  const edgeType = lowerSnake(rawType)
  return FLOW_EDGE_TYPES.has(edgeType) ? 'flows_to' : edgeType
}

function normalizeEdge(edge: unknown): GraphRecord {
  if (!isRecord(edge)) return {}

  const normalized: GraphRecord = {}
  for (const [key, value] of Object.entries(edge)) {
    if (['edge_type', 'from_address', 'relationship_type', 'to_address', 'type'].includes(key)) continue
    normalized[key] = value
  }

  if (typeof normalized['source'] !== 'string' && typeof edge['from_address'] === 'string') {
    normalized['source'] = edge['from_address']
  }
  if (typeof normalized['target'] !== 'string' && typeof edge['to_address'] === 'string') {
    normalized['target'] = edge['to_address']
  }
  normalized['edge_type'] = normalizeEdgeType(edge)

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
