import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { coverageGaps, evalPrompt, readAdapters, repoRoot } from './dex-registry.js'

// Every adapter the DEX indexer reads (the pinned registry,
// tests/fixtures/dex-adapters.json) is covered: an exchange row of
// registry/robinhood.json names it, a trail-type skill serves that row's type,
// and a name-only eval asks for the exchange by name with no address. A launch
// adapter (v4-launch-factory-v1) has no exchange and no row on purpose: the
// launchpad trail skill names it and an eval asks for one of its factories. A
// new adapter with no exchange, an exchange of a type no skill serves, or an
// exchange nobody asks for by name is red here, and the failure names it.

describe('every adapter of the indexer registry is covered', () => {
  const { adapters } = readAdapters()

  it('reads the 16 adapters of the pinned registry', () => {
    expect(adapters.length).toBe(16)
  })

  for (const adapter of adapters) {
    it(`${adapter.id}: an exchange row, a trail-type skill and a name-only eval`, () => {
      expect(coverageGaps(adapter.id)).toEqual([])
    })
  }

  it('every exchange row names an adapter of the pinned registry', () => {
    expect(coverageGaps(null)).toEqual([])
  })
})

describe('the coverage rule names what is missing', () => {
  const copy = mkdtempSync(join(tmpdir(), 'dex-coverage-'))
  afterAll(() => rmSync(copy, { recursive: true, force: true }))
  for (const dir of ['tests/fixtures', 'registry', 'skills', 'plugin/evals']) {
    cpSync(join(repoRoot, dir), join(copy, dir), { recursive: true })
  }

  it('names the type when its skill is gone, and the exchange when its eval is gone', () => {
    rmSync(join(copy, 'skills/chain-insights-dex-vault'), { recursive: true })
    rmSync(join(copy, 'plugin/evals/dex-aero'), { recursive: true })
    expect(coverageGaps('uniswap-v4', copy)).toEqual(['no type skill: vault (uniswap-v4)'])
    expect(coverageGaps('cl-gauge-v1', copy)).toEqual(['no name-only eval: aero'])
  })

  it('holds a launch adapter to the launchpad skill and an eval, never to an exchange row', () => {
    rmSync(join(copy, 'plugin/evals/dex-v4-launch'), { recursive: true })
    expect(coverageGaps('v4-launch-factory-v1', copy)).toEqual(['no launch eval: v4-launch-factory-v1'])
    rmSync(join(copy, 'skills/chain-insights-dex-launchpad'), { recursive: true })
    expect(coverageGaps('v4-launch-factory-v1', copy)).toEqual([
      'no launchpad skill section: v4-launch-factory-v1',
      'no launch eval: v4-launch-factory-v1',
    ])
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
