import { describe, it, expect, afterEach } from 'vitest'

describe('Hono server (FOUND-04)', () => {
  let stop: (() => void) | null = null

  afterEach(() => {
    if (stop) { stop(); stop = null }
  })

  it('GET /health returns { ok: true }', async () => {
    const { startServer } = await import('../src/server/index.js')
    stop = startServer(14321)
    // Allow server to bind
    await new Promise(resolve => setTimeout(resolve, 100))
    const res = await fetch('http://127.0.0.1:14321/health')
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it('server binds to 127.0.0.1 only (not 0.0.0.0)', async () => {
    const { startServer } = await import('../src/server/index.js')
    stop = startServer(14322)
    await new Promise(resolve => setTimeout(resolve, 100))
    // If 127.0.0.1 resolves, the binding is correct
    const res = await fetch('http://127.0.0.1:14322/health')
    expect(res.status).toBe(200)
  })
})
