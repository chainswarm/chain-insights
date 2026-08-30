/**
 * Minimal QR code generator — produces SVG string server-side.
 * Supports alphanumeric mode (sufficient for Ethereum addresses).
 * No external dependencies.
 */

// Error correction level M (15% recovery)
const EC_LEVEL = 0 // L=0, M=1 — using L for simplicity with short data

// QR code version 2 (25x25) is sufficient for 42-char ETH addresses
const VERSION = 2
const SIZE = 25 // modules per side for version 2

// Generator polynomial for version 2-L: 10 EC codewords
const EC_CODEWORDS = 10
const DATA_CODEWORDS = 34

// Format info for version 2, mask 0, EC level L
const FORMAT_BITS = 0b111011111000100

// Byte mode indicator
const MODE_BYTE = 0b0100

function createMatrix(): number[][] {
  const m: number[][] = []
  for (let i = 0; i < SIZE; i++) {
    m[i] = new Array(SIZE).fill(-1)
  }
  return m
}

function addFinderPattern(matrix: number[][], row: number, col: number): void {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const mr = row + r
      const mc = col + c
      if (mr < 0 || mr >= SIZE || mc < 0 || mc >= SIZE) continue
      if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
        if (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)) {
          matrix[mr][mc] = 1
        } else {
          matrix[mr][mc] = 0
        }
      } else {
        matrix[mr][mc] = 0
      }
    }
  }
}

function addAlignmentPattern(matrix: number[][], row: number, col: number): void {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      if (Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0)) {
        matrix[row + r][col + c] = 1
      } else {
        matrix[row + r][col + c] = 0
      }
    }
  }
}

function addTimingPatterns(matrix: number[][]): void {
  for (let i = 8; i < SIZE - 8; i++) {
    if (matrix[6][i] === -1) matrix[6][i] = i % 2 === 0 ? 1 : 0
    if (matrix[i][6] === -1) matrix[i][6] = i % 2 === 0 ? 1 : 0
  }
}

function addFormatInfo(matrix: number[][]): void {
  const bits = FORMAT_BITS
  for (let i = 0; i <= 5; i++) matrix[8][i] = (bits >> (14 - i)) & 1
  matrix[8][7] = (bits >> 8) & 1
  matrix[8][8] = (bits >> 7) & 1
  matrix[7][8] = (bits >> 6) & 1
  for (let i = 0; i <= 5; i++) matrix[5 - i][8] = (bits >> i) & 1

  for (let i = 0; i <= 7; i++) matrix[SIZE - 1 - i][8] = (bits >> (14 - i)) & 1
  for (let i = 0; i <= 7; i++) matrix[8][SIZE - 8 + i] = (bits >> (7 - i)) & 1

  // Dark module
  matrix[SIZE - 8][8] = 1
}

function encodeData(text: string): number[] {
  const bytes = new TextEncoder().encode(text)
  const bits: number[] = []

  // Mode indicator (4 bits): byte mode
  for (let i = 3; i >= 0; i--) bits.push((MODE_BYTE >> i) & 1)

  // Character count (8 bits for version 1-9 byte mode)
  for (let i = 7; i >= 0; i--) bits.push((bytes.length >> i) & 1)

  // Data
  for (const b of bytes) {
    for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1)
  }

  // Terminator
  while (bits.length < DATA_CODEWORDS * 8 && bits.length < DATA_CODEWORDS * 8) {
    bits.push(0)
    if (bits.length >= DATA_CODEWORDS * 8) break
  }

  // Pad to byte boundary
  while (bits.length % 8 !== 0) bits.push(0)

  // Pad codewords
  const padBytes = [0xec, 0x11]
  let padIdx = 0
  while (bits.length < DATA_CODEWORDS * 8) {
    const pb = padBytes[padIdx % 2]
    for (let i = 7; i >= 0; i--) bits.push((pb >> i) & 1)
    padIdx++
  }

  // Convert to bytes
  const codewords: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let val = 0
    for (let j = 0; j < 8; j++) val = (val << 1) | (bits[i + j] || 0)
    codewords.push(val)
  }

  return codewords
}

// GF(256) arithmetic for Reed-Solomon
const GF_EXP = new Array(512).fill(0)
const GF_LOG = new Array(256).fill(0)

;(function initGF() {
  let x = 1
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]
})()

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return GF_EXP[GF_LOG[a] + GF_LOG[b]]
}

function rsEncode(data: number[], ecCount: number): number[] {
  // Generate generator polynomial
  let gen = [1]
  for (let i = 0; i < ecCount; i++) {
    const next = new Array(gen.length + 1).fill(0)
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j]
      next[j + 1] ^= gfMul(gen[j], GF_EXP[i])
    }
    gen = next
  }

  const msg = [...data, ...new Array(ecCount).fill(0)]
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i]
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j], coef)
      }
    }
  }

  return msg.slice(data.length)
}

function placeData(matrix: number[][], dataBits: number[]): void {
  let bitIdx = 0
  let upward = true

  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5 // skip timing column

    const rows = upward
      ? Array.from({ length: SIZE }, (_, i) => SIZE - 1 - i)
      : Array.from({ length: SIZE }, (_, i) => i)

    for (const row of rows) {
      for (let c = 0; c < 2; c++) {
        const col = right - c
        if (matrix[row][col] !== -1) continue
        matrix[row][col] = bitIdx < dataBits.length ? dataBits[bitIdx++] : 0
      }
    }
    upward = !upward
  }
}

function applyMask0(matrix: number[][], reserved: number[][]): void {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (reserved[r][c] !== -1) continue
      if ((r + c) % 2 === 0) {
        matrix[r][c] ^= 1
      }
    }
  }
}

export interface QrOptions {
  cellSize?: number
  fgColor?: string
  bgColor?: string
  finderColor?: string
  logoBase64?: string // data URI for center logo
  logoWidth?: number // logo width in modules (default: 7)
  logoHeight?: number // logo height in modules (default: 5)
}

export function generateQrSvg(text: string, opts: QrOptions | number = 4): string {
  // Backward compat: accept bare cellSize number
  const options: QrOptions = typeof opts === 'number' ? { cellSize: opts } : opts
  const cellSize = options.cellSize ?? 4
  const fgColor = options.fgColor ?? '#000'
  const bgColor = options.bgColor ?? '#fff'
  const finderColor = options.finderColor ?? fgColor

  const matrix = createMatrix()

  // Finder patterns
  addFinderPattern(matrix, 0, 0)
  addFinderPattern(matrix, 0, SIZE - 7)
  addFinderPattern(matrix, SIZE - 7, 0)

  // Alignment pattern (version 2: at position 18)
  addAlignmentPattern(matrix, 18, 18)

  // Timing
  addTimingPatterns(matrix)

  // Format info placeholder
  addFormatInfo(matrix)

  // Save reserved areas
  const reserved = matrix.map((row) => [...row])

  // Encode data + EC
  const dataCodewords = encodeData(text)
  const ecCodewords = rsEncode(dataCodewords, EC_CODEWORDS)
  const allCodewords = [...dataCodewords, ...ecCodewords]

  // Convert to bits
  const dataBits: number[] = []
  for (const cw of allCodewords) {
    for (let i = 7; i >= 0; i--) dataBits.push((cw >> i) & 1)
  }

  // Place data
  placeData(matrix, dataBits)

  // Apply mask 0
  applyMask0(matrix, reserved)

  // Re-apply format info (mask may have flipped it)
  addFormatInfo(matrix)

  // Logo exclusion zone (center of QR)
  const logoW = options.logoWidth ?? 7
  const logoH = options.logoHeight ?? 5
  const logoStartC = Math.floor((SIZE - logoW) / 2)
  const logoStartR = Math.floor((SIZE - logoH) / 2)
  const hasLogo = !!options.logoBase64

  // Generate SVG
  const svgSize = SIZE * cellSize
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${svgSize}" height="${svgSize}" viewBox="0 0 ${svgSize} ${svgSize}">`
  svg += `<rect width="${svgSize}" height="${svgSize}" fill="${bgColor}" rx="4"/>`

  // Finder pattern regions for coloring
  const isFinderModule = (r: number, c: number): boolean =>
    (r < 7 && c < 7) || (r < 7 && c >= SIZE - 7) || (r >= SIZE - 7 && c < 7)

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      // Skip logo area
      if (
        hasLogo &&
        r >= logoStartR &&
        r < logoStartR + logoH &&
        c >= logoStartC &&
        c < logoStartC + logoW
      ) {
        continue
      }
      if (matrix[r][c] === 1) {
        const color = isFinderModule(r, c) ? finderColor : fgColor
        svg += `<rect x="${c * cellSize}" y="${r * cellSize}" width="${cellSize}" height="${cellSize}" fill="${color}" rx="0.5"/>`
      }
    }
  }

  // Embed logo in center
  if (hasLogo && options.logoBase64) {
    const lx = logoStartC * cellSize
    const ly = logoStartR * cellSize
    const lw = logoW * cellSize
    const lh = logoH * cellSize
    // White background behind logo
    svg += `<rect x="${lx - 1}" y="${ly - 1}" width="${lw + 2}" height="${lh + 2}" fill="${bgColor}" rx="3"/>`
    svg += `<image x="${lx + 2}" y="${ly + 2}" width="${lw - 4}" height="${lh - 4}" href="${options.logoBase64}" xlink:href="${options.logoBase64}" preserveAspectRatio="xMidYMid meet"/>`
  }

  svg += '</svg>'
  return svg
}
