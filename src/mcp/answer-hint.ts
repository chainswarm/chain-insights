/**
 * The two answer rules that still slip in long answers, carried on every
 * graph reply in the result's `hint` field. Claude Code has a Stop hook that
 * reads the answer; Codex and Claude Desktop have no such hook, and in the
 * loop's third prompt set they broke one of these two rules in three of
 * thirteen conversations. The reply is the one thing every host hands the
 * model right before it writes, so the rules ride on it. A `hint` the
 * server already set is kept.
 */

export const ANSWER_HINT =
  'Answer: write every address in full (0x plus 40 characters), also when it repeats one named earlier; ' +
  'a transfer moves tokens, so write "tokens worth about N USD", never "sent N USD" or a $ figure.'

type TextBlock = { type: string; text?: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The structured content with the hint set when the server left it empty. */
export function withAnswerHint(structuredContent: unknown): unknown {
  if (!isRecord(structuredContent) || !isRecord(structuredContent.facts)) return structuredContent
  if (typeof structuredContent.hint === 'string' && structuredContent.hint.trim()) return structuredContent
  return { ...structuredContent, hint: ANSWER_HINT }
}

/** A graph tool result whose structured content and single JSON text block both carry the hint. */
export function withAnswerHintResult<T extends { content?: TextBlock[]; structuredContent?: unknown }>(result: T): T {
  const structured = withAnswerHint(result.structuredContent)
  if (structured === result.structuredContent) return result
  const content = result.content ?? []
  const only = content.length === 1 && content[0]?.type === 'text' ? content[0] : null
  let parsed: unknown = undefined
  try {
    parsed = only?.text ? JSON.parse(only.text) : undefined
  } catch {
    parsed = undefined
  }
  const textIsStructured = parsed !== undefined && JSON.stringify(parsed) === JSON.stringify(result.structuredContent)
  return { ...result, structuredContent: structured, content: textIsStructured ? [{ ...only, text: JSON.stringify(structured) }] : content }
}
