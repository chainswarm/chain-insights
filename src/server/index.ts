import { serve } from '@hono/node-server'
import { createApp } from './app.js'

export function startServer(port = 4321): () => void {
  const app = createApp()
  const server = serve({
    fetch: app.fetch,
    hostname: '127.0.0.1', // localhost-only — REQUIRED (default 0.0.0.0 is insecure)
    port,
  })

  server.on('listening', () => {
    console.log(`Chain Insights server running on http://127.0.0.1:${port}`)
  })
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write(`Port already in use: 127.0.0.1:${port}\n`)
    } else {
      process.stderr.write(`Chain Insights server failed: ${err.message}\n`)
    }
    process.exitCode = 1
  })

  let stopped = false
  const stop = (callback?: () => void): void => {
    if (stopped) {
      callback?.()
      return
    }
    stopped = true
    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigterm)
    server.close(callback)
  }
  const onSigint = () => {
    stop()
    process.exit(0)
  }
  const onSigterm = () => {
    stop(() => process.exit(0))
  }

  process.on('SIGINT', onSigint)
  process.on('SIGTERM', onSigterm)

  return stop
}
