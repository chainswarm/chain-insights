import { PlaybookSchema, type PlaybookDefinition } from './schema.js'

/**
 * Apply {{param}} template substitution to a string.
 * Missing keys are left as-is: {{missing}} remains {{missing}}.
 */
function applyTemplate(text: string, params: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => params[k] ?? `{{${k}}}`)
}

/**
 * Extract content of a fenced code block by language tag.
 * Returns the trimmed content between the opening and closing fences, or null.
 */
function extractFencedBlock(section: string, lang: string): string | null {
  // Match ```lang\n...\n``` pattern
  const re = new RegExp('```' + lang + '\\n([\\s\\S]*?)```', 'm')
  const match = re.exec(section)
  return match ? (match[1]?.trim() ?? null) : null
}

/**
 * Parse params block content into a Record<string, string>.
 * Each line is expected to be "key: value" format.
 */
function parseParamsBlock(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx === -1) continue
    const key = trimmed.slice(0, colonIdx).trim()
    const val = trimmed.slice(colonIdx + 1).trim()
    if (key) result[key] = val
  }
  return result
}

/**
 * Parse flat YAML key: value frontmatter (without params arrays).
 * Skips lines starting with '-' (YAML array items — not supported here).
 */
function parseFlatFrontmatter(block: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of block.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('-')) continue
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx === -1) continue
    const key = trimmed.slice(0, colonIdx).trim()
    const val = trimmed.slice(colonIdx + 1).trim()
    if (key && val !== undefined) result[key] = val
  }
  return result
}

export const PlaybookParser = {
  /**
   * Parse a playbook markdown file into a validated PlaybookDefinition.
   *
   * @param markdown - Raw markdown content of the playbook file
   * @param resolvedParams - Key-value parameters for {{param}} substitution
   * @returns Validated PlaybookDefinition (throws ZodError on invalid data)
   */
  parse(markdown: string, resolvedParams: Record<string, string>): PlaybookDefinition {
    // 1. Split on first and second --- fences to extract frontmatter block
    const fmMatch = /^---\n([\s\S]*?)\n---/.exec(markdown)
    const frontmatterBlock = fmMatch ? fmMatch[1]! : ''
    const frontmatter = parseFlatFrontmatter(frontmatterBlock)

    // 2. Extract body (everything after closing ---)
    let body = markdown
    if (fmMatch) {
      body = markdown.slice(fmMatch.index + fmMatch[0].length)
    }

    // 3. Split body on H2 sections (## heading)
    const sections = body.split(/^## /m)
    // First element is content before first ##, skip it
    const stepSections = sections.slice(1)

    // 4. Parse each step section
    const steps = stepSections.map((section, i) => {
      // First line is the label (the H2 heading content)
      const firstNewline = section.indexOf('\n')
      const label = firstNewline === -1
        ? section.trim()
        : section.slice(0, firstNewline).trim()

      // Extract tool name from ```tool block
      const rawTool = extractFencedBlock(section, 'tool') ?? ''
      const tool = applyTemplate(rawTool, resolvedParams)

      // Extract params from ```params block
      const rawParamsBlock = extractFencedBlock(section, 'params') ?? ''
      const rawParams = parseParamsBlock(rawParamsBlock)

      // Apply template substitution to all param values
      const params: Record<string, string> = {}
      for (const [k, v] of Object.entries(rawParams)) {
        params[applyTemplate(k, resolvedParams)] = applyTemplate(v, resolvedParams)
      }

      return {
        index: i + 1,
        label,
        tool,
        params,
      }
    })

    // 5. Build and validate the playbook definition
    return PlaybookSchema.parse({
      name:        frontmatter['name'] ?? '',
      description: frontmatter['description'] ?? '',
      version:     frontmatter['version'] ?? '1.0.0',
      params:      [],
      steps,
    })
  },
}
