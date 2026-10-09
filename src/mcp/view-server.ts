import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

/**
 * The Chain Insights view as a browser page on the user's own PC.
 *
 * Claude Desktop draws the view in a small frame beside the answer and offers
 * no full screen. The proxy therefore serves the same view file over HTTP on
 * 127.0.0.1, and every drawn answer carries a link to it (view_url). The page
 * reads the answer back from this server by its id and calls graph_expand
 * through it, so a click in the browser costs what a click in the host costs.
 *
 * Routes, all same-origin, no CORS:
 *   GET  /view?view=<id>          the view file; when the id is held, the answer
 *                                 is written into it as
 *                                 <script type="application/json" data-chain-insights-view="<id>">
 *                                 so a window that may load the page but not call
 *                                 back to it (Claude Desktop's browser pane blocks
 *                                 requests to local hosts) still draws
 *   GET  /api/view/<id>           {"arguments": ..., "result": ...}, or 404
 *   POST /api/tools/graph_expand  {"arguments": {...}} -> the CallToolResult
 *
 * The server binds to 127.0.0.1 only, refuses a Host header that does not
 * name it (DNS rebinding), and keeps at most 50 answers in memory.
 */

export const VIEW_STORE_LIMIT = 50
export const VIEW_BODY_LIMIT_BYTES = 64 * 1024
// The one tool the page may call: the view's own click tool.
export const VIEW_PAGE_TOOLS = new Set(['graph_expand'])

export interface ViewEntry {
  toolName: string
  arguments: unknown
  result: unknown
}

/** A fresh answer id: 12 random bytes, URL-safe base64 (16 characters). */
export function newViewId(): string {
  return randomBytes(12).toString('base64url')
}

/** At most `limit` answers, the oldest evicted first. */
export class ViewStore {
  private readonly entries = new Map<string, ViewEntry>()

  constructor(private readonly limit: number = VIEW_STORE_LIMIT) {}

  put(entry: ViewEntry, id: string = newViewId()): string {
    this.entries.delete(id)
    this.entries.set(id, entry)
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
    return id
  }

  get(id: string): ViewEntry | undefined {
    return this.entries.get(id)
  }

  get size(): number {
    return this.entries.size
  }
}

/** The attribute the page reads the written-in answer from; the view (chain-insights-ui browser.ts) names the same one. */
export const EMBEDDED_VIEW_ATTR = 'data-chain-insights-view'

/** JSON safe inside a script element: no sequence that could close it, no line separators. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/**
 * The view file with the answer written in: one JSON script element before
 * </head> (else at the top). The id is URL-safe base64, attribute-safe as is.
 */
export function pageWithEntry(html: string, id: string, entry: ViewEntry): string {
  const script = `<script type="application/json" ${EMBEDDED_VIEW_ATTR}="${id}">${scriptJson({ arguments: entry.arguments, result: entry.result })}</script>`
  const head = html.indexOf('</head>')
  if (head >= 0) return `${html.slice(0, head)}${script}\n${html.slice(head)}`
  return `${script}\n${html}`
}

export interface ViewServerOptions {
  /** The view file; the held answer of ?view=<id> is written into it. */
  html: () => string
  /** Runs a page tool (graph_expand only) and returns its CallToolResult. */
  runTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
  /** One structured log line per event; never throws. */
  log?: (event: string, fields: Record<string, unknown>) => void
  limit?: number
}

export interface ViewServer {
  readonly port: number
  /** Stores an answer and returns its id. */
  put(entry: ViewEntry, id?: string): string
  /** The browser link of one answer. */
  viewUrl(id: string): string
  close(): Promise<void>
}

const COMMON_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}

function send(
  res: ServerResponse,
  status: number,
  contentType: string,
  body: string | Buffer
): void {
  res.writeHead(status, { ...COMMON_HEADERS, 'Content-Type': contentType })
  res.end(body)
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

class BodyTooLarge extends Error {}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let failed = false
    req.on('data', (chunk: Buffer) => {
      if (failed) return
      size += chunk.length
      if (size > limit) {
        failed = true
        reject(new BodyTooLarge())
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', (err) => {
      if (!failed) {
        failed = true
        reject(err)
      }
    })
  })
}

/**
 * Starts the server on 127.0.0.1 and a port the system picks. The server does
 * not keep the process alive: the proxy ends when its host closes stdio.
 */
export async function startViewServer(options: ViewServerOptions): Promise<ViewServer> {
  const store = new ViewStore(options.limit ?? VIEW_STORE_LIMIT)
  let port = 0
  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`])
  const allowedOrigins = () => new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`])

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = (req.headers.host ?? '').toLowerCase()
    if (!allowedHosts().has(host)) {
      sendJson(res, 403, { error: 'forbidden host' })
      return
    }
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
    const method = req.method ?? 'GET'
    const pathname = url.pathname

    if (method === 'GET' && pathname === '/view') {
      const id = url.searchParams.get('view') ?? ''
      const entry = /^[A-Za-z0-9_-]+$/.test(id) ? store.get(id) : undefined
      send(res, 200, 'text/html; charset=utf-8', entry ? pageWithEntry(options.html(), id, entry) : options.html())
      return
    }

    const viewMatch = /^\/api\/view\/([A-Za-z0-9_-]+)$/.exec(pathname)
    if (method === 'GET' && viewMatch) {
      const entry = store.get(viewMatch[1])
      if (!entry) {
        sendJson(res, 404, { error: 'unknown view' })
        return
      }
      sendJson(res, 200, { arguments: entry.arguments, result: entry.result })
      return
    }

    const toolMatch = /^\/api\/tools\/([A-Za-z0-9_-]+)$/.exec(pathname)
    if (method === 'POST' && toolMatch && VIEW_PAGE_TOOLS.has(toolMatch[1])) {
      // A page on another site can post to 127.0.0.1 with the right Host
      // header. Its browser sends its own Origin, and a JSON body needs a
      // preflight this server never answers, so both are required here.
      const origin = req.headers.origin
      if (origin !== undefined && !allowedOrigins().has(origin.toLowerCase())) {
        sendJson(res, 403, { error: 'forbidden origin' })
        return
      }
      const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
      if (contentType !== 'application/json') {
        sendJson(res, 415, { error: 'send application/json' })
        return
      }
      let body: unknown
      try {
        const text = await readBody(req, VIEW_BODY_LIMIT_BYTES)
        body = text.trim() === '' ? {} : JSON.parse(text)
      } catch (err) {
        if (err instanceof BodyTooLarge) {
          sendJson(res, 413, { error: 'body too large' })
          req.resume()
          return
        }
        sendJson(res, 400, { error: 'invalid JSON' })
        return
      }
      const args = isRecord(body) ? (body.arguments ?? {}) : undefined
      if (!isRecord(args)) {
        sendJson(res, 400, { error: 'arguments must be an object' })
        return
      }
      const result = await options.runTool(toolMatch[1], args)
      sendJson(res, 200, result)
      return
    }

    sendJson(res, 404, { error: 'not found' })
  }

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      options.log?.('view.server.request_failed', {
        error: err instanceof Error ? err.message : String(err),
      })
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' })
      else res.end()
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address !== 'object') {
    server.close()
    throw new Error('The view server has no port')
  }
  port = address.port
  server.unref()
  options.log?.('view.server.started', { port })

  return {
    port,
    put: (entry, id) => store.put(entry, id),
    viewUrl: (id) => `http://127.0.0.1:${port}/view?view=${encodeURIComponent(id)}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections?.()
      }),
  }
}
