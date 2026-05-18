import {
  generateArtifactHtml,
  getTopupUrl as getCopiedTopupUrl,
  startTopupServer as startCopiedTopupServer,
} from './mcp-proxy/topup-server.js'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { WalletData } from './mcp-proxy/types.js'
import type { PaymentWalletAccount } from './tools.js'

const FALLBACK_PRIVATE_KEY = `0x${'0'.repeat(63)}1`

interface ArtifactServerState {
  address: string
  assetServerUrl: string
  server: Server
  url: string
}

let artifactServerState: ArtifactServerState | null = null

function toWalletData(account: PaymentWalletAccount | string): WalletData {
  if (typeof account === 'string') {
    return {
      address: account,
      privateKey: FALLBACK_PRIVATE_KEY,
      createdAt: new Date(0).toISOString(),
    }
  }

  return {
    address: account.address,
    privateKey: account.privateKey,
    createdAt: new Date(0).toISOString(),
  }
}

function send(res: ServerResponse, status: number, body: string | Buffer, contentType: string): void {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  })
  res.end(body)
}

async function proxyToCopiedServer(reqUrl: string, res: ServerResponse, assetServerUrl: string): Promise<void> {
  const upstreamUrl = new URL(reqUrl, assetServerUrl)
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

export async function startTopupServer(account: PaymentWalletAccount | string): Promise<string> {
  const wallet = toWalletData(account)

  if (artifactServerState && artifactServerState.address.toLowerCase() === wallet.address.toLowerCase()) {
    return artifactServerState.url
  }

  const assetServerUrl = await startCopiedTopupServer(wallet)

  if (artifactServerState) {
    await new Promise<void>((resolve) => artifactServerState?.server.close(() => resolve()))
    artifactServerState = null
  }

  const server = createServer((req, res) => {
    const reqUrl = req.url ?? '/'
    const pathname = new URL(reqUrl, 'http://localhost').pathname

    if (pathname === '/' || pathname === '/index.html') {
      const artifactUrl = artifactServerState?.url ?? assetServerUrl
      send(res, 200, generateArtifactHtml(wallet.address, artifactUrl), 'text/html; charset=utf-8')
      return
    }

    if (pathname.startsWith('/assets/') || pathname.startsWith('/api/')) {
      void proxyToCopiedServer(reqUrl, res, assetServerUrl).catch((err) => {
        send(res, 502, JSON.stringify({ error: (err as Error).message }) + '\n', 'application/json; charset=utf-8')
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
    address: wallet.address,
    assetServerUrl,
    server,
    url,
  }

  return url
}
