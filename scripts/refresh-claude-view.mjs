#!/usr/bin/env node
// Refresh src/mcp/apps/claude-view.html, the one HTML file the local MCP proxy
// serves as the MCP app resource ui://chain-insights/view.
//
//   node scripts/refresh-claude-view.mjs <full 40-character Chain Insights UI commit>
//
// The file is built in Chain Insights UI and never edited here. This script
// clones that repository into a temporary folder (CHAIN_INSIGHTS_UI_REPO
// overrides the source, for example a local clone), checks out the commit it
// is given, runs `npm ci` and `npm run build:claude-view`, and writes
// dist/claude-view.html here with a first line naming the commit. The proxy
// reads the file from the package at run time and fetches nothing.
//
// Needs git, node and npm, and read access to the Chain Insights UI source.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BUDGET_BYTES = 600 * 1024
const commit = process.argv[2] ?? ''
if (!/^[0-9a-f]{40}$/.test(commit)) {
  process.stderr.write(
    'usage: node scripts/refresh-claude-view.mjs <full 40-character Chain Insights UI commit>\n'
  )
  process.exit(2)
}

const here = dirname(fileURLToPath(import.meta.url))
const target = join(here, '..', 'src', 'mcp', 'apps', 'claude-view.html')
const source = process.env.CHAIN_INSIGHTS_UI_REPO
if (!source) {
  process.stderr.write('set CHAIN_INSIGHTS_UI_REPO to the Chain Insights UI repository (a git URL or a local clone)\n')
  process.exit(2)
}
const work = mkdtempSync(join(tmpdir(), 'claude-view-'))
const ui = join(work, 'ui')

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] })
}

try {
  run('git', ['clone', '--quiet', source, ui])
  run('git', ['-C', ui, 'checkout', '--quiet', commit])
  run('npm', ['ci', '--no-audit', '--no-fund'], ui)
  run('npm', ['run', 'build:claude-view'], ui)
  const built = join(ui, 'dist', 'claude-view.html')
  const size = statSync(built).size
  if (size >= BUDGET_BYTES) {
    process.stderr.write(`refused: ${built} is ${size} bytes, over the 400 KB budget\n`)
    process.exit(1)
  }
  const header = `<!-- Chain Insights UI ${commit} (npm run build:claude-view); refresh with scripts/refresh-claude-view.mjs, never edit by hand -->\n`
  writeFileSync(target, header + readFileSync(built, 'utf8'))
  process.stdout.write(
    `claude-view.html: ${statSync(target).size} bytes from Chain Insights UI ${commit}\n`
  )
} finally {
  rmSync(work, { recursive: true, force: true })
}
