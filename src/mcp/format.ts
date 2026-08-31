import type { McpTool } from './schema-cache.js'

const NAME_WIDTH = 30
const DESC_MAX = 60

function wrapText(value: string, maxWidth: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']

  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (word.length > maxWidth) {
      if (current) {
        lines.push(current)
        current = ''
      }
      let remainder = word
      while (remainder.length > maxWidth) {
        lines.push(remainder.slice(0, maxWidth))
        remainder = remainder.slice(maxWidth)
      }
      current = remainder
      continue
    }

    if (!current) {
      current = word
    } else if (current.length + 1 + word.length <= maxWidth) {
      current += ` ${word}`
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines
}

/**
 * Formats an array of MCP tools as a plain text table string.
 * Returns "No tools available." for an empty array.
 * Caller controls output — use console.log(formatToolsTable(tools)).
 */
export function formatToolsTable(tools: McpTool[]): string {
  if (tools.length === 0) return 'No tools available.'
  const nameWidth = Math.max(
    NAME_WIDTH,
    'Remote GraphRAG tool'.length,
    ...tools.map((t) => t.name.length)
  )
  const header = `${'Remote GraphRAG tool'.padEnd(nameWidth)}  Description`
  const divider = '-'.repeat(nameWidth) + '  ' + '-'.repeat(DESC_MAX)
  const rows = tools.flatMap((tool) => {
    const descriptionLines = wrapText(tool.description ?? '', DESC_MAX)
    return descriptionLines.map(
      (description, index) => `${(index === 0 ? tool.name : '').padEnd(nameWidth)}  ${description}`
    )
  })
  return [header, divider, ...rows].join('\n')
}
