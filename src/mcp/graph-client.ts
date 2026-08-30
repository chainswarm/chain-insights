export type ToolCaller = {
  callTool(input: { name: string; arguments: Record<string, unknown> }): Promise<unknown>
}

export type GraphBatchQuery = {
  id?: string
  query: string
}

export type ChainInsightsResult = {
  schema: 'chain-insights.result.v1'
  tool: string
  facts: Record<string, unknown>
  hint: string | null
}

type CallGraphQueryBatchInput = {
  client: ToolCaller
  network: string
  queries: GraphBatchQuery[]
  perQueryTimeoutSeconds?: number
}

type CallUsageStatusInput = {
  client: ToolCaller
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeChainInsightsResult(value: unknown): ChainInsightsResult {
  if (!isRecord(value)) {
    throw new Error('graph_query_batch returned invalid response envelope')
  }

  const structuredContent = value['structuredContent']
  if (!isRecord(structuredContent)) {
    throw new Error('graph_query_batch returned invalid structuredContent')
  }

  if (structuredContent['schema'] !== 'chain-insights.result.v1') {
    throw new Error('graph_query_batch returned unsupported schema')
  }

  const tool = structuredContent['tool']
  if (typeof tool !== 'string') {
    throw new Error('graph_query_batch returned invalid tool')
  }

  const facts = structuredContent['facts']
  if (!isRecord(facts)) {
    throw new Error('graph_query_batch returned invalid facts')
  }

  const hint = structuredContent['hint']
  if (hint !== null && typeof hint !== 'string') {
    throw new Error('graph_query_batch returned invalid hint')
  }

  return {
    schema: 'chain-insights.result.v1',
    tool,
    facts,
    hint,
  }
}

export async function callGraphQueryBatch(
  input: CallGraphQueryBatchInput
): Promise<ChainInsightsResult> {
  const network = input.network.trim()
  if (!network) {
    throw new Error('network is required')
  }

  if (input.queries.length === 0) {
    throw new Error('at least one query is required')
  }

  const args: Record<string, unknown> = {
    network,
    queries: input.queries,
  }

  if (input.perQueryTimeoutSeconds !== undefined) {
    args['per_query_timeout_seconds'] = input.perQueryTimeoutSeconds
  }

  const response = await input.client.callTool({
    name: 'graph_query_batch',
    arguments: args,
  })

  return normalizeChainInsightsResult(response)
}

export async function callUsageStatus(input: CallUsageStatusInput): Promise<ChainInsightsResult> {
  const response = await input.client.callTool({
    name: 'meta_usage_status',
    arguments: {},
  })

  return normalizeChainInsightsResult(response)
}
