// PID run lock (durability spec req 4). O_EXCL create is the atomic acquire;
// a dead holder (kill(pid, 0) -> ESRCH) is stale and taken over; a live
// holder makes the caller exit 0 — "already running" is a normal outcome for
// a cron-driven loop, not an error.
import { readFile, rm, writeFile } from 'node:fs/promises'
import { monitorPaths } from './paths.js'

export type RunLock =
  | { acquired: true; release: () => Promise<void> }
  | { acquired: false; holderPid: number }

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM means the process exists but is not ours — still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export async function acquireRunLock(workspaceRoot: string): Promise<RunLock> {
  const { lockPath } = monitorPaths(workspaceRoot)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(lockPath, `${process.pid}\n`, { encoding: 'utf8', flag: 'wx' })
      return { acquired: true, release: () => rm(lockPath, { force: true }) }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      const holderPid = Number((await readFile(lockPath, 'utf8').catch(() => '')).trim())
      if (Number.isFinite(holderPid) && holderPid > 0 && pidAlive(holderPid)) {
        return { acquired: false, holderPid }
      }
      // Stale (dead pid or unreadable garbage): remove and retry the O_EXCL
      // create once — a racing peer may win the retry, which is correct.
      await rm(lockPath, { force: true })
    }
  }
  const holderPid = Number((await readFile(lockPath, 'utf8').catch(() => '0')).trim())
  return { acquired: false, holderPid }
}
