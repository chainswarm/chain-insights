import { serve } from '@hono/node-server'
import { createApp } from './app.js'

export function startServer(port = 4321): () => void {
  const app    = createApp()
  const server = serve({
    fetch:    app.fetch,
    hostname: '127.0.0.1', // localhost-only — REQUIRED (default 0.0.0.0 is insecure)
    port,
  })

  console.log(`Chain Insights server running on http://127.0.0.1:${port}`)

  process.on('SIGINT',  () => { server.close(); process.exit(0) })
  process.on('SIGTERM', () => { server.close(() => process.exit(0)) })

  return () => server.close()
}
