import { PlaybookSchema, ParamSpecSchema, type PlaybookDefinition } from './schema.js'

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

/**
 * Parse the `params:` YAML array block from frontmatter.
 * Handles the multi-line format:
 *   params:
 *     - name: address
 *       type: string
 *       required: true
 *     - name: hops
 *       type: number
 *       required: false
 *       default: "2"
 *
 * Returns an array of raw param objects (strings, to be validated by Zod).
 */
function parseFrontmatterParamsArray(block: string): Array<Record<string, string>> {
  const results: Array<Record<string, string>> = []

  // Find the params: key
  const lines = block.split('\n')
  let inParams = false
  let current: Record<string, string> | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Check for `params:` key (may or may not have value on same line)
    if (!inParams && /^params\s*:/.test(trimmed)) {
      inParams = true
      continue
    }

    if (!inParams) continue

    // Stop at a top-level key (non-indented, non-list line that contains ':')
    // This detects keys like `name:`, `version:`, etc. at root level
    if (!line.startsWith(' ') && !line.startsWith('\t') && !trimmed.startsWith('-')) {
      break
    }

    // New list item
    if (trimmed.startsWith('- ')) {
      if (current !== null) results.push(current)
      current = {}
      const rest = trimmed.slice(2).trim()
      if (rest) {
        const colonIdx = rest.indexOf(':')
        if (colonIdx !== -1) {
          const k = rest.slice(0, colonIdx).trim()
          const v = rest.slice(colonIdx + 1).trim().replace(/^"(.*)"$/, '$1')
          if (k) current[k] = v
        }
      }
      continue
    }

    // Key-value within a list item
    if (current !== null) {
      const colonIdx = trimmed.indexOf(':')
      if (colonIdx !== -1) {
        const k = trimmed.slice(0, colonIdx).trim()
        const v = trimmed.slice(colonIdx + 1).trim().replace(/^"(.*)"$/, '$1')
        if (k) current[k] = v
      }
    }
  }

  if (current !== null) results.push(current)
  return results
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

    // 2. Parse params spec from frontmatter YAML array before step parsing so
    // defaults are available for {{param}} substitution.
    const rawParamItems = parseFrontmatterParamsArray(frontmatterBlock)
    const params = rawParamItems.map(raw => {
      // Coerce required/default fields
      const coerced: Record<string, unknown> = {
        name:     raw['name'] ?? '',
        type:     raw['type'] ?? 'string',
        required: raw['required'] !== undefined
          ? raw['required'].toLowerCase() !== 'false'
          : true,
      }
      if (raw['default'] !== undefined) coerced['default'] = raw['default']
      return ParamSpecSchema.parse(coerced)
    })

    const templateParams: Record<string, string> = {}
    for (const spec of params) {
      if (spec.default !== undefined) templateParams[spec.name] = spec.default
    }
    Object.assign(templateParams, resolvedParams)

    // 3. Extract body (everything after closing ---)
    let body = markdown
    if (fmMatch) {
      body = markdown.slice(fmMatch.index + fmMatch[0].length)
    }

    // 4. Split body on H2 sections (## heading)
    const sections = body.split(/^## /m)
    // First element is content before first ##, skip it
    const stepSections = sections.slice(1)

    // 5. Parse each step section
    const steps = stepSections.map((section, i) => {
      // First line is the label (the H2 heading content)
      const firstNewline = section.indexOf('\n')
      const label = firstNewline === -1
        ? section.trim()
        : section.slice(0, firstNewline).trim()

      // Extract tool name from ```tool block
      const rawTool = extractFencedBlock(section, 'tool') ?? ''
      const tool = applyTemplate(rawTool, templateParams)

      // Extract params from ```params block
      const rawParamsBlock = extractFencedBlock(section, 'params') ?? ''
      const rawParams = parseParamsBlock(rawParamsBlock)

      // Apply template substitution to all param values
      const params: Record<string, string> = {}
      for (const [k, v] of Object.entries(rawParams)) {
        params[applyTemplate(k, templateParams)] = applyTemplate(v, templateParams)
      }

      return {
        index: i + 1,
        label,
        tool,
        params,
      }
    })

    // 6. Build and validate the playbook definition
    return PlaybookSchema.parse({
      name:        frontmatter['name'] ?? '',
      description: frontmatter['description'] ?? '',
      version:     frontmatter['version'] ?? '1.0.0',
      params,
      steps,
    })
  },
}
