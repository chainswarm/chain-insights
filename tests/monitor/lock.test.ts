import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { acquireRunLock } from '../../src/monitor/lock.js'
import { monitorPaths } from '../../src/monitor/paths.js'

describe('acquireRunLock', () => {
  it('acquires, records own pid, and release removes the lockfile', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cia-lock-'))
    const lock = await acquireRunLock(root)
    expect(lock.acquired).toBe(true)
    expect((await readFile(monitorPaths(root).lockPath, 'utf8')).trim()).toBe(String(process.pid))
    if (lock.acquired) await lock.release()
    expect(existsSync(monitorPaths(root).lockPath)).toBe(false)
  })

  it('refuses while the holder process is alive', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cia-lock-'))
    // This test process itself is the live holder.
    await writeFile(monitorPaths(root).lockPath, `${process.pid}\n`, 'utf8')
    const lock = await acquireRunLock(root)
    expect(lock).toEqual({ acquired: false, holderPid: process.pid })
  })

  it('takes over a stale lock whose pid is dead', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cia-lock-'))
    // PIDs are capped well below this on Linux/macOS — guaranteed dead.
    await writeFile(monitorPaths(root).lockPath, '999999999\n', 'utf8')
    const lock = await acquireRunLock(root)
    expect(lock.acquired).toBe(true)
    expect((await readFile(monitorPaths(root).lockPath, 'utf8')).trim()).toBe(String(process.pid))
    if (lock.acquired) await lock.release()
  })
})
