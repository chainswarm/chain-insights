import { readFile } from 'node:fs/promises'
import { GraphData, GraphNode, GraphEdge } from './graph-model.js'

/**
 * Extracts all items from ```json code blocks in a markdown string.
 * If the parsed value is an array, spreads all items.
 * If the parsed value has 'nodes' and 'edges', wraps it as a single item.
 * Returns empty array if no JSON blocks found or parsing fails.
 */
export function parseEvidenceJson(markdown: string): unknown[] {
  const results: unknown[] = []
  const re = /```json\s*\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = re.exec(markdown)) !== null) {
    const raw = match[1]
    if (!raw) continue
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        results.push(...parsed)
      } else if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'nodes' in (parsed as object) &&
        'edges' in (parsed as object)
      ) {
        // Full GraphData object embedded in evidence
        results.push(parsed)
      }
      // Ignore other object types
    } catch {
      // Malformed JSON in evidence — skip gracefully (T-04-06: no crash)
    }
  }
  if (results.length > 0) return results

  const rawJson = extractEmbeddedJson(markdown)
  if (rawJson) {
    try {
      const parsed: unknown = JSON.parse(rawJson)
      if (Array.isArray(parsed)) return parsed
      if (parsed !== null && typeof parsed === 'object') return [parsed]
    } catch {
      // Ignore non-JSON evidence bodies.
    }
  }
  return results
}

function extractEmbeddedJson(text: string): string | null {
  const trimmed = text.trim()
  const start = [...trimmed]
    .map((char, index) => (char === '{' || char === '[' ? index : -1))
    .find(index => index >= 0)
  if (start === undefined) return null
  return trimmed.slice(start)
}

type SimpleTx = { from: string; to: string; value: number; txHash?: string; blockNumber?: number; timestamp?: string }

type CompactEvidence = {
  schema?: string
  outgoing_flows?: Array<{
    src?: string
    dst?: string
    amount_usd_sum?: number
    tx_count?: number
    first_tx_id?: string
  }>
}

function isSimpleTx(item: unknown): item is SimpleTx {
  return (
    item !== null &&
    typeof item === 'object' &&
    'from' in (item as object) &&
    'to' in (item as object) &&
    'value' in (item as object)
  )
}

function isGraphDataLike(input: unknown): input is { nodes: unknown[]; edges: unknown[] } {
  return (
    input !== null &&
    typeof input === 'object' &&
    Array.isArray((input as Record<string, unknown>)['nodes']) &&
    Array.isArray((input as Record<string, unknown>)['edges'])
  )
}

function compactEvidenceToSimpleTxs(item: unknown): SimpleTx[] {
  const compact = item as CompactEvidence
  if (
    !compact ||
    typeof compact !== 'object' ||
    compact.schema !== 'chain-insights.compact_evidence.v1' ||
    !Array.isArray(compact.outgoing_flows)
  ) {
    return []
  }

  return compact.outgoing_flows
    .filter(flow => typeof flow.src === 'string' && typeof flow.dst === 'string' && typeof flow.amount_usd_sum === 'number')
    .map(flow => ({
      from: flow.src!,
      to: flow.dst!,
      value: flow.amount_usd_sum!,
      txHash: flow.first_tx_id,
    }))
}

/**
 * Converts simple [{from, to, value}] transaction arrays into graph nodes.
 * Computes totalIn, totalOut, txCount per node from edges.
 */
function buildGraphFromSimpleTxs(items: SimpleTx[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  // Build edges first
  const edges: GraphEdge[] = items.map(tx => GraphEdge.parse({
    source: tx.from,
    target: tx.to,
    value: tx.value,
    txHash: tx.txHash,
    blockNumber: tx.blockNumber,
    timestamp: tx.timestamp,
  }))

  // Collect unique addresses
  const addresses = new Set<string>()
  for (const tx of items) {
    addresses.add(tx.from)
    addresses.add(tx.to)
  }

  // Compute totals per address
  const totals: Record<string, { totalIn: number; totalOut: number; txCount: number }> = {}
  for (const addr of addresses) {
    totals[addr] = { totalIn: 0, totalOut: 0, txCount: 0 }
  }
  for (const tx of items) {
    const out = totals[tx.from]
    const inp = totals[tx.to]
    if (out) {
      out.totalOut += tx.value
      out.txCount += 1
    }
    if (inp) {
      inp.totalIn += tx.value
      inp.txCount += 1
    }
  }

  const nodes: GraphNode[] = [...addresses].map(addr =>
    GraphNode.parse({
      id: addr,
      entityType: 'unknown',
      riskLevel: 'unknown',
      totalIn: totals[addr]?.totalIn ?? 0,
      totalOut: totals[addr]?.totalOut ?? 0,
      txCount: totals[addr]?.txCount ?? 0,
    })
  )

  return { nodes, edges }
}

/**
 * Handles two input formats:
 * 1. Full GraphData object (has nodes + edges) — parse with Zod
 * 2. Array of {from, to, value, ...} transaction objects — auto-derive nodes
 *
 * Throws "Invalid transaction data" for any other input.
 */
export function extractGraphFromJson(input: unknown): GraphData {
  if (isGraphDataLike(input)) {
    // Full GraphData: parse and validate through Zod
    return GraphData.parse(input)
  }

  if (Array.isArray(input)) {
    const simpleTxs: SimpleTx[] = []
    for (const item of input) {
      if (isSimpleTx(item)) {
        simpleTxs.push(item)
      } else {
        simpleTxs.push(...compactEvidenceToSimpleTxs(item))
      }
    }
    const { nodes, edges } = buildGraphFromSimpleTxs(simpleTxs)
    return GraphData.parse({
      nodes,
      edges,
      metadata: {
        title: 'Money Flow',
        generatedAt: new Date().toISOString(),
      },
    })
  }

  throw new Error(
    'Invalid transaction data. The input file must contain a JSON array of transaction objects with `from`, `to`, and `value` fields.'
  )
}

/**
 * Merges two sets of nodes, deduplicating by id.
 * For duplicate nodes, sums totalIn, totalOut, txCount; keeps earliest firstSeen, latest lastSeen.
 */
function mergeNodes(existing: GraphNode[], incoming: GraphNode[]): GraphNode[] {
  const map = new Map<string, GraphNode>()
  for (const node of existing) {
    map.set(node.id, { ...node })
  }
  for (const node of incoming) {
    const prev = map.get(node.id)
    if (prev) {
      map.set(node.id, {
        ...prev,
        totalIn: prev.totalIn + node.totalIn,
        totalOut: prev.totalOut + node.totalOut,
        txCount: prev.txCount + node.txCount,
        firstSeen: pickEarlier(prev.firstSeen, node.firstSeen),
        lastSeen: pickLater(prev.lastSeen, node.lastSeen),
      })
    } else {
      map.set(node.id, { ...node })
    }
  }
  return [...map.values()]
}

function pickEarlier(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b
  if (!b) return a
  return a < b ? a : b
}

function pickLater(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b
  if (!b) return a
  return a > b ? a : b
}

/**
 * Aggregates edges: for duplicate (source, target) pairs, sums value; keeps last txHash/timestamp.
 */
function aggregateEdges(edges: GraphEdge[]): GraphEdge[] {
  const map = new Map<string, GraphEdge>()
  for (const edge of edges) {
    const key = `${edge.source}::${edge.target}`
    const prev = map.get(key)
    if (prev) {
      map.set(key, { ...edge, value: prev.value + edge.value })
    } else {
      map.set(key, { ...edge })
    }
  }
  return [...map.values()]
}

/**
 * Reads evidence files from a case directory, extracts JSON transaction data
 * from markdown code blocks, enriches nodes with entity types from dossiers,
 * and returns a merged GraphData.
 */
export const DataExtractor = {
  extractGraphFromJson,
  parseEvidenceJson,
}
