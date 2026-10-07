/**
 * The graph endpoint limits requests per address. Its refusal arrives as a
 * thrown HTTP error, "too many requests from this address; retry after 3
 * seconds", not as a typed tool reply. Every proxied tool reads only, and a
 * refused request is not billed, so one wait and one resend are safe.
 *
 * When the resend is refused too, or the endpoint asks for a longer wait than
 * the proxy holds a call for, the caller gets the refusal envelope the graph
 * server uses for every other limit: class `capacity`. The skills tell an
 * agent what to do with that class.
 */

/** The longest wait the proxy holds a call for before it sends it once more. */
export const MAX_RETRY_WAIT_MS = 10_000
/** The wait when the endpoint names none. The skills say at least 5 seconds. */
export const DEFAULT_RETRY_WAIT_MS = 5_000
const MIN_RETRY_WAIT_MS = 1_000

const RATE_LIMITED = /\b429\b|too many requests|rate.?limit/i
const RETRY_AFTER = /retry after (\d+) seconds?/i

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * The wait the endpoint asks for, in milliseconds, when err is its rate
 * limit, and null for any other failure.
 */
export function rateLimitWaitMs(err: unknown): number | null {
  const code = err && typeof err === 'object' ? (err as { code?: unknown }).code : undefined
  const message = messageOf(err)
  if (code !== 429 && !RATE_LIMITED.test(message)) return null
  const seconds = RETRY_AFTER.exec(message)?.[1]
  return seconds ? Math.max(Number(seconds) * 1000, MIN_RETRY_WAIT_MS) : DEFAULT_RETRY_WAIT_MS
}

export type Sleep = (ms: number) => Promise<void>

const defaultSleep: Sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/**
 * Runs call. When the endpoint refuses it for the rate limit and asks for a
 * wait of at most MAX_RETRY_WAIT_MS, waits that long and runs it once more.
 * Any other failure, and the second refusal, is thrown to the caller.
 */
export async function withRateLimitRetry<T>(
  call: () => Promise<T>,
  sleep: Sleep = defaultSleep
): Promise<T> {
  try {
    return await call()
  } catch (err) {
    const wait = rateLimitWaitMs(err)
    if (wait === null || wait > MAX_RETRY_WAIT_MS) throw err
    await sleep(wait)
    return await call()
  }
}

/**
 * The reply for a call the endpoint refused for the rate limit: the text the
 * agent reads and the `capacity` envelope the skills act on. Null when err is
 * not the rate limit.
 */
export function rateLimitedResult(toolName: string, err: unknown) {
  const wait = rateLimitWaitMs(err)
  if (wait === null) return null
  const seconds = Math.ceil(wait / 1000)
  const fix = `Wait ${seconds} seconds, then send the same request once.`
  return {
    content: [
      {
        type: 'text' as const,
        text: `${toolName} was not run: Chain Insights Graph is limiting requests from this address. ${fix}`,
      },
    ],
    structuredContent: {
      schema: 'chain-insights.result.v1',
      tool: toolName,
      hint: null,
      error_detail: {
        code: 'rate_limited',
        rule: 'requests_per_address',
        class: 'capacity',
        fix,
        example: '',
      },
    },
    isError: true,
  }
}
