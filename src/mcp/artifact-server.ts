import { serve } from '@hono/node-server'
import { setTimeout as delay } from 'node:timers/promises'
import { createApp } from '../server/app.js'

type ArtifactServer = ReturnType<typeof serve>

const servers = new Map<number, ArtifactServer>()

async function isHealthy(port: number): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 500)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

async function waitUntilHealthy(port: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await isHealthy(port)) return
    await delay(50)
  }
  throw new Error(`Graph artifact server did not become healthy on 127.0.0.1:${port}`)
}

export async function ensureArtifactServer(port: number): Promise<void> {
  if (servers.has(port)) return
  if (await isHealthy(port)) return

  const app = createApp()
  const server = serve({
    fetch: app.fetch,
    hostname: '127.0.0.1',
    port,
  })
  servers.set(port, server)
  server.on('error', (err) => {
    servers.delete(port)
    process.stderr.write(`Chain Insights graph artifact server failed on 127.0.0.1:${port}: ${(err as Error).message}\n`)
  })

  try {
    await waitUntilHealthy(port)
  } catch (err) {
    servers.delete(port)
    server.close()
    throw err
  }
}

export function closeArtifactServers(): void {
  for (const [port, server] of servers.entries()) {
    server.close()
    servers.delete(port)
  }
}
