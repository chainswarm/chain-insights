import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('DuckDB initialization (FOUND-03)', () => {
  let fakeHome: string
  let prevHome: string | undefined

  beforeEach(async () => {
    fakeHome = join(tmpdir(), `ci-db-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(fakeHome, { recursive: true })
    prevHome = process.env['HOME']
    process.env['HOME'] = fakeHome
  })

  afterEach(async () => {
    process.env['HOME'] = prevHome
    await rm(fakeHome, { recursive: true, force: true })
  })

  it('healthCheck returns ok:true after init', async () => {
    const { healthCheck } = await import('../src/db/init.js')
    const result = await healthCheck()
    expect(result.ok).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('initSchema creates cases table', async () => {
    const { getDb, initSchema } = await import('../src/db/init.js')
    const conn = await getDb()
    await initSchema(conn)
    const reader = await conn.runAndReadAll(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'cases'"
    )
    const rows = reader.getRows()
    expect(rows.length).toBe(1)
    conn.closeSync()
  })
})
