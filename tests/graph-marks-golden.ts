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
  since_block: number
  source: string
}

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
] as const

export const TOKEN_STANDARDS = ['ERC20', 'ERC721', 'ERC1155', 'ERC6909'] as const

export function readGolden(): GoldenFile {
  return JSON.parse(
    readFileSync(join(repoRoot, 'tests/fixtures/graph-marks-golden.json'), 'utf8')
  ) as GoldenFile
}

