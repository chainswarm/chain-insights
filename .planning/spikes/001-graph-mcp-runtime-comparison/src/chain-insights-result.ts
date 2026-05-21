export const CHAIN_INSIGHTS_RESULT_SCHEMA = 'chain-insights.result.v1'

export type ChainInsightsResult = {
  schema: typeof CHAIN_INSIGHTS_RESULT_SCHEMA
  tool: string
  hint: string | null
  facts: Record<string, unknown>
}

export function buildGraphQueryResult(network: string, payload: { results: unknown[]; count: number }) {
  const structuredContent: ChainInsightsResult = {
    schema: CHAIN_INSIGHTS_RESULT_SCHEMA,
    tool: 'graph_query',
    hint: null,
    facts: {
      subject: { network },
      query: payload,
    },
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload),
      },
    ],
    structuredContent,
  }
}
