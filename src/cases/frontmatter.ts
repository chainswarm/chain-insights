// Hand-rolled YAML frontmatter parser — GSD pattern (no gray-matter dependency).
// Only supports flat key: value pairs. Arrays must be stored as comma-separated strings.
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

export function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const m = content.match(FRONTMATTER_RE)
  if (!m) return { frontmatter: {}, body: content }
  const fm: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
  }
  return { frontmatter: fm, body: m[2] }
}

export function serializeFrontmatter(fm: Record<string, string>, body: string): string {
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n')
  return `---\n${lines}\n---\n${body}`
}
