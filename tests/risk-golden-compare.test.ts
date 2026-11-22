import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MIN,
  compareCase,
  dataProblem,
  resultLine,
  rowsLine,
  valuesOf,
} from '../scripts/risk-golden-compare.mjs'
import { repoRoot } from './dex-registry.js'

// The pure part of scripts/risk-golden.mjs: answers written here in the shape
// the risk tools return, no read and no network.

const FOUNDER = '0xd8ab093fd32dee6566e300e62fbb200014f589e6'

const addressAnswer = {
  kind: 'account',
  risk: {
    word: 'high',
    set_by: 'both',
    rules_word: 'high',
    model_word: 'low',
    score: 0.12,
    reasons: [{ word: 'scam' }, { word: 'pattern' }, { word: 'model' }],
  },
}

const tokenAnswer = {
  asked_as: 'token',
  risk: {
    word: 'critical',
    set_by: 'rules',
    raised_by: 'founder',
    own: { rules_word: 'none', model_word: 'not_scored', score: null, reasons: [{ word: 'launchpad' }] },
  },
  founder: { address: FOUNDER },
  factory: { name: 'Virtuals Protocol' },
  pools_found: 3,
  pools: [{ is_manager: false, providers: 2 }],
}

describe('the golden compare', () => {
  it('compares only the expect keys present: equal, every reason listed, at least for *_min', () => {
    const cases: Array<[string, 'address' | 'pool' | 'token', Record<string, unknown>, unknown, boolean, string[]]> = [
      ['no expect key passes', 'address', {}, addressAnswer, true, []],
      ['every key equal', 'address', { word: 'high', set_by: 'both', rules_word: 'high', model_word: 'low', kind: 'account' }, addressAnswer, true, []],
      ['reasons: a subset passes', 'address', { reasons: ['scam'] }, addressAnswer, true, []],
      ['reasons: a missing word fails', 'address', { reasons: ['scam', 'mixer'] }, addressAnswer, false, ['reasons']],
      ['a different word fails', 'address', { word: 'low' }, addressAnswer, false, ['word']],
      ['raised_by null against founder fails', 'token', { raised_by: null }, tokenAnswer, false, ['raised_by']],
      [
        'token: founder, factory, pools_found_min at the bound',
        'token',
        { asked_as: 'token', founder: FOUNDER, factory_name: 'Virtuals Protocol', pools_found_min: 3 },
        tokenAnswer,
        true,
        [],
      ],
      ['pools_found_min above fails', 'token', { pools_found_min: 4 }, tokenAnswer, false, ['pools_found_min']],
      ['pools_found exact passes', 'token', { pools_found: 3 }, tokenAnswer, true, []],
      ['pools_found exact off by one fails', 'token', { pools_found: 4 }, tokenAnswer, false, ['pools_found']],
      ['pool: is_manager and providers_min', 'pool', { is_manager: false, providers_min: 1 }, tokenAnswer, true, []],
      ['pool with no pool row fails providers_min', 'pool', { providers_min: 1 }, { ...tokenAnswer, pools: [] }, false, ['providers_min']],
      ['an unknown key fails', 'address', { founder: FOUNDER }, addressAnswer, false, ['founder']],
      ['no answer fails', 'token', { word: 'low' }, null, false, ['word']],
    ]
    for (const [name, kind, expected, answer, ok, keys] of cases) {
      const result = compareCase(kind, expected, answer as Record<string, unknown>)
      expect(result.ok, name).toBe(ok)
      expect(result.mismatches.map((mismatch) => mismatch.key), name).toEqual(keys)
    }
  })

  it('writes the result line and the rows read', () => {
    const values = valuesOf('token', tokenAnswer)
    expect(resultLine('0xabc', { ok: true, mismatches: [] }, values, 12)).toBe('ok 0xabc word=critical expected=- ms=12')
    expect(resultLine('0xabc', { ok: true, mismatches: [] }, values, 12, { word: 'critical', set_by: 'rules' })).toBe(
      'ok 0xabc word=critical expected=critical ms=12'
    )
    expect(
      resultLine('0xabc', { ok: true, mismatches: [] }, values, 4, { asked_as: 'pool', is_manager: true })
    ).toBe('ok 0xabc word=critical expected={asked_as:pool,is_manager:true} ms=4')
    // A wrong expected word fails the compare, and the line names it.
    const wrong = compareCase('token', { word: 'low' }, tokenAnswer)
    expect(wrong).toEqual({ ok: false, mismatches: [{ key: 'word', got: 'critical', expected: 'low' }] })
    expect(resultLine('0xabc', wrong, values, 3, { word: 'low' })).toBe(
      'FAIL 0xabc word=critical expected=low ms=3 failed=word:"critical"'
    )
    expect(rowsLine('token', values)).toBe(
      `  card=none reasons=launchpad model=not_scored score=null asked_as=token founder=${FOUNDER} factory=Virtuals Protocol pools_found=3`
    )
    expect(rowsLine('address', valuesOf('address', addressAnswer))).toBe(
      '  card=high reasons=scam|pattern|model model=low score=0.12 kind=account'
    )
  })

  it('the shipped data file is valid for every kind, and the default minimums stand', () => {
    const data = JSON.parse(readFileSync(join(repoRoot, 'scripts', 'risk-golden.json'), 'utf8'))
    for (const kind of ['address', 'pool', 'token']) expect(dataProblem(data, kind), kind).toBeNull()
    expect(dataProblem(data, 'wallet')).toMatch(/kind must be one of/)
    expect(dataProblem({ ...data, token: [{ address: '0xABC' }] }, 'token')).toMatch(/not a lowercase 0x address/)
    expect(dataProblem({ ...data, pool: [{ address: FOUNDER, expect: { founder: FOUNDER } }] }, 'pool')).toMatch(
      /expect key founder/
    )
    expect(DEFAULT_MIN).toEqual({ address: 20, pool: 10, token: 20 })
  })
})
