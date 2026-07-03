export interface McpTextResult {
  content?: Array<{ type: string; text?: string }>
  isError?: boolean
}

/**
 * Prints the text blocks of an MCP tool result to stdout. When the result is
 * flagged `isError`, throws with the tool's error text instead — MCP `callTool`
 * returns tool errors as ordinary results (it does not reject), so callers must
 * surface them as failures (non-zero exit) rather than printing to stdout and
 * exiting 0.
 */
export function printMcpTextContent(result: McpTextResult): void {
  const texts = (result.content ?? [])
    .filter((item) => item.type === 'text')
    .map((item) => item.text ?? '')

  if (result.isError) {
    throw new Error(texts.join('\n').trim() || 'MCP tool returned an error')
  }

  for (const text of texts) console.log(text)
}
