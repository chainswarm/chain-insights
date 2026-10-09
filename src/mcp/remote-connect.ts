/**
 * Connecting the proxy to the Chain Insights Graph endpoint.
 *
 * The hosted endpoint sheds load with HTTP 429 (an in-flight cap per IP, 8
 * anonymous, with Retry-After: 1). Before this module, a 429 on the first
 * POST made the proxy fall back to the SSE transport, which the endpoint
 * answers with 405, and the proxy then reported "Graph unreachable ... SSE
 * error: Non-200 status code (405)" for every graph query of its lifetime,
 * even once the endpoint had room again. Seen 2026-10-09 with nine proxies
 * on one workstation: two of ten test conversations lost every topology and
 * facts query while chain lookups kept working.
 *
 * Rules:
 * - 429, 502, 503 and 504 are "busy": wait (Retry-After, else a doubling
 *   backoff from one second) and try the same transport again, up to
 *   `attempts` times. Never fall back to SSE for a busy endpoint.
 * - 404 and 405 mean the endpoint is not streamable: try SSE once.
 * - Anything else (a refused connection, DNS, TLS) tries SSE once as before.
 * - A failure that was busy at the end is `retryable`: the proxy stays up and
 *   connects again on the next graph call instead of answering dead forever.
 */

export type RemoteTransport = 'streamable_http' | 'sse'

export interface RemoteConnectResult {
  connected: boolean
  transport: RemoteTransport | null
  /** The user-facing reason when not connected. */
  message?: string
  /** True when a later attempt may succeed (the endpoint was busy). */
  retryable: boolean
  attempts: number
}

export interface RemoteConnectOptions {
  endpoint: string
  /** Opens a fresh streamable-HTTP transport and connects. Throws on failure. */
  connectStreamable: () => Promise<void>
  /** Opens a fresh SSE transport and connects. Throws on failure. */
  connectSse: () => Promise<void>
  /** How many streamable tries while the endpoint is busy. */
  attempts?: number
  sleep?: (ms: number) => Promise<void>
  log?: (event: string, fields: Record<string, unknown>) => Promise<void> | void
}

const BUSY = new Set([429, 502, 503, 504])
const NOT_STREAMABLE = new Set([404, 405])

/** The HTTP status an SDK transport error carries, from its `code` or its text. */
export function httpStatusOf(err: unknown): number | null {
  if (err && typeof err === 'object') {
    const code = (err as { code?: unknown }).code
    if (typeof code === 'number' && code >= 100 && code < 600) return code
    const message = (err as { message?: unknown }).message
    if (typeof message === 'string') {
      const m = /\b(4\d\d|5\d\d)\b/.exec(message)
      if (m) return Number(m[1])
    }
  }
  return null
}

/** Milliseconds to wait before the next try: Retry-After when the error names one, else 1 s doubling. */
export function busyDelayMs(err: unknown, attempt: number): number {
  const retryAfter = (err as { retryAfter?: unknown } | null)?.retryAfter
  if (typeof retryAfter === 'number' && retryAfter > 0) return Math.min(retryAfter * 1000, 30_000)
  return Math.min(1000 * 2 ** (attempt - 1), 8000)
}

export function describeRemoteFailure(endpoint: string, err: unknown, status: number | null): string {
  if (status !== null && BUSY.has(status)) {
    return (
      `Chain Insights Graph is at capacity at ${endpoint} (HTTP ${status}, class capacity): ` +
      'wait at least 5 seconds, then send the same query once.'
    )
  }
  const text = err instanceof Error ? err.message : String(err)
  return `Chain Insights Graph unreachable at ${endpoint}: ${text}`
}

export async function connectRemote(options: RemoteConnectOptions): Promise<RemoteConnectResult> {
  const attempts = Math.max(1, options.attempts ?? 5)
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const log = options.log ?? (() => undefined)
  let lastErr: unknown = null
  let lastStatus: number | null = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await options.connectStreamable()
      await log('remote.connect', { transport: 'streamable_http', endpoint: options.endpoint, attempt })
      return { connected: true, transport: 'streamable_http', retryable: false, attempts: attempt }
    } catch (err) {
      lastErr = err
      lastStatus = httpStatusOf(err)
      await log('remote.connect_failed', {
        transport: 'streamable_http',
        endpoint: options.endpoint,
        attempt,
        status: lastStatus,
      })
      if (lastStatus !== null && BUSY.has(lastStatus) && attempt < attempts) {
        await sleep(busyDelayMs(err, attempt))
        continue
      }
      break
    }
  }
  const busy = lastStatus !== null && BUSY.has(lastStatus)
  if (!busy) {
    // Not streamable, or not reachable at all: one SSE try, as before.
    try {
      await options.connectSse()
      await log('remote.connect', { transport: 'sse', endpoint: options.endpoint })
      return { connected: true, transport: 'sse', retryable: false, attempts }
    } catch (err2) {
      await log('remote.connect_failed', { transport: 'sse', endpoint: options.endpoint, status: httpStatusOf(err2) })
      // The SSE 405 says nothing the user can act on; name the first failure
      // unless the streamable failure was only "not streamable".
      const named = lastStatus !== null && NOT_STREAMABLE.has(lastStatus) ? err2 : lastErr
      return {
        connected: false,
        transport: null,
        retryable: false,
        attempts,
        message: describeRemoteFailure(options.endpoint, named, null),
      }
    }
  }
  return {
    connected: false,
    transport: null,
    retryable: true,
    attempts,
    message: describeRemoteFailure(options.endpoint, lastErr, lastStatus),
  }
}
