export interface McpTextResult {
  content?: Array<{ type: string; text?: string }>
  isError?: boolean
}

export interface McpPrintOptions {
  tool?: string
  json?: boolean
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function formatTable(rows: Array<JsonRecord>): string[] {
  if (rows.length === 0) return []
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  const values = rows.map((row) => columns.map((column) => displayValue(row[column])))
  const widths = columns.map((column, index) =>
    Math.max(column.length, ...values.map((row) => row[index]?.length ?? 0))
  )
  const line = (row: string[]): string =>
    row
      .map((value, index) => (index === row.length - 1 ? value : value.padEnd(widths[index] ?? 0)))
      .join(' | ')
  return [line(columns), widths.map((width) => '-'.repeat(width)).join('-+-'), ...values.map(line)]
}

function formatGraphResult(value: JsonRecord, fallbackTool?: string): string | null {
  const facts = isRecord(value.facts) ? value.facts : undefined
  const query = facts && isRecord(facts.query) ? facts.query : undefined
  const queries = facts && Array.isArray(facts.queries) ? facts.queries : undefined
  if (!query && !queries) return null

  const lines = [`Tool: ${displayValue(value.tool) || fallbackTool || 'MCP result'}`]
  const subject = isRecord(value.subject)
    ? value.subject
    : facts && isRecord(facts.subject)
      ? facts.subject
      : undefined
  if (subject?.network !== undefined) lines.push(`Network: ${displayValue(subject.network)}`)

  if (query) {
    const results = Array.isArray(query.results) ? query.results.filter(isRecord) : []
    if (query.count !== undefined) lines.push(`Rows: ${displayValue(query.count)}`)
    else lines.push(`Rows: ${results.length}`)
    if (query.billable_units !== undefined) {
      lines.push(`Billed units: ${displayValue(query.billable_units)}`)
    }
    if (query.elapsed_ms !== undefined) lines.push(`Elapsed: ${displayValue(query.elapsed_ms)} ms`)
    if (query.truncated !== undefined) lines.push(`Truncated: ${displayValue(query.truncated)}`)
    if (query.error !== undefined) lines.push(`Error: ${displayValue(query.error)}`)
    if (results.length > 0) lines.push('', 'Results:', ...formatTable(results))
    else lines.push('', 'Results: none')
  }

  if (queries) {
    lines.push(`Queries: ${queries.length}`)
    for (const entry of queries) {
      if (!isRecord(entry)) continue
      const id = displayValue(entry.id) || 'query'
      const results = Array.isArray(entry.results) ? entry.results.filter(isRecord) : []
      lines.push('', `[${id}]`)
      if (entry.error !== undefined) lines.push(`Error: ${displayValue(entry.error)}`)
      lines.push(`Rows: ${displayValue(entry.count ?? results.length)}`)
      if (results.length > 0) lines.push(...formatTable(results))
      else lines.push('Results: none')
    }
  }

  return lines.join('\n')
}

/**
 * Formats one MCP text block for terminal output. JSON is indented when the
 * caller requests `--json`; graph query envelopes are rendered as a compact
 * result summary and table by default.
 */
export function formatMcpTextContent(
  text: string,
  tool?: string,
  options: Pick<McpPrintOptions, 'json'> = {}
): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return text
  }

  if (options.json) {
    try {
      return JSON.stringify(parsed, null, 2)
    } catch {
      return text
    }
  }

  if (isRecord(parsed)) {
    return formatGraphResult(parsed, tool) ?? JSON.stringify(parsed, null, 2)
  }
  return displayValue(parsed)
}

/**
 * Prints the text blocks of an MCP tool result to stdout. When the result is
 * flagged `isError`, throws with the tool's error text instead — MCP `callTool`
 * returns tool errors as ordinary results (it does not reject), so callers must
 * surface them as failures (non-zero exit) rather than printing to stdout and
 * exiting 0.
 */
export function printMcpTextContent(result: McpTextResult, options: McpPrintOptions = {}): void {
  const texts = (result.content ?? [])
    .filter((item) => item.type === 'text')
    .map((item) => item.text ?? '')

  if (result.isError) {
    throw new Error(texts.join('\n').trim() || 'MCP tool returned an error')
  }

  for (const text of texts) console.log(formatMcpTextContent(text, options.tool, options))
}
