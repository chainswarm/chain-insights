#!/usr/bin/env node
// Turns one plugin eval run into a scorecard.
//
//   claude plugin eval plugin -j 8 --json run.json
//   node scripts/eval-kpis.mjs run.json                      print the scorecard
//   node scripts/eval-kpis.mjs run.json --model opus-5.5 --record "0.83.0 baseline"
//                                                            and add its row to
//                                                            plugin/evals/SCORECARD.md
//
// The run file is the --json result of `claude plugin eval`. The numbers:
//
//   pass rate    runs in which every scored grader passed
//   score        the mean weighted share of passed graders
//   lift         score with the plugin minus score without it
//   by tag       the same, per `tags:` entry of the case files
//   by grader    how often each grader name passed, over every case that has it
//   deposit      cases tagged expect-*: a run is a true deposit, a missed
//                deposit (expect-deposit, wrong verdict) or a false deposit
//                (another class that ended on "VERDICT: deposit")

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export const SCORECARD_FILE = join('plugin', 'evals', 'SCORECARD.md')
export const SCORECARD_HEAD = [
  '# Eval scorecard',
  '',
  'One row per recorded run of the plugin eval suite. `node scripts/eval-kpis.mjs',
  '<run.json> --record "<note>"` adds a row; docs/evals.md says what each number',
  'means.',
  '',
  '| Date | Plugin | Model | Cases | Runs | Pass rate | Score | Lift | Deposit precision | Deposit recall | False deposits | Cost USD | Note |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  '',
].join('\n')

/** The `tags: [a, b]` line of a case file, as a list. */
export function tagsOfCaseText(text) {
  const match = /^tags:\s*\[([^\]]*)\]\s*$/m.exec(text)
  if (!match) return []
  return match[1]
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function mean(values) {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
}

function ratio(part, whole) {
  return whole === 0 ? null : part / whole
}

function group() {
  return { cases: new Set(), runs: [], without: [] }
}

function summary(entry) {
  return {
    cases: entry.cases.size,
    runs: entry.runs.length,
    passRate: ratio(entry.runs.filter((run) => run.passed).length, entry.runs.length),
    score: mean(entry.runs.map((run) => run.score)),
    scoreWithout: mean(entry.without.map((run) => run.score)),
    lift:
      entry.without.length === 0
        ? null
        : mean(entry.runs.map((run) => run.score)) - mean(entry.without.map((run) => run.score)),
  }
}

function graderPassed(run, name) {
  const grader = (run.graders ?? []).find((entry) => entry.name === name)
  return grader ? grader.passed === true : null
}

/**
 * The numbers of one run file.
 * `tagsByCase` maps a case name to its tags; a case with no entry has none.
 */
export function computeKpis(result, tagsByCase = new Map()) {
  const all = group()
  const byTag = new Map()
  const byGrader = new Map()
  const failing = []
  const deposit = { truePositive: 0, missed: 0, falseDeposit: 0, trueNegative: 0, classes: new Map() }
  let costUsd = 0
  let errors = 0
  const turns = []
  const seconds = []

  for (const testCase of result.cases ?? []) {
    const tags = tagsByCase.get(testCase.name) ?? []
    const runs = testCase.arms?.with ?? []
    const without = testCase.arms?.without ?? []
    const expect = tags.find((tag) => tag.startsWith('expect-'))?.slice('expect-'.length)
    const failedGraders = new Map()

    for (const entry of [all, ...tags.map((tag) => byTag.get(tag) ?? byTag.set(tag, group()).get(tag))]) {
      entry.cases.add(testCase.name)
      entry.runs.push(...runs)
      entry.without.push(...without)
    }
    for (const run of [...runs, ...without]) costUsd += (run.costUsd ?? 0) + (run.judgeCostUsd ?? 0)
    for (const run of runs) {
      if (run.error) errors += 1
      if (typeof run.turns === 'number') turns.push(run.turns)
      if (typeof run.durationSeconds === 'number') seconds.push(run.durationSeconds)
      for (const grader of run.graders ?? []) {
        const tally = byGrader.get(grader.name) ?? byGrader.set(grader.name, { runs: 0, passed: 0 }).get(grader.name)
        tally.runs += 1
        if (grader.passed) tally.passed += 1
        else if (grader.scored !== false) failedGraders.set(grader.name, (failedGraders.get(grader.name) ?? 0) + 1)
      }
      if (expect) {
        const right = graderPassed(run, 'verdict') === true
        const tally = deposit.classes.get(expect) ?? deposit.classes.set(expect, { runs: 0, right: 0 }).get(expect)
        tally.runs += 1
        if (right) tally.right += 1
        if (expect === 'deposit') {
          if (right) deposit.truePositive += 1
          else deposit.missed += 1
        } else if (graderPassed(run, 'no-false-deposit') === false) deposit.falseDeposit += 1
        else deposit.trueNegative += 1
      }
    }
    if (failedGraders.size > 0) {
      failing.push({
        name: testCase.name,
        runs: runs.length,
        failed: [...failedGraders].map(([name, count]) => ({ name, count })),
      })
    }
  }

  const classified = deposit.truePositive + deposit.missed + deposit.falseDeposit + deposit.trueNegative
  const rightVerdicts = [...deposit.classes.values()].reduce((sum, tally) => sum + tally.right, 0)
  return {
    plugin: result.suite?.plugins?.[0] ?? null,
    claudeVersion: result.claudeVersion ?? null,
    startedAt: result.startedAt ?? null,
    ablation: result.suite?.ablation ?? null,
    caseFilter: result.suite?.caseFilter ?? null,
    overall: summary(all),
    costUsd,
    errors,
    meanTurns: mean(turns),
    meanSeconds: mean(seconds),
    byTag: [...byTag].sort(([a], [b]) => a.localeCompare(b)).map(([tag, entry]) => ({ tag, ...summary(entry) })),
    byGrader: [...byGrader]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, tally]) => ({ name, runs: tally.runs, passRate: ratio(tally.passed, tally.runs) })),
    deposit:
      classified === 0
        ? null
        : {
            runs: classified,
            truePositive: deposit.truePositive,
            missed: deposit.missed,
            falseDeposit: deposit.falseDeposit,
            trueNegative: deposit.trueNegative,
            precision: ratio(deposit.truePositive, deposit.truePositive + deposit.falseDeposit),
            recall: ratio(deposit.truePositive, deposit.truePositive + deposit.missed),
            falseDepositRate: ratio(deposit.falseDeposit, deposit.falseDeposit + deposit.trueNegative),
            verdictAccuracy: ratio(rightVerdicts, classified),
            classes: [...deposit.classes]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([name, tally]) => ({ name, runs: tally.runs, right: tally.right })),
          },
    failing: failing.sort((a, b) => a.name.localeCompare(b.name)),
  }
}

function pct(value) {
  return value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(1)} %`
}

function num(value, digits = 2) {
  return value === null || value === undefined ? 'n/a' : value.toFixed(digits)
}

function signed(value) {
  return value === null || value === undefined ? 'n/a' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}`
}

/** The scorecard of one run, as Markdown. */
export function renderScorecard(kpis, { model = 'default' } = {}) {
  const plugin = kpis.plugin ? `${kpis.plugin.name} ${kpis.plugin.version}` : 'no plugin'
  const lines = [
    `# Eval scorecard: ${plugin}`,
    '',
    `Run of ${kpis.startedAt ?? 'unknown time'}, model ${model}, Claude Code ${kpis.claudeVersion ?? 'unknown'}${kpis.caseFilter ? `, cases \`${kpis.caseFilter}\`` : ''}.`,
    '',
    '## Overall',
    '',
    '| Cases | Runs | Pass rate | Score | Score without the plugin | Lift | Run errors | Mean turns | Mean seconds | Cost USD |',
    '|---|---|---|---|---|---|---|---|---|---|',
    `| ${kpis.overall.cases} | ${kpis.overall.runs} | ${pct(kpis.overall.passRate)} | ${num(kpis.overall.score)} | ${num(kpis.overall.scoreWithout)} | ${signed(kpis.overall.lift)} | ${kpis.errors} | ${num(kpis.meanTurns, 1)} | ${num(kpis.meanSeconds, 1)} | ${num(kpis.costUsd)} |`,
    '',
  ]
  if (kpis.deposit) {
    const d = kpis.deposit
    lines.push(
      '## Is it a deposit address',
      '',
      '| Runs | Right verdict | Deposit precision | Deposit recall | False deposits | Missed deposits |',
      '|---|---|---|---|---|---|',
      `| ${d.runs} | ${pct(d.verdictAccuracy)} | ${pct(d.precision)} | ${pct(d.recall)} | ${d.falseDeposit} (${pct(d.falseDepositRate)}) | ${d.missed} |`,
      '',
      '| Expected class | Runs | Right verdict |',
      '|---|---|---|',
      ...d.classes.map((entry) => `| ${entry.name} | ${entry.runs} | ${entry.right} (${pct(ratio(entry.right, entry.runs))}) |`),
      ''
    )
  }
  lines.push(
    '## By tag',
    '',
    '| Tag | Cases | Runs | Pass rate | Score | Without | Lift |',
    '|---|---|---|---|---|---|---|',
    ...kpis.byTag.map(
      (entry) =>
        `| ${entry.tag} | ${entry.cases} | ${entry.runs} | ${pct(entry.passRate)} | ${num(entry.score)} | ${num(entry.scoreWithout)} | ${signed(entry.lift)} |`
    ),
    '',
    '## By grader',
    '',
    '| Grader | Runs | Pass rate |',
    '|---|---|---|',
    ...kpis.byGrader.map((entry) => `| ${entry.name} | ${entry.runs} | ${pct(entry.passRate)} |`),
    ''
  )
  if (kpis.failing.length > 0) {
    lines.push(
      '## Cases with a failed grader',
      '',
      '| Case | Failed grader (runs failed of runs) |',
      '|---|---|',
      ...kpis.failing.map(
        (entry) =>
          `| ${entry.name} | ${entry.failed.map((failed) => `${failed.name} (${failed.count} of ${entry.runs})`).join(', ')} |`
      ),
      ''
    )
  }
  return lines.join('\n')
}

/** The row one run adds to the scorecard file. */
export function scorecardRow(kpis, { model = 'default', note = '' } = {}) {
  const d = kpis.deposit
  return `| ${(kpis.startedAt ?? '').slice(0, 10)} | ${kpis.plugin?.version ?? 'n/a'} | ${model} | ${kpis.overall.cases} | ${kpis.overall.runs} | ${pct(kpis.overall.passRate)} | ${num(kpis.overall.score)} | ${signed(kpis.overall.lift)} | ${pct(d?.precision)} | ${pct(d?.recall)} | ${d ? d.falseDeposit : 'n/a'} | ${num(kpis.costUsd)} | ${note.replace(/\|/g, '/')} |`
}

function readTags(result) {
  const tags = new Map()
  for (const testCase of result.cases ?? []) {
    const path = join(result.suite?.root ?? join(root, 'plugin'), testCase.dir ?? '', 'case.yaml')
    if (existsSync(path)) tags.set(testCase.name, tagsOfCaseText(readFileSync(path, 'utf8')))
  }
  return tags
}

function flag(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function main() {
  const file = process.argv[2]
  if (!file || file.startsWith('--')) {
    console.error('usage: node scripts/eval-kpis.mjs <run.json> [--model <name>] [--record "<note>"] [--out <file.md>]')
    process.exit(2)
  }
  const result = JSON.parse(readFileSync(file, 'utf8'))
  const kpis = computeKpis(result, readTags(result))
  const model = flag('--model') ?? 'default'
  const card = renderScorecard(kpis, { model })
  const out = flag('--out')
  if (out) writeFileSync(out, `${card}\n`)
  console.log(card)
  const note = flag('--record')
  if (note !== undefined) {
    const path = join(root, SCORECARD_FILE)
    if (!existsSync(path)) writeFileSync(path, SCORECARD_HEAD)
    const text = readFileSync(path, 'utf8').replace(/\n+$/, '\n')
    writeFileSync(path, text)
    appendFileSync(path, `${scorecardRow(kpis, { model, note })}\n`)
    console.error(`added a row to ${SCORECARD_FILE}`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
