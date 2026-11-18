import { describe, expect, it } from 'vitest'
import {
  computeKpis,
  renderScorecard,
  scorecardRow,
  tagsOfCaseText,
} from '../scripts/eval-kpis.mjs'

type Grader = { name: string; passed: boolean; scored?: boolean }

function run(score: number, graders: Grader[], costUsd = 0.1) {
  return {
    score,
    passed: score === 1,
    turns: 4,
    durationSeconds: 10,
    costUsd,
    judgeCostUsd: 0.01,
    error: null,
    graders,
  }
}

/** Three cases: a deposit told right twice and missed once, a hot wallet called a deposit once, an untagged case. */
const result = {
  claudeVersion: '2.1.327',
  startedAt: '2026-11-18T05:16:05.704Z',
  suite: { ablation: 'with-without', plugins: [{ name: 'chain-insights', version: '0.83.0' }] },
  cases: [
    {
      name: 'a-deposit',
      arms: {
        with: [
          run(1, [{ name: 'verdict', passed: true }]),
          run(1, [{ name: 'verdict', passed: true }]),
          run(0.5, [
            { name: 'verdict', passed: false },
            { name: 'skill-fired', passed: false, scored: false },
          ]),
        ],
        without: [run(0, [{ name: 'verdict', passed: false }], 0.05)],
      },
    },
    {
      name: 'a-hot-wallet',
      arms: {
        with: [
          run(1, [
            { name: 'verdict', passed: true },
            { name: 'no-false-deposit', passed: true },
          ]),
          run(0, [
            { name: 'verdict', passed: false },
            { name: 'no-false-deposit', passed: false },
          ]),
        ],
        without: [],
      },
    },
    { name: 'untagged', arms: { with: [run(1, [{ name: 'says-yes', passed: true }])] } },
  ],
}

const tags = new Map([
  ['a-deposit', ['aml-exchange', 'expect-deposit']],
  ['a-hot-wallet', ['aml-exchange', 'expect-exchange-wallet']],
])

describe('the eval scorecard (scripts/eval-kpis.mjs)', () => {
  it('reads the tags line of a case file, and none when the file has no such line', () => {
    expect(tagsOfCaseText('name: x\ntags: [dex, by-name, plan-only]\nruns: 3\n')).toEqual([
      'dex',
      'by-name',
      'plan-only',
    ])
    expect(tagsOfCaseText('name: x\nruns: 3\n')).toEqual([])
  })

  it('counts a run as a true deposit, a missed deposit or a false deposit', () => {
    const kpis = computeKpis(result, tags)
    expect(kpis.deposit).toMatchObject({
      runs: 5,
      truePositive: 2,
      missed: 1,
      falseDeposit: 1,
      trueNegative: 1,
    })
    // 2 true deposits of 3 calls of "deposit"; 2 of the 3 real deposits found.
    expect(kpis.deposit?.precision).toBeCloseTo(2 / 3)
    expect(kpis.deposit?.recall).toBeCloseTo(2 / 3)
    expect(kpis.deposit?.falseDepositRate).toBeCloseTo(1 / 2)
    expect(kpis.deposit?.verdictAccuracy).toBeCloseTo(3 / 5)
  })

  it('adds up every run once overall and once per tag, with the lift over the no-plugin runs', () => {
    const kpis = computeKpis(result, tags)
    expect(kpis.overall).toMatchObject({ cases: 3, runs: 6 })
    expect(kpis.overall.passRate).toBeCloseTo(4 / 6)
    const amlExchange = kpis.byTag.find((entry) => entry.tag === 'aml-exchange')
    expect(amlExchange).toMatchObject({ cases: 2, runs: 5 })
    const deposits = kpis.byTag.find((entry) => entry.tag === 'expect-deposit')
    // Score 2.5 of 3 with the plugin, 0 without it.
    expect(deposits?.lift).toBeCloseTo(2.5 / 3)
    // The hot wallet case ran no baseline arm: it has no lift to report.
    expect(kpis.byTag.find((entry) => entry.tag === 'expect-exchange-wallet')?.lift).toBeNull()
    // 6 plugin runs and 1 baseline run, each with its judge cost.
    expect(kpis.costUsd).toBeCloseTo(6 * 0.11 + 0.06)
  })

  it('lists a case under its failed scored graders only', () => {
    const kpis = computeKpis(result, tags)
    expect(kpis.failing).toEqual([
      { name: 'a-deposit', runs: 3, failed: [{ name: 'verdict', count: 1 }] },
      {
        name: 'a-hot-wallet',
        runs: 2,
        failed: [
          { name: 'verdict', count: 1 },
          { name: 'no-false-deposit', count: 1 },
        ],
      },
    ])
    const verdict = kpis.byGrader.find((entry) => entry.name === 'verdict')
    expect(verdict).toMatchObject({ runs: 5 })
    expect(verdict?.passRate).toBeCloseTo(3 / 5)
  })

  it('prints the scorecard and the one-line row of the run', () => {
    const kpis = computeKpis(result, tags)
    const card = renderScorecard(kpis, { model: 'opus-5.5' })
    expect(card).toContain('# Eval scorecard: chain-insights 0.83.0')
    expect(card).toContain('| 5 | 60.0 % | 66.7 % | 66.7 % | 1 (50.0 %) | 1 |')
    expect(card).toContain('| a-hot-wallet | verdict (1 of 2), no-false-deposit (1 of 2) |')
    expect(scorecardRow(kpis, { model: 'opus-5.5', note: 'first | run' })).toBe(
      '| 2026-11-18 | 0.83.0 | opus-5.5 | 3 | 6 | 66.7 % | 0.75 | +0.75 | 66.7 % | 66.7 % | 1 | 0.72 | first / run |'
    )
  })

  it('a run with no classified case has no deposit numbers', () => {
    const kpis = computeKpis({ cases: [result.cases[2]] }, new Map())
    expect(kpis.deposit).toBeNull()
    expect(renderScorecard(kpis)).not.toContain('Is it a deposit address')
  })
})
