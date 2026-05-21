const WRITE_KEYWORDS = /\b(MERGE|DELETE|CREATE|SET|REMOVE|DROP|DETACH)\b/i
const LIMIT_PATTERN = /\bLIMIT\b/i

export function containsWriteOperation(cypher: string): boolean {
  return WRITE_KEYWORDS.test(cypher)
}

export function ensureCypherLimit(cypher: string, limit = 1000): string {
  if (LIMIT_PATTERN.test(cypher)) return cypher
  return `${cypher.trim().replace(/;+$/, '').trim()} LIMIT ${limit}`
}

export function validateReadOnlyCypher(cypher: string): string {
  const trimmed = cypher.trim()
  if (!trimmed) throw new Error('Query cannot be empty')
  if (containsWriteOperation(trimmed)) throw new Error('Write operations are not permitted')
  return ensureCypherLimit(trimmed)
}
