/**
 * Minimal QR code generator. No external dependencies.
 *
 * Byte mode, error correction level L, versions 1 to 4 (single block), mask 0.
 * Version 3 holds a 42-character EVM address; version 4 holds up to 78 bytes.
 *
 * `qrModules` is self-contained on purpose: the top-up view inlines its source
 * (`qrModules.toString()`) and draws the same QR code inside the Claude view,
 * so the function must not reference anything outside its own body.
 */

/**
 * The QR code modules for `text`: a square matrix, 1 for a dark module and 0
 * for a light one, without the quiet zone. Throws when `text` is longer than
 * 78 UTF-8 bytes.
 */
export function qrModules(text: string): number[][] {
  // Level L, single-block versions: [version, total codewords, EC codewords].
  const versions = [
    [1, 26, 7],
    [2, 44, 10],
    [3, 70, 15],
    [4, 100, 20],
  ]
  // Format information for level L and mask 0, BCH-coded and masked.
  const formatBits = 0x77c4
  const bytes = Array.from(new TextEncoder().encode(text))

  let version = 0
  let totalCodewords = 0
  let ecCodewords = 0
  for (const entry of versions) {
    const dataCodewords = entry[1] - entry[2]
    if (4 + 8 + bytes.length * 8 <= dataCodewords * 8) {
      version = entry[0]
      totalCodewords = entry[1]
      ecCodewords = entry[2]
      break
    }
  }
  if (version === 0) throw new Error('QR text is too long: at most 78 bytes')

  const dataCodewords = totalCodewords - ecCodewords
  const size = version * 4 + 17

  // Data bits: mode, count, bytes, terminator, byte padding, pad codewords.
  const bits: number[] = []
  const pushBits = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1)
  }
  pushBits(0b0100, 4)
  pushBits(bytes.length, 8)
  for (const value of bytes) pushBits(value, 8)
  const capacity = dataCodewords * 8
  pushBits(0, Math.min(4, capacity - bits.length))
  while (bits.length % 8 !== 0) bits.push(0)
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) pushBits(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0
    for (let j = 0; j < 8; j++) value = (value << 1) | bits[i + j]
    data.push(value)
  }

  // Reed-Solomon error correction over GF(256), polynomial 0x11d.
  const exp: number[] = []
  const log: number[] = []
  for (let i = 0, x = 1; i < 255; i++) {
    exp[i] = x
    log[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  const multiply = (a: number, b: number) => (a === 0 || b === 0 ? 0 : exp[(log[a] + log[b]) % 255])
  let generator = [1]
  for (let i = 0; i < ecCodewords; i++) {
    const next = new Array(generator.length + 1).fill(0)
    for (let j = 0; j < generator.length; j++) {
      next[j] ^= generator[j]
      next[j + 1] ^= multiply(generator[j], exp[i])
    }
    generator = next
  }
  const remainder = [...data, ...new Array(ecCodewords).fill(0)]
  for (let i = 0; i < data.length; i++) {
    const factor = remainder[i]
    if (factor === 0) continue
    for (let j = 0; j < generator.length; j++) remainder[i + j] ^= multiply(generator[j], factor)
  }
  const codewords = [...data, ...remainder.slice(data.length)]

  // Function patterns. `reserved` marks every module data may not use.
  const modules: number[][] = []
  const reserved: boolean[][] = []
  for (let row = 0; row < size; row++) {
    modules.push(new Array(size).fill(0))
    reserved.push(new Array(size).fill(false))
  }
  const setFunction = (row: number, col: number, dark: boolean) => {
    modules[row][col] = dark ? 1 : 0
    reserved[row][col] = true
  }
  for (let i = 0; i < size; i++) {
    setFunction(6, i, i % 2 === 0)
    setFunction(i, 6, i % 2 === 0)
  }
  const finder = (centerRow: number, centerCol: number) => {
    for (let dr = -4; dr <= 4; dr++) {
      for (let dc = -4; dc <= 4; dc++) {
        const row = centerRow + dr
        const col = centerCol + dc
        if (row < 0 || row >= size || col < 0 || col >= size) continue
        const distance = Math.max(Math.abs(dr), Math.abs(dc))
        setFunction(row, col, distance !== 2 && distance !== 4)
      }
    }
  }
  finder(3, 3)
  finder(3, size - 4)
  finder(size - 4, 3)
  if (version >= 2) {
    const center = size - 7
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        setFunction(center + dr, center + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1)
      }
    }
  }
  const formatBit = (i: number) => ((formatBits >>> i) & 1) === 1
  for (let i = 0; i <= 5; i++) setFunction(i, 8, formatBit(i))
  setFunction(7, 8, formatBit(6))
  setFunction(8, 8, formatBit(7))
  setFunction(8, 7, formatBit(8))
  for (let i = 9; i < 15; i++) setFunction(8, 14 - i, formatBit(i))
  for (let i = 0; i < 8; i++) setFunction(8, size - 1 - i, formatBit(i))
  for (let i = 8; i < 15; i++) setFunction(size - 15 + i, 8, formatBit(i))
  setFunction(size - 8, 8, true)

  // Data in the zigzag order, then mask 0 on every data module.
  let bitIndex = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    const upward = ((right + 1) & 2) === 0
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step
      for (let j = 0; j < 2; j++) {
        const col = right - j
        if (reserved[row][col]) continue
        if (bitIndex < codewords.length * 8) {
          modules[row][col] = (codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1
          bitIndex++
        }
        if ((row + col) % 2 === 0) modules[row][col] ^= 1
      }
    }
  }
  return modules
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

  const matrix = qrModules(text)
  const size = matrix.length

  // Logo exclusion zone (center of QR)
  const logoW = options.logoWidth ?? 7
  const logoH = options.logoHeight ?? 5
  const logoStartC = Math.floor((size - logoW) / 2)
  const logoStartR = Math.floor((size - logoH) / 2)
  const hasLogo = !!options.logoBase64

  const svgSize = size * cellSize
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${svgSize}" height="${svgSize}" viewBox="0 0 ${svgSize} ${svgSize}">`
  svg += `<rect width="${svgSize}" height="${svgSize}" fill="${bgColor}" rx="4"/>`

  const isFinderModule = (r: number, c: number): boolean =>
    (r < 7 && c < 7) || (r < 7 && c >= size - 7) || (r >= size - 7 && c < 7)

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
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

  if (hasLogo && options.logoBase64) {
    const lx = logoStartC * cellSize
    const ly = logoStartR * cellSize
    const lw = logoW * cellSize
    const lh = logoH * cellSize
    svg += `<rect x="${lx - 1}" y="${ly - 1}" width="${lw + 2}" height="${lh + 2}" fill="${bgColor}" rx="3"/>`
    svg += `<image x="${lx + 2}" y="${ly + 2}" width="${lw - 4}" height="${lh - 4}" href="${options.logoBase64}" xlink:href="${options.logoBase64}" preserveAspectRatio="xMidYMid meet"/>`
  }

  svg += '</svg>'
  return svg
}
