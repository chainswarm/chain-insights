import { Hono } from 'hono'

export function createApp(): Hono {
  const app = new Hono()

  app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }))

  app.get('/status', async (c) => {
    const { healthCheck } = await import('../db/index.js')
    const db = await healthCheck()
    return c.json({
      database: db.ok ? 'healthy' : 'error',
      server: 'running',
    })
  })

  app.onError((err, c) => {
    console.error(err)
    return c.json({ error: 'Internal server error' }, 500)
  })

  return app
}
