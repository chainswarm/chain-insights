export type UsageStatusResult = {
  schema: 'chain-insights.result.v1'
  tool: 'meta_usage_status'
  facts: {
    usage: {
      mode: 'primitive_graph_backend'
      quota_enforced: false
      usage_status_tool: 'unavailable'
    }
    backend: {
      endpoint: string
      reason: string
    }
  }
  hint: string
}

export function primitiveBackendUsageStatus(endpoint: string): UsageStatusResult {
  return {
    schema: 'chain-insights.result.v1',
    tool: 'meta_usage_status',
    facts: {
      usage: {
        mode: 'primitive_graph_backend',
        quota_enforced: false,
        usage_status_tool: 'unavailable',
      },
      backend: {
        endpoint,
        reason: 'The graph backend exposes primitive graph tools but no usage_status quota tool.',
      },
    },
    hint: 'This backend does not expose Chain Insights quota telemetry; calls against it are treated as unmetered by Chain Insights.',
  }
}

export function usageStatusText(result: UsageStatusResult): string {
  return JSON.stringify(result, null, 2)
}

export function isMissingUsageStatusToolError(err: unknown): boolean {
  const message = String((err as Error).message ?? err).toLowerCase()
  return message.includes('unknown tool') ||
    message.includes('tool not found') ||
    message.includes('method not found') ||
    message.includes('usage_status')
}
