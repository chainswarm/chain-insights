/**
 * The plugin eval suite holds together (plugin/evals):
 *
 *   - every case has a name equal to its folder, a skill tag and one style tag,
 *     so the scorecard can add the cases up;
 *   - a case that calls a tool for real names only tools that have a stand-in;
 *   - the stand-ins show the model the proxy's own tool descriptions;
 *   - the exchange deposit cases are the dataset's rows, and each row expects
 *     what its recorded tool answer says, the exchange model's guess included.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tagsOfCaseText } from '../scripts/eval-kpis.mjs'
import { EVAL_TOOLS_FILE, mockedToolNames } from '../scripts/pin-eval-tools.mjs'
import { addressSpellings, FIXTURES_DIR } from '../scripts/record-eval-fixtures.mjs'
import {
  ASK_STYLES,
  caseDrift,
  DATASET_FILE,
  EXPECT_CLASSES,
} from '../scripts/render-deposit-evals.mjs'
import { AML_EXCHANGE_DEPOSIT_CHECK_DESCRIPTION } from '../src/mcp/exchange-deposit-check.js'

const root = process.cwd()
const evals = join(root, 'plugin', 'evals')

const SKILL_TAGS = ['aml-exchange', 'cypher', 'dex', 'virtuals']
/** plan-only: writes the calls it would send. pasted-answer: the answer is in the prompt. tool-call: calls the tool. */
const STYLE_TAGS = ['plan-only', 'pasted-answer', 'tool-call']

/** The description the proxy registers each mocked tool with. A new stand-in adds its source here. */
const DESCRIPTIONS: Record<string, string> = {
  aml_exchange_deposit_check: AML_EXCHANGE_DEPOSIT_CHECK_DESCRIPTION,
}

const cases = readdirSync(evals)
  .filter((dir) => existsSync(join(evals, dir, 'case.yaml')))
  .map((dir) => ({ dir, text: readFileSync(join(evals, dir, 'case.yaml'), 'utf8') }))

type Row = {
  id: string
  expect: string
  ask: string
  address: string
  exchange?: string
  hot_wallets?: string[]
  inferred_role?: string
  inferred_model?: string
}
type CheckAnswer = {
  found: boolean
  is_deposit: boolean
  cex_role: string | null
  exchange_display: string | null
  swept: { hot_wallet: string }[]
  inferred?: true
  inferred_role?: string
  inferred_model?: string
}

const dataset = JSON.parse(readFileSync(join(root, DATASET_FILE), 'utf8')) as {
  rows: Row[]
  also_record?: string[]
}

function classOf(answer: CheckAnswer): string {
  if (!answer.found) return 'not-found'
  if (answer.is_deposit) return 'deposit'
  return answer.cex_role ? 'exchange-wallet' : 'not-deposit'
}

describe('the plugin eval suite (plugin/evals)', () => {
  it('names every case after its folder and tags it with a skill and one style', () => {
    expect(cases.length).toBeGreaterThan(0)
    const problems: string[] = []
    for (const { dir, text } of cases) {
      const name = /^name:\s*(\S+)\s*$/m.exec(text)?.[1]
      if (name !== dir) problems.push(`${dir}: name is ${name}`)
      const tags = tagsOfCaseText(text)
      if (!SKILL_TAGS.includes(tags[0] ?? '')) problems.push(`${dir}: first tag is no skill tag`)
      if (tags.filter((tag) => STYLE_TAGS.includes(tag)).length !== 1) {
        problems.push(`${dir}: needs exactly one of ${STYLE_TAGS.join(', ')}`)
      }
    }
    expect(problems).toEqual([])
  })

  it('a case calls for real only the tools that have a stand-in', () => {
    const mocked = mockedToolNames(root)
    const problems: string[] = []
    for (const { dir, text } of cases) {
      const called = [...text.matchAll(/mcp__plugin_chain-insights_chain-insights__(\w+)/g)].map(
        (match) => match[1] as string
      )
      const style = tagsOfCaseText(text).find((tag) => STYLE_TAGS.includes(tag))
      for (const tool of called) {
        if (!mocked.includes(tool)) problems.push(`${dir}: ${tool} has no stand-in`)
      }
      if (called.length > 0 && style !== 'tool-call') problems.push(`${dir}: calls a tool, tag it tool-call`)
    }
    expect(problems).toEqual([])
  })

  it('the stand-ins show the model the description the proxy registers', () => {
    const pinned = JSON.parse(readFileSync(join(root, EVAL_TOOLS_FILE), 'utf8')) as {
      tools: { name: string; description: string }[]
    }
    const mocked = mockedToolNames(root)
    expect(pinned.tools.map((tool) => tool.name)).toEqual(mocked)
    for (const tool of pinned.tools) {
      // Stale? Run `npm run build && node scripts/pin-eval-tools.mjs`.
      expect(tool.description, tool.name).toBe(DESCRIPTIONS[tool.name])
    }
  })

  it('the exchange deposit cases are the rows of the dataset', () => {
    expect(caseDrift(root)).toEqual([])
  })

  it('every dataset row expects what its recorded tool answer says', () => {
    const problems: string[] = []
    // One address may be asked several ways, each way once.
    const questions = new Set<string>()
    for (const row of dataset.rows) {
      if (!ASK_STYLES.includes(row.ask)) problems.push(`${row.id}: unknown ask ${row.ask}`)
      questions.add(`${row.address.toLowerCase()} ${row.ask}`)
      const path = join(root, FIXTURES_DIR, 'deposit-check', `${row.address.toLowerCase()}.json`)
      if (!existsSync(path)) {
        problems.push(`${row.id}: no recorded answer`)
        continue
      }
      const answer = JSON.parse(readFileSync(path, 'utf8')) as CheckAnswer
      if (classOf(answer) !== row.expect) problems.push(`${row.id}: recorded ${classOf(answer)}`)
      if ((answer.exchange_display ?? undefined) !== row.exchange) {
        problems.push(`${row.id}: recorded exchange ${answer.exchange_display}`)
      }
      const swept = answer.swept.map((sweep) => sweep.hot_wallet)
      if (JSON.stringify(swept) !== JSON.stringify(row.hot_wallets ?? [])) {
        problems.push(`${row.id}: recorded hot wallets ${swept.join(', ')}`)
      }
      // A row of an inferred address names the model's role and version as recorded; any other row none.
      if ((answer.inferred_role ?? undefined) !== row.inferred_role) {
        problems.push(`${row.id}: recorded inferred_role ${answer.inferred_role}`)
      }
      if ((answer.inferred_model ?? undefined) !== row.inferred_model) {
        problems.push(`${row.id}: recorded inferred_model ${answer.inferred_model}`)
      }
      if (row.inferred_model && answer.inferred !== true) problems.push(`${row.id}: recorded no inferred`)
    }
    expect(problems).toEqual([])
    expect(questions.size).toBe(dataset.rows.length)
    // The inferred answers keep a column of the scorecard too.
    expect(dataset.rows.some((row) => row.inferred_model)).toBe(true)
    // A class with no row would leave its column of the scorecard empty.
    expect(new Set(dataset.rows.map((row) => row.expect))).toEqual(new Set(EXPECT_CLASSES))
  })

  it('every address a case may send has a recorded answer, in each spelling', () => {
    const missing: string[] = []
    const addresses = [...dataset.rows.map((row) => row.address), ...(dataset.also_record ?? [])]
    for (const address of addresses) {
      for (const spelling of addressSpellings(address)) {
        const path = join(FIXTURES_DIR, 'deposit-check', `${spelling}.json`)
        if (!existsSync(join(root, path))) missing.push(path)
      }
    }
    expect(missing).toEqual([])
  })
})
