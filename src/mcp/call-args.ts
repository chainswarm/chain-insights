// `cia mcp call tool key=value` yields strings. A key listed here is coerced
// to a number; anything else stays a string and is rejected by the tool's
// numeric zod schema. Every tunable search bound must therefore appear here,
// or passing it from the CLI fails with a confusing type error.
const NUMERIC_ARG_KEYS = new Set([
  'per_query_timeout_seconds',
  'incident_timestamp_ms',
  'max_hops',
  'per_address_limit',
  'row_limit',
])

function parseMcpArgValue(key: string, value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return value

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed) as unknown
  }

  if (NUMERIC_ARG_KEYS.has(key) && /^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed)
  }

  return value
}

export function parseMcpCallArgs(rawArgs: string[]): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  for (const pair of rawArgs) {
    const eqIdx = pair.indexOf('=')
    if (eqIdx === -1) {
      throw new Error(`Invalid arg format: ${pair} (expected key=value)`)
    }
    const key = pair.slice(0, eqIdx)
    args[key] = parseMcpArgValue(key, pair.slice(eqIdx + 1))
  }
  return args
}
