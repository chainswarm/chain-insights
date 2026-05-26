import { request } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const COPIED_TOPUP_SERVER_URL = 'http://127.0.0.1:4500'
const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('../src/wallet/mcp-proxy/topup-server.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/wallet/mcp-proxy/topup-server.js')>()
  return {
    ...actual,
    startTopupServer: vi.fn().mockResolvedValue(COPIED_TOPUP_SERVER_URL),
  }
})

async function requestRaw(baseUrl: string, path: string): Promise<{ body: string; status: number }> {
  const base = new URL(baseUrl)
  const port = Number(base.port)
  if (!port) {
    throw new Error(`Missing port in URL: ${baseUrl}`)
  }

  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: base.hostname,
        method: 'GET',
        path,
        port,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        res.on('end', () => {
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            status: res.statusCode ?? 0,
          })
        })
      },
    )

    req.on('error', reject)
    req.end()
  })
}

describe('topup artifact proxy request hardening', () => {
  let artifactUrl = ''

  beforeAll(async () => {
    const { startTopupServer } = await import('../src/wallet/topup-server.js')
    artifactUrl = await startTopupServer('0x0000000000000000000000000000000000000001')
  })

  afterAll(async () => {
    const { stopTopupServer } = await import('../src/wallet/topup-server.js')
    await stopTopupServer()
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(
      new Response('{"ok":true}', {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  it('proxies allowed /api paths only to the copied topup server origin', async () => {
    const response = await requestRaw(artifactUrl, '/api/balance?via=test')

    expect(response.status).toBe(200)
    expect(response.body).toBe('{"ok":true}')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [upstreamUrl] = fetchMock.mock.calls[0] as [URL]
    expect(upstreamUrl.toString()).toBe('http://127.0.0.1:4500/api/balance?via=test')
  })

  it('rejects protocol-relative host override request targets', async () => {
    const response = await requestRaw(artifactUrl, '//evil.example/api/x')

    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects absolute-form request targets', async () => {
    const response = await requestRaw(artifactUrl, 'http://evil.example/api/x')

    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects encoded host override request targets', async () => {
    const response = await requestRaw(artifactUrl, '/%2f%2fevil.example/api/x')

    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects encoded absolute URL override request targets', async () => {
    const response = await requestRaw(artifactUrl, '/%68%74%74%70%3A%2F%2Fevil.example/api/x')

    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
