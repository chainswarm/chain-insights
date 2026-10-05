export interface McpTextResult {
  content?: Array<{ type: string; text?: string }>
  structuredContent?: unknown
  isError?: boolean
}

/**
 * The refusal envelope of the graph server, as the reply carries it in
 * `structuredContent.error_detail`. `class` is one of `refused`, `killed`,
 * `capacity` or `failed`, and it decides the caller's next move.
 */
export interface McpErrorDetail {
  code?: string
  rule?: string
  class?: string
  fix?: string
  example?: string
}

const ERROR_DETAIL_FIELDS = ['code', 'rule', 'class', 'fix', 'example'] as const

/**
 * A tool reply flagged `isError`: the server answered, and its answer is an
 * error. It is never a failure of the connection, so no caller may report it
 * as an unreachable endpoint. `message` is the server's own text and
 * `errorDetail` is the envelope of the reply, absent when the reply has none.
 */
export class McpToolError extends Error {
  readonly errorDetail?: McpErrorDetail

  constructor(message: string, errorDetail?: McpErrorDetail) {
    super(message)
    this.name = 'McpToolError'
    if (errorDetail) this.errorDetail = errorDetail
  }
}

export interface McpPrintOptions {
  tool?: string
  json?: boolean
}

// What a switched-off or lagging chain layer means for the caller, in the line
// under the server's text. The endpoint answered, so the endpoint is up, and
// the other two layers do not depend on the chain node.
const CHAIN_UNAVAILABLE_MEANING =
  'the chain layer is off or behind. The endpoint is up. USE topology and USE facts still work.'

/**
 * How `cia mcp call` shows an McpToolError: the server's own text, then one
 * line built from its error_detail, `code <code> · class <class> · <fix>`. A
 * reply with no error_detail is the server text alone. For `chain_unavailable`
 * the line also says what the code means for the caller.
 */
export function formatMcpToolError(err: McpToolError): string {
  const detail = err.errorDetail
  if (!detail) return err.message
  const parts: string[] = []
  if (detail.code) parts.push(`code ${detail.code}`)
  if (detail.class) parts.push(`class ${detail.class}`)
  if (detail.fix) parts.push(detail.fix)
  if (detail.code === 'chain_unavailable') parts.push(CHAIN_UNAVAILABLE_MEANING)
  if (parts.length === 0) return err.message
  return `${err.message}\n  ${parts.join(' · ')}`
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** The text fields of `structuredContent.error_detail`, or undefined when it has none. */
function errorDetailOf(structuredContent: unknown): McpErrorDetail | undefined {
  if (!isRecord(structuredContent) || !isRecord(structuredContent.error_detail)) return undefined
  const detail: McpErrorDetail = {}
  for (const field of ERROR_DETAIL_FIELDS) {
    const value = structuredContent.error_detail[field]
    if (typeof value === 'string') detail[field] = value
  }
  return Object.keys(detail).length > 0 ? detail : undefined
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
 * flagged `isError`, throws an McpToolError with the tool's error text instead
 * — MCP `callTool` returns tool errors as ordinary results (it does not
 * reject), so callers must surface them as failures (non-zero exit) rather than
 * printing to stdout and exiting 0. The error keeps the `error_detail` of the
 * reply, so a caller can tell a refused query from a dead endpoint.
 */
export function printMcpTextContent(result: McpTextResult, options: McpPrintOptions = {}): void {
  const texts = (result.content ?? [])
    .filter((item) => item.type === 'text')
    .map((item) => item.text ?? '')

  if (result.isError) {
    throw new McpToolError(
      texts.join('\n').trim() || 'MCP tool returned an error',
      errorDetailOf(result.structuredContent)
    )
  }

  for (const text of texts) console.log(formatMcpTextContent(text, options.tool, options))
}
