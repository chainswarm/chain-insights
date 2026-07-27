import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeJsonAtomic } from '../../src/monitor/atomic.js'

describe('writeJsonAtomic', () => {
  it('writes pretty JSON with trailing newline and leaves no tmp file behind', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cia-atomic-'))
    const file = path.join(dir, 'doc.json')
    await writeJsonAtomic(file, { a: 1 })
    expect(await readFile(file, 'utf8')).toBe(JSON.stringify({ a: 1 }, null, 2) + '\n')
    expect(await readdir(dir)).toEqual(['doc.json'])
  })

  it('replaces an existing doc in place (rename semantics)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cia-atomic-'))
    const file = path.join(dir, 'doc.json')
    await writeJsonAtomic(file, { v: 1 })
    await writeJsonAtomic(file, { v: 2 })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ v: 2 })
    expect(await readdir(dir)).toEqual(['doc.json'])
  })
})
