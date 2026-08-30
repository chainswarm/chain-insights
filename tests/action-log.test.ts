import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendActionLog } from '../src/mcp/action-log.js'

const ORIGINAL = process.env.CIA_ACTION_LOG
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CIA_ACTION_LOG
  else process.env.CIA_ACTION_LOG = ORIGINAL
})

describe('action log', () => {
  it('appends one JSON line per entry', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cia-alog-'))
    const file = path.join(dir, 'actions.jsonl')
    process.env.CIA_ACTION_LOG = file
    await appendActionLog({
      timestamp: 1,
      tool: 'graph_query',
      args: { network: 'bittensor' },
      outcome: 'ok',
      duration_ms: 12,
    })
    await appendActionLog({
      timestamp: 2,
      tool: 'aml_address_risk',
      args: {},
      outcome: 'error',
      duration_ms: 3,
      error: 'boom',
    })
    const lines = (await readFile(file, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!).tool).toBe('graph_query')
    expect(JSON.parse(lines[1]!).outcome).toBe('error')
  })

  it('is a no-op when unconfigured', async () => {
    delete process.env.CIA_ACTION_LOG
    await expect(
      appendActionLog({ timestamp: 1, tool: 't', args: {}, outcome: 'ok', duration_ms: 1 })
    ).resolves.toBeUndefined()
  })

  it('never throws when the path is unwritable', async () => {
    // Logging is observability; it must never break the tool call it observes.
    process.env.CIA_ACTION_LOG = '/proc/cia-cannot-write/actions.jsonl'
    await expect(
      appendActionLog({ timestamp: 1, tool: 't', args: {}, outcome: 'ok', duration_ms: 1 })
    ).resolves.toBeUndefined()
  })

  it('creates the parent directory', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cia-alog-'))
    const file = path.join(dir, 'nested', 'deep', 'actions.jsonl')
    process.env.CIA_ACTION_LOG = file
    await appendActionLog({ timestamp: 1, tool: 't', args: {}, outcome: 'ok', duration_ms: 1 })
    expect((await readFile(file, 'utf8')).trim().split('\n')).toHaveLength(1)
  })
})
