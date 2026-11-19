#!/usr/bin/env node
// Writes one plugin eval case per row of the exchange deposit dataset.
//
//   node scripts/render-deposit-evals.mjs            write the cases
//   node scripts/render-deposit-evals.mjs --check    exit 1 when a case is stale
//
// The dataset (plugin/evals/datasets/aml-exchange-check.json) is the one place
// an address, its expected class and its question are written. A case is
// plugin/evals/aml-exchange-check-<id>/case.yaml. Every case asks the model to
// call aml_exchange_deposit_check for real (a stand-in replays the recorded
// answer) and to end on one VERDICT line, so a run counts as a classification:
// right, a false deposit, or a missed deposit.
//
// Grader names are the same in every case, because the scorecard
// (scripts/eval-kpis.mjs) adds them up by name:
//
//   check-called      the model called the tool with the address
//   verdict           the VERDICT line names the expected class
//   one-verdict       exactly one VERDICT line
//   no-false-deposit  a case that is no deposit never ends on "VERDICT: deposit"
//   reason-holds      the reason is what the graph shows, never an invented rule
//   profile-right     a described deposit profile matches the deposit rule
//   claim-corrected   a claim that names the wrong exchange is put right
//   full-addresses    no shortened address
//
// A row with `inferred_model` is an address the exchange model inferred, with
// no sourced mark: its recorded class is not-deposit, and it adds
//
//   says-inferred     the answer says inferred, predicted or a guess
//   names-the-model   the answer names the model version
//   names-no-exchange the answer names no exchange
//   not-confirmed     the answer never presents the guess as confirmed
//   writes-the-address the address is written in full

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export const DATASET_FILE = join('plugin', 'evals', 'datasets', 'aml-exchange-check.json')
export const EVALS_DIR = join('plugin', 'evals')
export const CASE_PREFIX = 'aml-exchange-check-'
export const DEPOSIT_CHECK_TOOL =
  'mcp__plugin_chain-insights_chain-insights__aml_exchange_deposit_check'
export const EXPECT_CLASSES = ['deposit', 'exchange-wallet', 'not-deposit', 'not-found']
export const ASK_STYLES = ['plain', 'claim', 'behaviour', 'mention', 'trail', 'owner', 'trail-end']
/** Exchanges a host may name: the tool description's list and the robinhood lookup file. An inferred answer names none. */
export const EXCHANGE_NAMES = [
  'Binance', 'Bitget', 'Bitrue', 'Bitunix', 'BloFin', 'Bybit', 'Coinbase', 'Gate', 'KuCoin', 'MEXC', 'OKX', 'Pionex',
]

const VERDICT_RULE = [
  'End your answer with one line, exactly one of these four:',
  'VERDICT: deposit',
  'VERDICT: exchange-wallet',
  'VERDICT: not-deposit',
  'VERDICT: not-found',
  '"deposit" is a customer\'s deposit address of an exchange. "exchange-wallet"',
  'is an exchange\'s own wallet, such as a hot wallet. "not-found" is an address',
  'with no activity on this network.',
]

const PROFILE =
  'it belongs to one customer, few outside addresses ever pay it, everything it sends goes to the wallets of one exchange (a sweep into a hot wallet), and it never trades on a DEX'

/** The question of one row, as lines. */
export function promptLines(row) {
  const a = row.address
  const claimed = row.claimed
  switch (row.ask) {
    case 'plain':
      return [`Is ${a} an exchange deposit`, 'address, on Robinhood Chain? Use Chain Insights.']
    case 'claim':
      return [
        `I was told ${a} is a ${claimed}`,
        'deposit wallet. Is that true, on Robinhood Chain? Use Chain Insights.',
      ]
    case 'behaviour':
      return [
        ...(claimed ? [`I was told ${a} is a ${claimed} deposit wallet.`] : []),
        `Does ${a} behave like an exchange`,
        'deposit address, on Robinhood Chain? Say what makes an address a deposit',
        'address and what rules one out. Use Chain Insights.',
      ]
    case 'mention':
      return [
        `@ChainInsightsHQ is ${a}`,
        `${claimed ? `a ${claimed}` : 'an exchange'} deposit wallet on Robinhood Chain? does it behave like one?`,
      ]
    case 'trail':
      return [
        `Where did the money that reached ${a}`,
        'go, on Robinhood Chain? Is that address an exchange deposit address? Use',
        'Chain Insights.',
      ]
    case 'owner':
      return [`Who does ${a} belong to,`, 'on Robinhood Chain? Is it a wallet of an exchange? Use Chain Insights.']
    case 'trail-end':
      return [
        'A trail I follow on Robinhood Chain ends at',
        `${a}. Did the money reach an`,
        'exchange there? Use Chain Insights.',
      ]
    default:
      throw new Error(`${row.id}: unknown ask "${row.ask}"`)
  }
}

/** "an exchange deposit" or "an exchange hot wallet", for an inferred row. */
function inferredWhat(row) {
  return row.inferred_role === 'hot_wallet' ? 'an exchange hot wallet' : 'an exchange deposit'
}

/** A regex that matches the address in any letter case. */
export function addressPattern(address) {
  return address
    .slice(2)
    .replace(/[a-fA-F]/g, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`)
    .replace(/^/, '0[xX]')
}

function expectedOutcome(row) {
  if (row.inferred_model) {
    return `The agent calls aml_exchange_deposit_check with the address, writes it in full, says it is ${inferredWhat(row)} inferred by model ${row.inferred_model} and that no listed source names it, names no exchange, never presents it as a confirmed exchange address, and ends on "VERDICT: ${row.expect}".`
  }
  const wallets = (row.hot_wallets ?? []).join(' and ')
  switch (row.expect) {
    case 'deposit':
      return `The agent calls aml_exchange_deposit_check with the address, says it is a deposit address of ${row.exchange}${row.claimed && row.claimed !== row.exchange ? `, not of ${row.claimed}` : ''}, names the hot wallet it was swept into in full (${wallets}), and ends on "VERDICT: deposit".`
    case 'exchange-wallet':
      return `The agent calls aml_exchange_deposit_check with the address, says it is a hot wallet of ${row.exchange} and not a deposit address, and ends on "VERDICT: exchange-wallet".`
    case 'not-deposit':
      return 'The agent calls aml_exchange_deposit_check with the address, says the graph shows no deposit mark and no sweep into an exchange hot wallet, invents no behaviour rule, and ends on "VERDICT: not-deposit".'
    case 'not-found':
      return `The agent calls aml_exchange_deposit_check with the address, says it has no activity on Robinhood Chain so the claim is not proven there, asks to check the address and the network, and ends on "VERDICT: not-found".`
    default:
      throw new Error(`${row.id}: unknown expect "${row.expect}"`)
  }
}

const REASON_CRITERIA =
  'PASS when the reason the answer gives for its verdict is something the tool reported about this address: its deposit mark or its role, its exchange label, its sweep into a hot wallet, the counts of its behaviour, or that it has no mark, no sweep or no activity. ' +
  'These are reported facts too, and PASS: that the address swapped on a DEX, or that it paid addresses that are no exchange wallets, and that a deposit address does not do that. ' +
  'Stating the general profile of a deposit address (one customer, few outside payers, everything sent goes to one exchange, no DEX swaps) is PASS as well. ' +
  'FAIL only when the answer rules this address in or out by a number it made up: that it has too few or too many payers, senders, transactions or sweeps, or too little or too much volume, to be a deposit address.'

/** The graders of one row, in order. */
export function gradersOf(row) {
  const graders = [
    {
      type: 'tool_used',
      name: 'check-called',
      tool: DEPOSIT_CHECK_TOOL,
      input_match: addressPattern(row.address),
    },
    {
      type: 'regex',
      name: 'verdict',
      weight: 3,
      target: 'last_message',
      // An inferred hot wallet may end on either line: the menu has no
      // "inferred" line, and not-confirmed judges how the answer words it.
      pattern: `VERDICT:[\\s\`*]*${
        row.inferred_role === 'hot_wallet' ? '(?:not-deposit|exchange-wallet)' : row.expect
      }\\b`,
      match: 'contains',
    },
    {
      type: 'regex',
      name: 'one-verdict',
      target: 'last_message',
      pattern: 'VERDICT:',
      match: 'count:1',
    },
  ]
  if (row.expect !== 'deposit') {
    graders.push({
      type: 'regex',
      name: 'no-false-deposit',
      weight: 3,
      target: 'last_message',
      pattern: 'VERDICT:[\\s`*]*deposit\\b',
      match: 'not_contains',
    })
  }
  if (row.exchange) {
    graders.push({
      type: 'regex',
      name: 'names-the-exchange',
      target: 'last_message',
      pattern: `\\b${row.exchange}\\b`,
      match: 'contains',
    })
  }
  ;(row.hot_wallets ?? []).forEach((wallet, index, all) => {
    graders.push({
      type: 'regex',
      name: all.length > 1 ? `names-the-hot-wallet-${index + 1}` : 'names-the-hot-wallet',
      target: 'last_message',
      pattern: wallet,
      flags: 'i',
      match: 'contains',
    })
  })
  if (row.expect === 'exchange-wallet') {
    graders.push({
      type: 'regex',
      name: 'says-hot-wallet',
      target: 'last_message',
      pattern: 'hot wallet',
      flags: 'i',
      match: 'contains',
    })
  }
  if (row.inferred_model) {
    graders.push(
      {
        type: 'regex',
        name: 'says-inferred',
        target: 'last_message',
        pattern: '\\b(?:inferred|infers?|predict(?:s|ed|ion)?|guess(?:es|ed)?)\\b',
        flags: 'i',
        match: 'contains',
      },
      {
        type: 'regex',
        name: 'names-the-model',
        target: 'last_message',
        pattern: row.inferred_model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        match: 'contains',
      },
      {
        type: 'regex',
        name: 'names-no-exchange',
        weight: 3,
        target: 'last_message',
        pattern: `\\b(${EXCHANGE_NAMES.join('|')})\\b`,
        match: 'not_contains',
      },
      {
        type: 'llm',
        name: 'not-confirmed',
        criteria: `PASS when the answer presents ${row.address} as ${inferredWhat(row)} that the exchange model ${row.inferred_model} inferred or predicted, and says no listed source confirms it. FAIL when it calls the address a confirmed, listed or proven exchange ${row.inferred_role === 'hot_wallet' ? 'hot wallet' : 'deposit address'}, states as a plain fact that it is one without saying the model inferred it, or names the exchange it belongs to.`,
      },
      {
        type: 'regex',
        name: 'writes-the-address',
        target: 'last_message',
        pattern: addressPattern(row.address),
        match: 'contains',
      }
    )
  }
  if (row.expect === 'not-found' || row.inferred_model) {
    graders.push({
      type: 'regex',
      name: 'never-says-unsupported',
      target: 'last_message',
      pattern:
        "unsupported (network|chain|exchange|feature|address)|(Chain Insights|the graph|the tool|the check|this check|we|I) ((is|are|does|do|did|has|have)n't|(is|are|does|do|did|has|have) not) (yet )?(support|cover|serve)(ed)?\\b",
      flags: 'i',
      match: 'not_contains',
    })
  }
  graders.push({ type: 'llm', name: 'reason-holds', criteria: REASON_CRITERIA })
  if (row.claimed && row.exchange && row.claimed !== row.exchange) {
    graders.push({
      type: 'llm',
      name: 'claim-corrected',
      criteria: `PASS when the answer says the address belongs to ${row.exchange} and not to ${row.claimed}, correcting the user. FAIL when it leaves the user's claim that it is a ${row.claimed} wallet standing.`,
    })
  }
  if (row.ask === 'behaviour') {
    graders.push({
      type: 'llm',
      name: 'profile-right',
      criteria: `PASS when the answer states how an exchange deposit address behaves and the statement agrees with this profile: ${PROFILE}. It need not name every point. Saying what is NOT a deposit address also agrees with the profile and is PASS: an address many outside addresses pay, an address that pays anyone but one exchange, a DEX trader, a pool, a hot wallet. FAIL only when the answer claims the opposite of the profile (that a deposit address itself is paid by many addresses, or needs many payers, a large volume or repeated sweeps), or when it states no behaviour of a deposit address at all.`,
    })
  }
  graders.push({
    type: 'regex',
    name: 'full-addresses',
    target: 'last_message',
    pattern: '0x[0-9a-fA-F]{2,10}(…|\\.\\.\\.)',
    match: 'not_contains',
  })
  graders.push({ type: 'tool_used', name: 'skill-fired', tool: 'Skill' })
  return graders
}

function quote(text) {
  return `'${String(text).replace(/'/g, "''")}'`
}

/** The case.yaml text of one row. */
export function renderCase(row) {
  if (!EXPECT_CLASSES.includes(row.expect)) throw new Error(`${row.id}: unknown expect "${row.expect}"`)
  if (!/^0x[0-9a-fA-F]{40}$/.test(row.address)) throw new Error(`${row.id}: bad address`)
  const lines = [
    '# Written by scripts/render-deposit-evals.mjs from',
    '# plugin/evals/datasets/aml-exchange-check.json. Edit the dataset, not this file.',
    'schema_version: "1.0"',
    `name: ${CASE_PREFIX}${row.id}`,
    `description: ${quote(row.note)}`,
    `tags: [aml-exchange, deposit-check, tool-call, expect-${row.expect}, ask-${row.ask}${row.inferred_model ? ', inferred' : ''}]`,
    `expected_outcome: ${quote(expectedOutcome(row))}`,
    'execution:',
    '  prompt: |',
    ...promptLines(row).map((line) => `    ${line}`),
    '',
    ...VERDICT_RULE.map((line) => `    ${line}`),
    '  max_turns: 12',
    '  allowed_tools: [Read, Glob, Grep, Skill]',
    'runs: 3',
    'graders:',
  ]
  for (const grader of gradersOf(row)) {
    const [first, ...rest] = Object.entries(grader)
    lines.push(`  - ${first[0]}: ${first[1]}`)
    for (const [key, value] of rest) {
      lines.push(`    ${key}: ${typeof value === 'number' ? value : quote(value)}`)
    }
  }
  return `${lines.join('\n')}\n`
}

/** Every case of the dataset: [relative path, text]. */
export function renderAll(dataset) {
  return dataset.rows.map((row) => [
    join(EVALS_DIR, `${CASE_PREFIX}${row.id}`, 'case.yaml'),
    renderCase(row),
  ])
}

/** What differs between the dataset and the case files on disk. */
export function caseDrift(base = root) {
  const dataset = JSON.parse(readFileSync(join(base, DATASET_FILE), 'utf8'))
  const wanted = new Map(renderAll(dataset))
  const drift = []
  for (const [path, text] of wanted) {
    const full = join(base, path)
    if (!existsSync(full)) drift.push(`${path}: missing`)
    else if (readFileSync(full, 'utf8') !== text) drift.push(`${path}: stale`)
  }
  for (const dir of readdirSync(join(base, EVALS_DIR))) {
    if (!dir.startsWith(CASE_PREFIX)) continue
    const path = join(EVALS_DIR, dir, 'case.yaml')
    if (!wanted.has(path)) drift.push(`${path}: no dataset row`)
  }
  return drift
}

function main() {
  if (process.argv.includes('--check')) {
    const drift = caseDrift()
    if (drift.length > 0) {
      console.error(drift.join('\n'))
      console.error('run node scripts/render-deposit-evals.mjs')
      process.exit(1)
    }
    console.log('the deposit eval cases are in step with the dataset')
    return
  }
  const dataset = JSON.parse(readFileSync(join(root, DATASET_FILE), 'utf8'))
  for (const dir of readdirSync(join(root, EVALS_DIR))) {
    if (dir.startsWith(CASE_PREFIX)) rmSync(join(root, EVALS_DIR, dir), { recursive: true })
  }
  for (const [path, text] of renderAll(dataset)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  console.log(`wrote ${dataset.rows.length} cases under ${EVALS_DIR}/${CASE_PREFIX}*`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
