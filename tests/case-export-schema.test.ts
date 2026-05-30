import { describe, expect, it } from 'vitest'
import { join } from 'node:path'

describe('case export schema and paths', () => {
  it('parses default export options', async () => {
    const { CaseExportOptionsSchema } = await import('../src/export/schema.js')
    const parsed = CaseExportOptionsSchema.parse({ caseId: '20260530_001_test-case' })

    expect(parsed.target).toBe('obsidian-llmwiki')
    expect(parsed.mode).toBe('private')
    expect(parsed.outputDir).toBeUndefined()
  })

  it('rejects unsupported target and mode values', async () => {
    const { CaseExportOptionsSchema } = await import('../src/export/schema.js')

    expect(() => CaseExportOptionsSchema.parse({
      caseId: '20260530_001_test-case',
      target: 'neo4j',
    })).toThrow()
    expect(() => CaseExportOptionsSchema.parse({
      caseId: '20260530_001_test-case',
      mode: 'unsafe-public-clear-addresses',
    })).toThrow()
  })

  it('sanitizes case slugs for export paths', async () => {
    const { safeSlug, safeFilename } = await import('../src/export/paths.js')

    expect(safeSlug('Exchange Deposit: 5abc / Test')).toBe('exchange-deposit-5abc-test')
    expect(safeSlug('...')).toBe('case-export')
    expect(safeFilename('../Evidence 001.md')).toBe('evidence-001.md')
  })

  it('rejects paths outside the export root', async () => {
    const { assertInsideDirectory } = await import('../src/export/paths.js')
    const root = '/tmp/chain-insights-export'

    expect(() => assertInsideDirectory(root, join(root, 'Case.md'))).not.toThrow()
    expect(() => assertInsideDirectory(root, '/tmp/Case.md')).toThrow('Refusing to write outside export directory')
  })
})
