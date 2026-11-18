#!/usr/bin/env node
// Runs the plugin eval suite and prints its scorecard.
//
//   node scripts/run-evals.mjs                               every case
//   node scripts/run-evals.mjs --case 'aml-exchange-check-*' some cases
//   node scripts/run-evals.mjs --model <model> --runs 1      any `claude plugin eval` flag
//
// It runs `claude plugin eval plugin` with your own Claude login, keeps the
// report on this machine, writes the run to plugin/evals/results/latest.json
// and hands that file to scripts/eval-kpis.mjs. The exit code is the eval's:
// 1 when a case scored below the threshold.

import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const latest = join('plugin', 'evals', 'results', 'latest.json')
const passed = process.argv.slice(2)

mkdirSync(join(root, dirname(latest)), { recursive: true })
const run = spawnSync(
  'claude',
  ['plugin', 'eval', 'plugin', '-j', '8', '--no-publish', '--json', latest, ...passed],
  { cwd: root, stdio: 'inherit' }
)
if (run.error) {
  console.error(`could not start the Claude Code CLI: ${run.error.message}`)
  process.exit(1)
}

const model = passed[passed.indexOf('--model') + 1]
spawnSync(
  process.execPath,
  [join(root, 'scripts', 'eval-kpis.mjs'), latest, ...(passed.includes('--model') ? ['--model', model] : [])],
  { cwd: root, stdio: 'inherit' }
)
process.exit(run.status ?? 1)
