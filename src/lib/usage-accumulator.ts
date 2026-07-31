/**
 * Per-workflow billable-units accounting for the aml_* tools (rbmk feat:
 * usage-units-propagation). The `aml_*` workflow tools make MANY internal
 * graph_query_batch round trips to answer one high-level question; this
 * module totals what those round trips billed so the workflow response can
 * report a single `usage` block instead of exposing nothing at all.
 *
 * Capture point: aml_address_risk / aml_trace_victim_funds /
 * aml_trace_suspect_funds / aml_trace_deposit_sources each wrap their
 * `remoteClient` once via `wrapClientForUsageTracking` before making any
 * internal calls, then read the shared `UsageTotals` back out when building
 * their response. Every internal helper (callGraphBatch, probeSeedAddresses,
 * runFundFlowProbe, ...) keeps calling `client.callTool(...)` exactly as
 * before -- the wrapper observes graph_query_batch/graph_query responses in
 * transit and never changes their return value.
 *
 * Defensive by design: a backend that does not yet emit billing fields (or
 * an unparsable response) contributes 0 units but the call still counts
 * toward `query_count` -- this must never throw and never block a workflow.
 */

interface CallToolLike {
  callTool(...args: unknown[]): Promise<unknown>
}

export interface UsageTotals {
  billable_units: number
  query_count: number
  truncated_queries: number
}

export function createUsageAccumulator(): UsageTotals {
  return { billable_units: 0, query_count: 0, truncated_queries: 0 }
}

// Snapshot as a plain object for embedding in a response -- callers should
// not hand out the live mutable accumulator.
export function usageBlock(totals: UsageTotals): UsageTotals {
  return { billable_units: totals.billable_units, query_count: totals.query_count, truncated_queries: totals.truncated_queries }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function textOfToolResult(result: unknown): string {
  if (!isRecord(result)) return ''
  const content = result['content']
  if (!Array.isArray(content)) return ''
  return content
    .filter((item): item is { type: 'text'; text: string } => isRecord(item) && item['type'] === 'text' && typeof item['text'] === 'string')
    .map((item) => item.text)
    .join('\n')
}

// facts.query.* is the single-query shape (graph_query). facts.batch.* /
// facts.queries[] is the batch shape (graph_query_batch). Both are read
// defensively -- missing/malformed fields never throw, they just contribute
// nothing to the total.
function accumulateFacts(totals: UsageTotals, facts: unknown): void {
  if (!isRecord(facts)) return

  const query = facts['query']
  if (isRecord(query)) {
    const units = numberValue(query['billable_units'])
    if (units !== undefined) totals.billable_units += units
    if (query['truncated'] === true) totals.truncated_queries += 1
  }

  const batch = facts['batch']
  const batchUnits = isRecord(batch) ? numberValue(batch['billable_units']) : undefined
  const queries = Array.isArray(facts['queries'])
    ? (facts['queries'] as unknown[]).filter(isRecord)
    : undefined

  if (batchUnits !== undefined) {
    totals.billable_units += batchUnits
  } else if (queries) {
    // No batch-level total (older/mocked backend): fall back to summing
    // whatever per-query billable_units are present. Entries with no field
    // contribute 0, same as the single-query defensive path.
    for (const entry of queries) {
      const units = numberValue(entry['billable_units'])
      if (units !== undefined) totals.billable_units += units
    }
  }

  if (queries) {
    for (const entry of queries) {
      if (entry['truncated'] === true) totals.truncated_queries += 1
    }
  } else if (isRecord(batch) && batch['truncated'] === true) {
    totals.truncated_queries += 1
  }
}

// One graph_query_batch round trip is one query_count unit per Cypher
// statement it carried (facts.queries.length) -- that is what "one internal
// graph query" means for this tool. A round trip whose response could not be
// attributed to individual statements (parse failure, missing facts.queries)
// still represents one internal graph query having been issued, so it counts
// as 1 rather than 0.
function recordGraphQueryBatchResult(totals: UsageTotals, rawResult: unknown): void {
  let facts: unknown
  try {
    const text = textOfToolResult(rawResult).trim()
    if (text) facts = (JSON.parse(text) as { facts?: unknown }).facts
    else if (isRecord(rawResult) && isRecord((rawResult as Record<string, unknown>)['structuredContent'])) {
      facts = ((rawResult as Record<string, unknown>)['structuredContent'] as Record<string, unknown>)['facts']
    }
  } catch {
    facts = undefined
  }

  const queries = isRecord(facts) && Array.isArray(facts['queries']) ? (facts['queries'] as unknown[]) : undefined
  totals.query_count += queries ? queries.length : 1
  accumulateFacts(totals, facts)
}

// One graph_query round trip is exactly one internal graph query.
function recordGraphQueryResult(totals: UsageTotals, rawResult: unknown): void {
  totals.query_count += 1
  let facts: unknown
  try {
    if (isRecord(rawResult) && isRecord((rawResult as Record<string, unknown>)['structuredContent'])) {
      facts = ((rawResult as Record<string, unknown>)['structuredContent'] as Record<string, unknown>)['facts']
    } else {
      const text = textOfToolResult(rawResult).trim()
      if (text) facts = (JSON.parse(text) as { facts?: unknown }).facts
    }
  } catch {
    facts = undefined
  }
  accumulateFacts(totals, facts)
}

// Wraps a Client-shaped object (real MCP SDK Client or a test double) so
// every graph_query_batch/graph_query call it makes is observed and totaled
// into `totals`, without changing what the call returns. Any other method
// or property passes through untouched.
export function wrapClientForUsageTracking<T extends CallToolLike>(client: T, totals: UsageTotals): T {
  return new Proxy(client as object, {
    get(target, prop, receiver) {
      if (prop === 'callTool') {
        return async (...args: unknown[]) => {
          const result = await (target as CallToolLike).callTool(...args)
          const request = args[0]
          const toolName = isRecord(request) && typeof request['name'] === 'string' ? request['name'] : undefined
          if (toolName === 'graph_query_batch') {
            recordGraphQueryBatchResult(totals, result)
          } else if (toolName === 'graph_query') {
            recordGraphQueryResult(totals, result)
          }
          return result
        }
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as T
}
