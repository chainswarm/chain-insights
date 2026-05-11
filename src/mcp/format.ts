import type { McpTool } from './schema-cache.js'

const NAME_WIDTH = 30
const DESC_MAX = 60

/**
 * Formats an array of MCP tools as a plain text table string.
 * Returns "No tools available." for an empty array.
 * Caller controls output — use console.log(formatToolsTable(tools)).
 */
export function formatToolsTable(tools: McpTool[]): string {
  if (tools.length === 0) return 'No tools available.'
  const header = `${'Tool'.padEnd(NAME_WIDTH)}  Description`
  const divider = '-'.repeat(NAME_WIDTH) + '  ' + '-'.repeat(DESC_MAX)
  const rows = tools.map((t) => {
    const name = t.name.padEnd(NAME_WIDTH)
    const desc = (t.description ?? '').slice(0, DESC_MAX)
    return `${name}  ${desc}`
  })
  return [header, divider, ...rows].join('\n')
}
