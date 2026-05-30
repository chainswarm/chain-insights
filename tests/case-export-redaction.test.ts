import { describe, expect, it } from 'vitest'

describe('case export redaction', () => {
  it('keeps addresses in private mode and records no address redaction', async () => {
    const { createRedactor } = await import('../src/export/redaction.js')
    const redactor = createRedactor('private')
    const text = redactor.text('Source 5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5 sent to 0x0000000000000000000000000000000000000001')

    expect(text).toContain('5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5')
    expect(text).toContain('0x0000000000000000000000000000000000000001')
    expect(redactor.redactions()).toEqual([])
  })

  it('aliases substrate and evm addresses in public mode', async () => {
    const { createRedactor } = await import('../src/export/redaction.js')
    const redactor = createRedactor('public')
    const text = redactor.text('5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5 -> 0x0000000000000000000000000000000000000001')

    expect(text).toContain('addr_001')
    expect(text).toContain('addr_002')
    expect(text).not.toContain('5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5')
    expect(text).not.toContain('0x0000000000000000000000000000000000000001')
    expect(redactor.aliasFor('5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5')).toBe('addr_001')
  })

  it('redacts secrets in every mode', async () => {
    const { createRedactor } = await import('../src/export/redaction.js')
    const redactor = createRedactor('private')
    const text = redactor.text('token=ci_test_secret privateKey=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')

    expect(text).toContain('[redacted-secret]')
    expect(text).not.toContain('ci_test_secret')
    expect(text).not.toContain('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  })
})
