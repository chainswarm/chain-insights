import {
  generateArtifactHtml,
  getTopupUrl as getCopiedTopupUrl,
  startTopupServer as startCopiedTopupServer,
} from './mcp-proxy/topup-server.js'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { isAddress } from 'viem'
import type { PaymentWalletAccount } from './tools.js'

interface ArtifactServerState {
  address: string
  assetServerUrl: string
  server: Server
  url: string
}

let artifactServerState: ArtifactServerState | null = null
const REQUEST_TARGET_BASE = 'http://localhost'

class ProxyRequestError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ProxyRequestError'
    this.status = status
  }
}

interface NormalizedProxyTarget {
  pathAndSearch: string
  pathname: string
}

function toWalletAddress(account: PaymentWalletAccount | string): string {
  const address = typeof account === 'string' ? account : account.address
  if (!isAddress(address)) {
    throw new Error('Wallet address must be a valid 0x-prefixed 20-byte EVM address')
  }
  return address
}

function send(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  contentType: string
): void {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  })
  res.end(body)
}

function normalizeProxyTarget(reqUrl: string): NormalizedProxyTarget {
  if (!reqUrl.startsWith('/') || reqUrl.startsWith('//')) {
    throw new ProxyRequestError(400, 'Proxy request target must be an origin-form path')
  }

  const parsed = new URL(reqUrl, REQUEST_TARGET_BASE)
  if (parsed.origin !== REQUEST_TARGET_BASE) {
    throw new ProxyRequestError(400, 'Absolute and protocol-relative proxy targets are not allowed')
  }

  let decodedPathname: string
  try {
    decodedPathname = decodeURIComponent(parsed.pathname)
  } catch {
    throw new ProxyRequestError(400, 'Proxy request target contains invalid encoding')
  }

  if (decodedPathname.startsWith('//') || /^\/[a-z][a-z0-9+.-]*:\/\//i.test(decodedPathname)) {
    throw new ProxyRequestError(400, 'Encoded host override targets are not allowed')
  }

  return {
    pathAndSearch: `${parsed.pathname}${parsed.search}`,
    pathname: parsed.pathname,
  }
}

async function proxyToCopiedServer(
  proxyTarget: NormalizedProxyTarget,
  res: ServerResponse,
  assetServerUrl: string
): Promise<void> {
  const allowedOrigin = new URL(assetServerUrl).origin
  const upstreamUrl = new URL(proxyTarget.pathAndSearch, assetServerUrl)
  if (upstreamUrl.origin !== allowedOrigin) {
    throw new ProxyRequestError(403, 'Upstream origin is not allowed')
  }

  const upstream = await fetch(upstreamUrl)
  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'
  const body = Buffer.from(await upstream.arrayBuffer())
  send(res, upstream.status, body, contentType)
}

export { generateArtifactHtml }

export function getTopupArtifactUrl(): string | null {
  return artifactServerState?.url ?? null
}

export function getTopupUrl(): string | null {
  return getTopupArtifactUrl() ?? getCopiedTopupUrl()
}

export async function stopTopupServer(): Promise<void> {
  if (!artifactServerState) {
    return
  }

  const { server } = artifactServerState
  artifactServerState = null
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

export async function startTopupServer(account: PaymentWalletAccount | string): Promise<string> {
  const walletAddress = toWalletAddress(account)

  if (
    artifactServerState &&
    artifactServerState.address.toLowerCase() === walletAddress.toLowerCase()
  ) {
    return artifactServerState.url
  }

  const assetServerUrl = await startCopiedTopupServer(walletAddress)

  if (artifactServerState) {
    await stopTopupServer()
  }

  const server = createServer((req, res) => {
    const reqUrl = req.url ?? '/'
    let proxyTarget: NormalizedProxyTarget
    try {
      proxyTarget = normalizeProxyTarget(reqUrl)
    } catch (err) {
      if (err instanceof ProxyRequestError) {
        send(
          res,
          err.status,
          JSON.stringify({ error: err.message }) + '\n',
          'application/json; charset=utf-8'
        )
        return
      }
      send(
        res,
        400,
        JSON.stringify({ error: 'Invalid request target' }) + '\n',
        'application/json; charset=utf-8'
      )
      return
    }
    const { pathname } = proxyTarget

    if (pathname === '/' || pathname === '/index.html') {
      const artifactUrl = artifactServerState?.url ?? assetServerUrl
      send(res, 200, generateArtifactHtml(walletAddress, artifactUrl), 'text/html; charset=utf-8')
      return
    }

    if (pathname.startsWith('/assets/') || pathname.startsWith('/api/')) {
      void proxyToCopiedServer(proxyTarget, res, assetServerUrl).catch((err) => {
        if (err instanceof ProxyRequestError) {
          send(
            res,
            err.status,
            JSON.stringify({ error: err.message }) + '\n',
            'application/json; charset=utf-8'
          )
          return
        }
        send(
          res,
          502,
          JSON.stringify({ error: (err as Error).message }) + '\n',
          'application/json; charset=utf-8'
        )
      })
      return
    }

    send(res, 404, JSON.stringify({ error: 'Not found' }) + '\n', 'application/json; charset=utf-8')
  })

  const url = await new Promise<string>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addressInfo = server.address()
      if (!addressInfo || typeof addressInfo === 'string') {
        reject(new Error('Failed to start topup artifact server'))
        return
      }
      resolve(`http://localhost:${addressInfo.port}`)
    })
  })

  artifactServerState = {
    address: walletAddress,
    assetServerUrl,
    server,
    url,
  }

  return url
}
