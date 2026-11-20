import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The golden mark set and its reader, shared by the T1 fixture test and the
// live marks test. See tests/graph-marks-golden.test.ts.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export type GoldenMarkRow = {
  address: string
  name: string
  marks: string[]
  never: string[]
  /** Role words the node's `labels` property must carry (Basket, BasketFactory). Optional. */
  words?: string[]
  token_standard?: string
  /**
   * A subset of the address card the node must carry (registry/address-card.json).
   * A listed string property must be equal, a listed list property must contain
   * every listed entry; a property the row does not list is not judged.
   */
  card?: GoldenCard
  /**
   * `staging`: the row asserts a judgement label (Scam, Victim) or a card mark
   * (Deposit, HotWallet) that only the staging lane carries, so it is read only
   * when the live run names that lane.
   */
  lane_only?: 'staging'
  since_block: number
  source: string
}

export type GoldenCard = Record<string, string | string[]>

export type GoldenCountRow = { mark: string; floor: number; lane: string; read_at: string }

export type GoldenFile = {
  recorded_on: string
  network: string
  rows: GoldenMarkRow[]
  counts: GoldenCountRow[]
}

export const SERVED_MARKS = [
  'Address',
  'Account',
  'Contract',
  'SmartAccount',
  'Token',
  'NFT',
  'Pool',
  'Launchpad',
  'Mixer',
  'Protocol',
  'System',
  'SelfTrader',
] as const

export const TOKEN_STANDARDS = ['ERC20', 'ERC721', 'ERC1155', 'ERC6909'] as const

export function readGolden(): GoldenFile {
  return JSON.parse(
    readFileSync(join(repoRoot, 'tests/fixtures/graph-marks-golden.json'), 'utf8')
  ) as GoldenFile
}


/** The card problems of one node against a golden row's card: empty when the subset holds. */
export function cardProblems(card: GoldenCard, served: Record<string, unknown>): string[] {
  const problems: string[] = []
  for (const [property, wanted] of Object.entries(card)) {
    const value = served[property]
    if (Array.isArray(wanted)) {
      const list = Array.isArray(value) ? value.map(String) : []
      const missing = wanted.filter((entry) => !list.includes(entry))
      if (missing.length) {
        problems.push(`card ${property} misses ${missing.join(', ')}; served [${list.join(', ')}]`)
      }
    } else if (value !== wanted) {
      problems.push(`card ${property} ${JSON.stringify(value ?? null)} wanted ${wanted}`)
    }
  }
  return problems
}
