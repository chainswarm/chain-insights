import { describe, expect, it } from 'vitest'

import { busyDelayMs, connectRemote, httpStatusOf } from '../src/mcp/remote-connect.js'

class HttpError extends Error {
  constructor(public code: number, message: string) {
    super(message)
  }
}
const endpoint = 'https://mcp.example.test/'
const noSleep = async () => undefined

describe('connectRemote', () => {
  it('connects on the first streamable try', async () => {
    let sse = 0
    const r = await connectRemote({ endpoint, connectStreamable: async () => undefined, connectSse: async () => { sse++ }, sleep: noSleep })
    expect(r).toMatchObject({ connected: true, transport: 'streamable_http', attempts: 1 })
    expect(sse).toBe(0)
  })

  it('waits through 429 and connects when the endpoint has room, never touching SSE', async () => {
    let tries = 0, sse = 0
    const waits: number[] = []
    const r = await connectRemote({
      endpoint,
      connectStreamable: async () => { tries++; if (tries < 3) throw new HttpError(429, 'Error POSTing to endpoint: service is at capacity; retry shortly') },
      connectSse: async () => { sse++ },
      sleep: async (ms) => { waits.push(ms) },
    })
    expect(r).toMatchObject({ connected: true, transport: 'streamable_http', attempts: 3 })
    expect(sse).toBe(0)
    expect(waits).toEqual([1000, 2000])
  })

  it('gives up busy as retryable with a capacity message, and no SSE try', async () => {
    let sse = 0
    const r = await connectRemote({
      endpoint, attempts: 3, sleep: noSleep,
      connectStreamable: async () => { throw new HttpError(429, 'Error POSTing to endpoint: service is at capacity') },
      connectSse: async () => { sse++ },
    })
    expect(r.connected).toBe(false)
    expect(r.retryable).toBe(true)
    expect(r.attempts).toBe(3)
    expect(r.message).toContain('at capacity')
    expect(r.message).toContain('HTTP 429')
    expect(r.message).toContain('class capacity')
    expect(sse).toBe(0)
  })

  it('falls back to SSE once when the endpoint is not streamable', async () => {
    const r = await connectRemote({
      endpoint, sleep: noSleep,
      connectStreamable: async () => { throw new HttpError(405, 'Error POSTing to endpoint: Method Not Allowed') },
      connectSse: async () => undefined,
    })
    expect(r).toMatchObject({ connected: true, transport: 'sse', retryable: false })
  })

  it('names the first failure, not the SSE 405, when both transports fail on a dead host', async () => {
    const r = await connectRemote({
      endpoint, sleep: noSleep,
      connectStreamable: async () => { throw new Error('fetch failed: ECONNREFUSED') },
      connectSse: async () => { throw new HttpError(405, 'SSE error: Non-200 status code (405)') },
    })
    expect(r.connected).toBe(false)
    expect(r.retryable).toBe(false)
    expect(r.message).toContain('unreachable')
    expect(r.message).toContain('ECONNREFUSED')
    expect(r.message).not.toContain('405')
  })

  it('reads a status from the code or the text', () => {
    expect(httpStatusOf(new HttpError(429, 'x'))).toBe(429)
    expect(httpStatusOf(new Error('SSE error: Non-200 status code (405)'))).toBe(405)
    expect(httpStatusOf(new Error('fetch failed'))).toBeNull()
    expect(busyDelayMs({ retryAfter: 1 }, 1)).toBe(1000)
    expect(busyDelayMs(new Error('x'), 4)).toBe(8000)
    expect(busyDelayMs(new Error('x'), 9)).toBe(8000)
  })
})
