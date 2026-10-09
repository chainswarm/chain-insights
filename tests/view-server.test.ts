import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, request, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as z from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  EMBEDDED_VIEW_ATTR,
  VIEW_STORE_LIMIT,
  ViewStore,
  newViewId,
  pageWithEntry,
  startViewServer,
  type ViewServer,
} from '../src/mcp/view-server.js'

const VIEW_URL = /^http:\/\/127\.0\.0\.1:\d+\/view\?view=[A-Za-z0-9_-]+$/
const HTML = '<!doctype html><html><head><title>v</title></head><body>view</body></html>'

/** One raw request, so the Host and Origin headers are exactly what a test names. */
function raw(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string
): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        )
      }
    )
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

describe('the view server', () => {
  let server: ViewServer
  const runTool = vi.fn(async (name: string, args: Record<string, unknown>) => ({
    content: [{ type: 'text', text: `${name} ran` }],
    structuredContent: { schema: 'chain-insights.flows.v1', args },
    isError: false,
  }))
  const logged: Array<[string, Record<string, unknown>]> = []
  const log = (event: string, fields: Record<string, unknown>) => logged.push([event, fields])

  beforeAll(async () => {
    server = await startViewServer({ html: () => HTML, runTool, log })
  })
  afterAll(async () => {
    await server.close()
  })
  afterEach(() => {
    runTool.mockClear()
  })

  it('logs its port once, and links an answer on 127.0.0.1', () => {
    expect(logged).toEqual([['view.server.started', { port: server.port }]])
    expect(server.viewUrl(newViewId())).toMatch(VIEW_URL)
  })

  it('serves the view file at /view with the held answer written in; plain for an unknown or no id', async () => {
    const result = { content: [{ type: 'text', text: 'a</script><b>' }], structuredContent: { rows: 1 } }
    const id = server.put({ toolName: 'graph_query', arguments: { query: 'MATCH' }, result })
    const page = await raw(server.port, 'GET', `/view?view=${id}`)
    expect(page.status).toBe(200)
    const tag = `<script type="application/json" ${EMBEDDED_VIEW_ATTR}="${id}">`
    const start = page.body.indexOf(tag)
    expect(start).toBeGreaterThan(0)
    const end = page.body.indexOf('</script>', start)
    const json = page.body.slice(start + tag.length, end)
    expect(json).not.toContain('</')
    expect(JSON.parse(json)).toEqual({ arguments: { query: 'MATCH' }, result })
    expect(page.body.indexOf('</head>')).toBeGreaterThan(start)
    expect(page.body.replace(`${tag}${json}</script>\n`, '')).toBe(HTML)
    expect((await raw(server.port, 'GET', '/view?view=unknown')).body).toBe(HTML)
    expect((await raw(server.port, 'GET', '/view?view=..%2F')).body).toBe(HTML)
    expect((await raw(server.port, 'GET', '/view')).body).toBe(HTML)
    expect(pageWithEntry('<p>no head</p>', 'x', { toolName: 't', arguments: null, result: {} }).startsWith(tag.replace(id, 'x'))).toBe(true)
    expect(page.headers['content-type']).toMatch(/^text\/html/)
    expect(page.headers['cache-control']).toBe('no-store')
    expect(page.headers['x-content-type-options']).toBe('nosniff')
    expect(page.headers['access-control-allow-origin']).toBeUndefined()
    expect((await raw(server.port, 'GET', '/view')).status).toBe(200)
  })

  it('answers /api/view/<id> with the stored arguments and result, 404 for an unknown id', async () => {
    const result = {
      content: [{ type: 'text', text: 'rows' }],
      structuredContent: { schema: 'chain-insights.result.v1', view_url: 'x' },
      _meta: { billing: 1 },
      isError: false,
    }
    const args = { network: 'robinhood', query: 'USE topology MATCH (a) RETURN a LIMIT 1' }
    const id = server.put({ toolName: 'graph_query', arguments: args, result })
    const stored = await raw(server.port, 'GET', `/api/view/${id}`)
    expect(stored.status).toBe(200)
    expect(stored.headers['content-type']).toMatch(/^application\/json/)
    expect(JSON.parse(stored.body)).toEqual({ arguments: args, result })

    const missing = await raw(server.port, 'GET', `/api/view/${newViewId()}`)
    expect(missing.status).toBe(404)
    expect(JSON.parse(missing.body)).toEqual({ error: 'unknown view' })
  })

  it('refuses a Host header that does not name it (DNS rebinding)', async () => {
    const id = server.put({ toolName: 'graph_query', arguments: {}, result: {} })
    for (const host of ['evil.example', `evil.example:${server.port}`, '127.0.0.1:1']) {
      const refused = await raw(server.port, 'GET', `/api/view/${id}`, { host })
      expect(refused.status, host).toBe(403)
    }
    const local = await raw(server.port, 'GET', `/api/view/${id}`, {
      host: `localhost:${server.port}`,
    })
    expect(local.status).toBe(200)
  })

  it('runs graph_expand for the page and nothing else', async () => {
    const body = JSON.stringify({ arguments: { network: 'robinhood', address: '0x1' } })
    const json = { 'content-type': 'application/json' }
    const ran = await raw(server.port, 'POST', '/api/tools/graph_expand', json, body)
    expect(ran.status).toBe(200)
    expect(runTool).toHaveBeenCalledWith('graph_expand', { network: 'robinhood', address: '0x1' })
    expect(JSON.parse(ran.body).structuredContent.schema).toBe('chain-insights.flows.v1')

    for (const name of ['graph_query', 'graph_query_batch', 'wallet_topup']) {
      const refused = await raw(server.port, 'POST', `/api/tools/${name}`, json, body)
      expect(refused.status, name).toBe(404)
    }
    expect((await raw(server.port, 'GET', '/api/tools/graph_expand')).status).toBe(404)
    expect((await raw(server.port, 'GET', '/')).status).toBe(404)
    expect(runTool).toHaveBeenCalledTimes(1)
  })

  it('refuses a click from another site, a form post, a bad body and a body over 64 KB', async () => {
    const path = '/api/tools/graph_expand'
    const json = { 'content-type': 'application/json' }
    const body = JSON.stringify({ arguments: { network: 'robinhood' } })
    expect(
      (await raw(server.port, 'POST', path, { ...json, origin: 'https://evil.example' }, body))
        .status
    ).toBe(403)
    expect(
      (await raw(server.port, 'POST', path, { 'content-type': 'text/plain' }, body)).status
    ).toBe(415)
    expect((await raw(server.port, 'POST', path, json, '{not json')).status).toBe(400)
    expect((await raw(server.port, 'POST', path, json, '{"arguments": [1]}')).status).toBe(400)
    const big = JSON.stringify({ arguments: { pad: 'x'.repeat(70 * 1024) } })
    expect((await raw(server.port, 'POST', path, json, big)).status).toBe(413)
    expect(runTool).not.toHaveBeenCalled()
    const sameSite = await raw(
      server.port,
      'POST',
      path,
      { ...json, origin: `http://127.0.0.1:${server.port}` },
      body
    )
    expect(sameSite.status).toBe(200)
  })
})

describe('the answer store', () => {
  it(`keeps the newest ${VIEW_STORE_LIMIT} answers and evicts the oldest`, () => {
    const store = new ViewStore()
    const ids = Array.from({ length: VIEW_STORE_LIMIT + 1 }, (_, index) =>
      store.put({ toolName: 'graph_query', arguments: { index }, result: {} })
    )
    expect(store.size).toBe(VIEW_STORE_LIMIT)
    expect(store.get(ids[0])).toBeUndefined()
    expect(store.get(ids[1])?.arguments).toEqual({ index: 1 })
    expect(store.get(ids.at(-1)!)?.arguments).toEqual({ index: VIEW_STORE_LIMIT })
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/)
  })
})

/** A graph endpoint double: graph_query over streamable HTTP, as the hosted server serves it. */
async function startGraphEndpoint(): Promise<{ url: string; close: () => Promise<void> }> {
  const http: Server = createServer(async (req, res) => {
    const mcp = new McpServer({ name: 'graph-double', version: '1' })
    mcp.registerTool(
      'graph_query',
      { description: 'q', inputSchema: { query: z.string(), network: z.string() } },
      async () => ({
        content: [{ type: 'text', text: 'rows' }],
        structuredContent: {
          schema: 'chain-insights.result.v1',
          tool: 'graph_query',
          hint: null,
          facts: {
            query: {
              results: [
                {
                  from_address: '0xc4a21f9d6485fc5893dd4a491b320a83daf4da1d',
                  to_address: '0x7e3702e9dfaa847f9829a258f1e26fa431160662',
                  amount_usd_sum: 12.5,
                },
              ],
              count: 1,
            },
          },
        },
        isError: false,
      })
    )
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      void transport.close()
      void mcp.close()
    })
    await mcp.connect(transport)
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const text = Buffer.concat(chunks).toString('utf8')
    await transport.handleRequest(req, res, text ? JSON.parse(text) : undefined)
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  const address = http.address() as { port: number }
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: () => new Promise((resolve) => http.close(() => resolve())),
  }
}

describe('the built proxy', () => {
  let home: string
  let child: ChildProcess | undefined
  let endpoint: { url: string; close: () => Promise<void> }

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'ci-view-server-'))
    endpoint = await startGraphEndpoint()
  })
  afterAll(async () => {
    child?.kill()
    await endpoint.close()
    rmSync(home, { recursive: true, force: true })
  })

  it('gives a graph_query answer a view_url that opens the view and reads the answer back', async () => {
    child = spawn(process.execPath, [join(__dirname, '..', 'bin', 'mcp-proxy.cjs')], {
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: join(home, '.config'),
        CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT: endpoint.url,
        CHAIN_INSIGHTS_SKILL_REFRESH: '0',
        CLAUDE_CODE_ENTRYPOINT: '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const replies = new Map<number, any>()
    let buffer = ''
    child.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        const message = JSON.parse(line)
        if (typeof message.id === 'number') replies.set(message.id, message)
      }
    })
    let stderr = ''
    child.stderr!.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    const send = (message: object) => child!.stdin!.write(`${JSON.stringify(message)}\n`)
    const reply = async (id: number) => {
      for (let i = 0; i < 200 && !replies.has(id); i++) await new Promise((r) => setTimeout(r, 50))
      return replies.get(id)
    }

    send({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 't', version: '1' },
      },
    })
    expect((await reply(0))?.result, stderr).toBeDefined()
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    // No graph answer yet: no server.
    expect(stderr).not.toContain('view.server.started')
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'graph_query',
        arguments: {
          network: 'robinhood',
          query:
            'USE topology MATCH (a:Address)-[f:FLOWS_TO]->(t:Address) RETURN a.address AS from_address, t.address AS to_address LIMIT 5',
        },
      },
    })
    const answer = (await reply(1))?.result
    expect(answer, stderr).toBeDefined()
    const viewUrl = answer.structuredContent.view_url as string
    expect(viewUrl).toMatch(VIEW_URL)
    expect(answer.content.at(-1).text).toBe(`Open the graph in a browser window: ${viewUrl}`)
    expect(stderr).toMatch(/view\.server\.started port=\d+/)

    const page = await fetch(viewUrl)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('<html')
    const url = new URL(viewUrl)
    const stored = await fetch(`${url.origin}/api/view/${url.searchParams.get('view')}`)
    expect(stored.status).toBe(200)
    const json = (await stored.json()) as { arguments: unknown; result: unknown }
    expect(json.result).toEqual(answer)
    expect(json.arguments).toEqual({
      network: 'robinhood',
      query:
        'USE topology MATCH (a:Address)-[f:FLOWS_TO]->(t:Address) RETURN a.address AS from_address, t.address AS to_address LIMIT 5',
    })
  }, 30_000)
})
