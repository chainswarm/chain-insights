import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { coverageGaps, evalPrompt, readAdapters, repoRoot } from './dex-brands.js'

// Every adapter the DEX indexer reads (the pinned registry,
// tests/fixtures/dex-adapters.json) is covered: a brand row names it, a
// trail-type skill serves that row's type, and a name-only eval asks for the
// brand by name with no address. A new adapter with no brand, a brand of a
// type no skill serves, or a brand nobody asks for by name is red here, and
// the failure names it.

describe('every adapter of the indexer registry is covered', () => {
  const { adapters } = readAdapters()

  it('reads the 13 adapters of the pinned registry', () => {
    expect(adapters.length).toBe(13)
  })

  for (const adapter of adapters) {
    it(`${adapter.id}: a brand row, a trail-type skill and a name-only eval`, () => {
      expect(coverageGaps(adapter.id)).toEqual([])
    })
  }

  it('every brand row names an adapter of the pinned registry', () => {
    expect(coverageGaps(null)).toEqual([])
  })
})

describe('the coverage rule names what is missing', () => {
  const copy = mkdtempSync(join(tmpdir(), 'dex-coverage-'))
  afterAll(() => rmSync(copy, { recursive: true, force: true }))
  for (const dir of ['tests/fixtures', 'skills', 'plugin/evals']) {
    cpSync(join(repoRoot, dir), join(copy, dir), { recursive: true })
  }

  it('names the type when its skill is gone, and the brand when its eval is gone', () => {
    rmSync(join(copy, 'skills/chain-insights-dex-vault'), { recursive: true })
    rmSync(join(copy, 'plugin/evals/dex-aero'), { recursive: true })
    expect(coverageGaps('uniswap-v4', copy)).toEqual(['no type skill: vault (uniswap-v4)'])
    expect(coverageGaps('cl-gauge-v1', copy)).toEqual(['no name-only eval: aero'])
  })

  it('reads the prompt of an eval case, block or one line', () => {
    expect(
      evalPrompt(
        'execution:\n  prompt: |\n    Who trades on Aero?\n    Answer briefly.\n  max_turns: 4\n'
      )
    ).toBe('Who trades on Aero?\nAnswer briefly.')
    expect(evalPrompt('execution:\n  prompt: "Who trades on Curve?"\n')).toBe(
      'Who trades on Curve?'
    )
    expect(evalPrompt('execution:\n  max_turns: 4\n')).toBeNull()
  })
})
