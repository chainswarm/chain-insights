import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_RETRY_WAIT_MS,
  rateLimitWaitMs,
  rateLimitedResult,
  withRateLimitRetry,
} from '../src/mcp/rate-limit.js'

// The refusal the hosted endpoint sends, as the MCP client throws it.
const refusal = (seconds: number) =>
  new Error(
    `Streamable HTTP error: Error POSTing to endpoint: {"error":"too many requests from this address; retry after ${seconds} seconds"}`
  )

describe('rate limit of the graph endpoint', () => {
  it.each([
    ['the endpoint names a wait', refusal(3), 3_000],
    ['a wait under one second reads as one second', refusal(0), 1_000],
    ['no wait named', new Error('429 Too Many Requests'), DEFAULT_RETRY_WAIT_MS],
    ['a 429 code', Object.assign(new Error('limited'), { code: 429 }), DEFAULT_RETRY_WAIT_MS],
    ['another failure', new Error('connect ECONNREFUSED'), null],
  ])('%s', (_name, err, wait) => {
    expect(rateLimitWaitMs(err)).toBe(wait)
  })

  it('waits the named time and sends the call once more', async () => {
    const call = vi.fn().mockRejectedValueOnce(refusal(3)).mockResolvedValueOnce('rows')
    const sleep = vi.fn().mockResolvedValue(undefined)
    await expect(withRateLimitRetry(call, sleep)).resolves.toBe('rows')
    expect(sleep).toHaveBeenCalledWith(3_000)
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('throws the second refusal without a third call', async () => {
    const call = vi.fn().mockRejectedValue(refusal(3))
    const sleep = vi.fn().mockResolvedValue(undefined)
    await expect(withRateLimitRetry(call, sleep)).rejects.toThrow('too many requests')
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('does not hold a call for a wait over ten seconds', async () => {
    const call = vi.fn().mockRejectedValue(refusal(30))
    const sleep = vi.fn()
    await expect(withRateLimitRetry(call, sleep)).rejects.toThrow('retry after 30 seconds')
    expect(sleep).not.toHaveBeenCalled()
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('does not resend any other failure', async () => {
    const call = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'))
    const sleep = vi.fn()
    await expect(withRateLimitRetry(call, sleep)).rejects.toThrow('ECONNREFUSED')
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('answers a refusal with the capacity envelope', () => {
    const result = rateLimitedResult('graph_query', refusal(30))
    expect(result?.isError).toBe(true)
    expect(result?.structuredContent.error_detail).toMatchObject({
      code: 'rate_limited',
      class: 'capacity',
      fix: 'Wait 30 seconds, then send the same request once.',
    })
    expect(result?.content[0]?.text).toContain('limiting requests')
    expect(rateLimitedResult('graph_query', new Error('boom'))).toBeNull()
  })
})
