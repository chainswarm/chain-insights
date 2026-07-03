import { describe, it, expect } from 'vitest'
import { resolveServerPort } from '../src/server/resolve-port.js'

describe('resolveServerPort', () => {
  it('falls back to the configured serverPort when --port is omitted', () => {
    expect(resolveServerPort(undefined, 4321)).toBe(4321)
    expect(resolveServerPort(undefined, 8080)).toBe(8080)
  })

  it('honors an explicit --port over the configured serverPort', () => {
    expect(resolveServerPort('9000', 8080)).toBe(9000)
  })

  it('rejects a non-numeric --port instead of letting NaN reach listen()', () => {
    expect(() => resolveServerPort('abc', 4321)).toThrow(/Invalid --port/)
  })

  it('rejects ports outside the 1024-65535 range', () => {
    expect(() => resolveServerPort('80', 4321)).toThrow(/1024/)
    expect(() => resolveServerPort('70000', 4321)).toThrow(/65535/)
    expect(() => resolveServerPort('4321.5', 4321)).toThrow()
  })
})
