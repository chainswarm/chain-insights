import { describe, expect, it } from 'vitest'
import { qrModules, qrTerminalText } from '../src/wallet/mcp-proxy/qr.js'

const ADDRESS = '0x00000000000000000000000000000000000000aa'

/** Reads the terminal text back into modules: ▀ top, ▄ bottom, █ both. */
function decode(text: string): number[][] {
  const rows: number[][] = []
  for (const line of text.split('\n')) {
    const chars = [...line]
    rows.push(chars.map((c) => (c === '█' || c === '▀' ? 1 : 0)))
    rows.push(chars.map((c) => (c === '█' || c === '▄' ? 1 : 0)))
  }
  return rows
}

describe('the terminal QR code', () => {
  it('terminal QR rows match qrModules two rows per line', () => {
    const modules = qrModules(ADDRESS)
    const text = qrTerminalText(ADDRESS)
    const size = modules.length + 8
    expect(text.split('\n')).toHaveLength(Math.ceil(size / 2))
    const drawn = decode(text)
    for (let r = 0; r < modules.length; r++) {
      expect(drawn[r + 4].slice(4, 4 + modules.length), `row ${r}`).toEqual(modules[r])
    }
  })

  it('terminal QR has a 4-module quiet zone', () => {
    const modules = qrModules(ADDRESS)
    const size = modules.length + 8
    const drawn = decode(qrTerminalText(ADDRESS)).slice(0, size)
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const inQuiet = r < 4 || c < 4 || r >= size - 4 || c >= size - 4
        if (inQuiet) expect(drawn[r][c], `${r},${c}`).toBe(0)
      }
    }
    expect([...qrTerminalText(ADDRESS).split('\n')[0]].every((c) => c === ' ')).toBe(true)
  })

  it('inverts on request: the quiet zone becomes blocks', () => {
    const line = qrTerminalText(ADDRESS, { invert: true }).split('\n')[0]
    expect([...line].every((c) => c === '█')).toBe(true)
  })
})
