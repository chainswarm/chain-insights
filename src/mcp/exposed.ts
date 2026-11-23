/**
 * The exposed blocks of an address: how close it sits to a scam kind.
 *
 * An :Address node may carry `exposed`, JSON text: an array with one block per
 * scam kind, sorted by scam_kind. A block says the address is in the blast
 * radius of a scam kind, a few payments from an address that is. That is a
 * grade below proof: it is never evidence against the address, it sets no
 * risk word, and it carries no number. A node with no `exposed` says nothing
 * here: no row, no "not available". `exposed_pass` is the writer's own
 * bookkeeping and is never read.
 *
 * The words come from the card dictionary (registry/address-card.json, list
 * `words`, question `exposure`): the grade word `exposed`, the bands
 * `exposed_band:top|high|raised`, the scam kind names `scam_kind:<kind>` and
 * the `paid_once` sentence. A kind the dictionary does not name is shown by
 * its own kind text. Pure: no read, no clock. A malformed value shows nothing
 * and is logged once, never thrown.
 */

import type { AddressCardWord } from './address-card.js'

export const EXPOSED_GRADE = 'exposed' as const
export const EXPOSED_BANDS = ['top', 'high', 'raised'] as const
export type ExposedBand = (typeof EXPOSED_BANDS)[number]

/** One block of the answer, the writer's facts and the words of the dictionary. */
export interface ExposedBlock {
  /** Always `exposed`: a grade below proof, never evidence against the address. */
  grade: typeof EXPOSED_GRADE
  band: ExposedBand
  band_plain: string | null
  scam_kind: string
  scam_kind_name: string
  steps: number
  /** The trail id. */
  path: string | null
  path_address: string | null
  /** The addresses of the way, nearest the address first. */
  way: string[]
  link_payments: number | null
  link_two_way: boolean | null
  day: string | null
  profile: string | null
  paid_once: boolean
  /** The one sentence a reader sees. */
  text: string
}

const defaultLog = (line: string): void => {
  process.stderr.write(`[chain-insights] exposed: ${line}\n`)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

function wordOf(
  dictionary: readonly AddressCardWord[],
  word: string,
  value?: string
): AddressCardWord | null {
  const items = dictionary.filter((item) => item.question === 'exposure' && item.word === word)
  if (value !== undefined) {
    const wanted = value.toLowerCase()
    const exact = items.find((item) => item.value?.toLowerCase() === wanted)
    if (exact) return exact
  }
  return items.find((item) => item.value === undefined) ?? null
}

/** The dictionary's name of a scam kind, else the kind text as the writer gave it. */
function kindNameOf(kind: string, dictionary: readonly AddressCardWord[]): string {
  const item = wordOf(dictionary, 'scam_kind', kind)
  return item?.value !== undefined ? item.plain : kind
}

/** The sentence of one block, from the dictionary's words. */
export function exposedText(
  block: Pick<ExposedBlock, 'band' | 'scam_kind_name' | 'steps' | 'way' | 'path_address' | 'paid_once'>,
  dictionary: readonly AddressCardWord[]
): string {
  // The direction is fixed: the address paid way[0], way[0] paid way[1], ..., the last paid the path
  // address. The sentence never says money came to the address.
  const chain = [...block.way, ...(block.path_address ? [block.path_address] : [])]
  const payments = `${block.steps} payment${block.steps === 1 ? '' : 's'} away`
  let trail = ''
  if (chain.length === 1) trail = `paid ${chain[0]}`
  else if (chain.length > 1) trail = `pays ${chain[0]}` + chain.slice(1).map((a) => `, which paid ${a}`).join('')
  if (trail && block.path_address) trail += ' on the path'
  const parts = [
    `Exposed (${block.band} band): in the blast radius of ${block.scam_kind_name}, ${payments}` +
      (trail ? `: ${trail}` : ''),
  ]
  if (block.paid_once) {
    const paid = wordOf(dictionary, 'paid_once')?.plain ?? 'Paid once, may be a victim'
    parts.push(paid.charAt(0).toLowerCase() + paid.slice(1))
  }
  return parts.join('; ')
}

function blockOf(
  raw: unknown,
  index: number,
  dictionary: readonly AddressCardWord[],
  fault: (line: string) => void
): ExposedBlock | null {
  if (!isRecord(raw)) {
    fault(`block ${index} is not an object`)
    return null
  }
  const band = (EXPOSED_BANDS as readonly unknown[]).includes(raw.band) ? (raw.band as ExposedBand) : null
  const kind = textOf(raw.scam_kind)
  const steps = typeof raw.steps === 'number' && Number.isInteger(raw.steps) && raw.steps >= 0 ? raw.steps : null
  if (band === null || kind === null || steps === null) {
    fault(`block ${index} has no usable band, scam_kind or steps`)
    return null
  }
  const way = Array.isArray(raw.way) ? raw.way.filter((a): a is string => typeof a === 'string' && a !== '') : []
  const part = {
    band,
    scam_kind_name: kindNameOf(kind, dictionary),
    steps,
    way,
    path_address: textOf(raw.path_address),
    paid_once: raw.paid_once === true,
  }
  return {
    grade: EXPOSED_GRADE,
    band,
    band_plain: wordOf(dictionary, 'exposed_band', band)?.plain ?? null,
    scam_kind: kind,
    scam_kind_name: part.scam_kind_name,
    steps,
    path: textOf(raw.path),
    path_address: part.path_address,
    way,
    link_payments: typeof raw.link_payments === 'number' ? raw.link_payments : null,
    link_two_way: typeof raw.link_two_way === 'boolean' ? raw.link_two_way : null,
    day: textOf(raw.day),
    profile: textOf(raw.profile),
    paid_once: part.paid_once,
    text: exposedText(part, dictionary),
  }
}

/**
 * The blocks of a node's `exposed` property. Empty when the property is absent,
 * empty or malformed; a malformed value is logged, a block that cannot be read
 * is dropped and logged, and nothing throws.
 */
export function exposedOf(
  value: unknown,
  dictionary: readonly AddressCardWord[],
  log: (line: string) => void = defaultLog
): ExposedBlock[] {
  if (value === undefined || value === null || value === '') return []
  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      log('the exposed property is not JSON: nothing shown')
      return []
    }
  }
  if (!Array.isArray(parsed)) {
    log('the exposed property is not an array: nothing shown')
    return []
  }
  const blocks: ExposedBlock[] = []
  for (const [index, raw] of parsed.entries()) {
    const block = blockOf(raw, index, dictionary, (line) => log(line))
    if (block) blocks.push(block)
  }
  return blocks
}
