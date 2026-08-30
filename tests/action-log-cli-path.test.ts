// The action log was originally installed only on the MCP proxy's remote
// client. Every `cia` CLI command builds its own client, so an unattended
// instance driven by a scheduled CLI command wrote nothing while the
// mechanism "worked" on the path nobody was using. This pins the wrapper
// itself.
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installActionLogging } from '../src/mcp/action-log.js'

const ORIGINAL = process.env.CIA_ACTION_LOG
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CIA_ACTION_LOG
  else process.env.CIA_ACTION_LOG = ORIGINAL
})

async function logFile(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'cia-alog-cli-'))
  const file = path.join(dir, 'actions.jsonl')
  process.env.CIA_ACTION_LOG = file
  return file
}

describe('installActionLogging wraps any client', () => {
  it('records a successful call with its signals', async () => {
    const file = await logFile()
    const client = {
      callTool: async () => ({
        structuredContent: {
          warnings: ['hit the cap'],
          input: { search_limits: { row_limit: 500 } },
        },
      }),
    }
    installActionLogging(client as never)
    await (client.callTool as never as (a: unknown) => Promise<unknown>)({
      name: 'graph_query',
      arguments: { network: 'robinhood' },
    })
    const entry = JSON.parse((await readFile(file, 'utf8')).trim())
    expect(entry.tool).toBe('graph_query')
    expect(entry.outcome).toBe('ok')
    expect(entry.warnings).toEqual(['hit the cap'])
    expect(entry.search_limits).toEqual({ row_limit: 500 })
  })

  it('records a failed call and still rethrows', async () => {
    const file = await logFile()
    const client = {
      callTool: async () => {
        throw new Error('backend down')
      },
    }
    installActionLogging(client as never)
    await expect(
      (client.callTool as never as (a: unknown) => Promise<unknown>)({
        name: 'graph_query',
        arguments: {},
      })
    ).rejects.toThrow('backend down')
    const entry = JSON.parse((await readFile(file, 'utf8')).trim())
    expect(entry.outcome).toBe('error')
    expect(entry.error).toContain('backend down')
  })

  it('returns the original result unchanged', async () => {
    await logFile()
    const payload = { structuredContent: { facts: { count: 3 } } }
    const client = { callTool: async () => payload }
    installActionLogging(client as never)
    expect(
      await (client.callTool as never as (a: unknown) => Promise<unknown>)({
        name: 't',
        arguments: {},
      })
    ).toBe(payload)
  })
})
