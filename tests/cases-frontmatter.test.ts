import { describe, it, expect } from 'vitest'
import { parseFrontmatter, serializeFrontmatter } from '../src/cases/frontmatter.js'

describe('parseFrontmatter', () => {
  it('parses valid frontmatter block', () => {
    const result = parseFrontmatter('---\nid: abc\nstatus: open\n---\nbody text')
    expect(result.frontmatter).toEqual({ id: 'abc', status: 'open' })
    expect(result.body).toBe('body text')
  })
  it('returns empty frontmatter when no block present', () => {
    const result = parseFrontmatter('no frontmatter here')
    expect(result.frontmatter).toEqual({})
    expect(result.body).toBe('no frontmatter here')
  })
  it('handles empty body after frontmatter', () => {
    const result = parseFrontmatter('---\nid: abc\n---\n')
    expect(result.frontmatter).toEqual({ id: 'abc' })
  })
  it('handles values with colons (e.g. ISO timestamps)', () => {
    const result = parseFrontmatter('---\ncreated: 2026-05-11T14:23:00.000Z\n---\n')
    expect(result.frontmatter['created']).toBe('2026-05-11T14:23:00.000Z')
  })
})

describe('serializeFrontmatter', () => {
  it('serializes to valid frontmatter block', () => {
    const out = serializeFrontmatter({ id: 'abc', status: 'open' }, 'body text')
    expect(out).toBe('---\nid: abc\nstatus: open\n---\nbody text')
  })
  it('round-trips through parse→serialize', () => {
    const original = { id: '20260511_001_test', status: 'open', tags: 'aml,mixer' }
    const body = '# Test\n\nContent here.'
    const serialized = serializeFrontmatter(original, body)
    const parsed = parseFrontmatter(serialized)
    expect(parsed.frontmatter).toEqual(original)
    expect(parsed.body).toBe(body)
  })
  it('stores tags as comma-separated string (NOT YAML array)', () => {
    const out = serializeFrontmatter({ tags: 'aml,mixer,defi' }, '')
    expect(out).toContain('tags: aml,mixer,defi')
    expect(out).not.toContain('[')
  })
})
