import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { AddressCardDocument } from '../src/mcp/address-card.js'
import { addressRiskFromMembers, type AmlAddressRiskResult } from '../src/mcp/address-risk.js'
import { screenFromMembers, type AmlDeployerScreenResult } from '../src/mcp/deployer-screen.js'
import { depositCheckFromMembers } from '../src/mcp/exchange-deposit-check.js'
import { addressSummary, buildAddressView, buildFlowView, flowsRole, flowsSummary } from '../src/mcp/flows.js'
import type { Member } from '../src/mcp/token-lookup.js'
import { repoRoot } from './dex-registry.js'

// One answer, two graph forms. Each case holds an address node twice: as the
// graph serves it now (`today`), and as it serves it once the graph also writes
// the card categories and case_judgements, the mark Malicious, the flag
// is_malicious and the role word Malicious beside the same card entries of the
// frozen words (`next`). A card resolved with the next words themselves
// (card_version 4) is held by tests/address-risk-next-words.test.ts. The risk
// word, the reasons, the deployer screen and the flows role must not move. No
// server is reached: the rows are in tests/fixtures/label-words-both-forms.json.

type Form = Record<string, unknown>
type Expect = {
  risk_word: string
  flows_role: string
  rules_word?: string
  set_by?: string
  model_word?: string
  reasons?: Array<[string, string]>
}
type Case = { name: string; address: string; block_height: number; today: Form; next: Form; expect: Expect }
type Scenario = { name: string; today: Form; next: Form; expect: Expect }

const fixture = JSON.parse(
  readFileSync(join(repoRoot, 'tests', 'fixtures', 'label-words-both-forms.json'), 'utf8')
) as { network: string; cases: Case[]; scenarios: Scenario[] }

const dictionary = (
  JSON.parse(readFileSync(join(repoRoot, 'registry', 'address-card.json'), 'utf8')) as AddressCardDocument
).words

const SCENARIO_ADDRESS = '0x5ce0000000000000000000000000000000000001'
const FUNDED = '0x5ce0000000000000000000000000000000000002'

const ok = (id: string, results: unknown[]): Member => ({ id, ok: true, results })

/** The aml_address_risk answer of one form: the node read and two empty partner reads. */
function addressRisk(address: string, form: Form): AmlAddressRiskResult {
  const members = new Map<string, Member>([
    ['node', ok('node', [{ ...form }])],
    ['in', ok('in', [])],
    ['out', ok('out', [])],
  ])
  const built = addressRiskFromMembers(fixture.network, address, members, dictionary, [])
  if ('failure' in built) throw new Error(built.failure)
  return built.result
}

/** The wallet row of the deployer screen with the form as the launcher and as its first funder. */
function screenRow(address: string, form: Form): Record<string, unknown> {
  const side = (prefix: 'launcher' | 'funder') => ({
    [`${prefix}_roles`]: form.node_labels,
    [`${prefix}_is_sanctioned`]: form.is_sanctioned,
    [`${prefix}_is_scam`]: form.is_scam,
    [`${prefix}_is_victim`]: form.is_victim,
    [`${prefix}_risk_labels`]: form.label_risk_labels,
    [`${prefix}_risk_levels`]: form.label_risk_levels,
  })
  return { launcher: address, ...side('launcher'), funder: address, ...side('funder') }
}

function screen(address: string, form: Form): AmlDeployerScreenResult {
  const members = new Map<string, Member>([
    ['token', ok('token', [])],
    ['wallet', ok('wallet', [screenRow(address, form)])],
  ])
  const built = screenFromMembers(fixture.network, address, members)
  if ('failure' in built) throw new Error(built.failure)
  return built.result
}

/** The flows row of a partner: the flags and the node's `labels` list. */
const flowsRow = (form: Form) => ({
  is_exchange: false,
  is_sanctioned: form.is_sanctioned,
  is_scam: form.is_scam,
  is_victim: form.is_victim,
  pool: false,
  labels: form.labels,
})

const CENTRE = '0x5ce0000000000000000000000000000000000003'
const SEEN_MS = Date.UTC(2026, 10, 20)
const NOW = new Date(Date.UTC(2026, 10, 26))

/** The details line of the form's address. */
function detailsText(address: string, form: Form): string {
  return addressSummary(
    buildAddressView(fixture.network, address, {
      ...flowsRow(form),
      total_in_usd: 1200.5,
      total_out_usd: 300,
      degree_in: 4,
      degree_out: 2,
    })
  )
}

/** The flows view and text of a centre whose one sender is the form's address. */
function flowsAnswer(address: string, form: Form) {
  const view = buildFlowView(fixture.network, {
    center: { address: CENTRE, labels: [], is_exchange: false },
    senders: [
      {
        ...flowsRow(form),
        address,
        usd: 250,
        tx_count: 3,
        first_seen: SEEN_MS,
        last_seen: SEEN_MS,
        total_in_usd: 900,
        total_out_usd: 800,
        degree_in: 2,
        degree_out: 5,
      },
    ],
    receivers: [],
    inOffset: 0,
    outOffset: 0,
  })
  return { view, text: flowsSummary(view, NOW) }
}

/** The exchange deposit check of the form's address, with no sweep. */
function depositCheck(address: string, form: Form) {
  const members = new Map<string, Member>([
    ['node', ok('node', [{ address, node_labels: form.node_labels, labels: form.labels, exchange_role: null }])],
    ['swept', ok('swept', [])],
  ])
  const built = depositCheckFromMembers(fixture.network, address, members, [])
  if ('failure' in built) throw new Error(built.failure)
  return built.result
}

/** The answer without the three card fields, to compare with today's. */
function withoutCardClass(result: AmlAddressRiskResult): AmlAddressRiskResult {
  const { category: _c, type: _t, role: _r, ...rest } = result
  return rest
}

/** The category, type and role of a form's first case judgement; empty strings when it has none. */
function caseOf(form: Form): [string, string, string] {
  const first = (form.case_judgements as string[] | undefined)?.[0] ?? ''
  const [category = '', type = '', role = ''] = first.split('|')
  return [category, type, role]
}

const shownCategory = (category: unknown): string | undefined =>
  typeof category === 'string' && category !== ''
    ? category === 'suspect'
      ? 'pattern'
      : category
    : undefined

function assertBothForms(address: string, row: { today: Form; next: Form; expect: Expect }) {
  const today = addressRisk(address, row.today)
  const next = addressRisk(address, row.next)

  // Today's graph: none of the three fields.
  expect(today).not.toHaveProperty('category')
  expect(today).not.toHaveProperty('type')
  expect(today).not.toHaveProperty('role')
  // The next graph: every other field equals today's answer.
  expect(withoutCardClass(next)).toEqual(today)
  const [category, type, role] = caseOf(row.next)
  expect(next.category).toBe(shownCategory(category))
  expect(next.type).toBe(type === '' ? undefined : type)
  expect(next.role).toBe(role === '' ? undefined : role)

  expect(today.risk.word).toBe(row.expect.risk_word)
  if (row.expect.rules_word) expect(today.risk.rules_word).toBe(row.expect.rules_word)
  if (row.expect.set_by) expect(today.risk.set_by).toBe(row.expect.set_by)
  if (row.expect.model_word) expect(today.risk.model_word).toBe(row.expect.model_word)
  if (row.expect.reasons) {
    expect(today.risk.reasons.map((reason) => [reason.word, reason.value])).toEqual(row.expect.reasons)
  }

  const screenToday = screen(address, row.today)
  const screenNext = screen(address, row.next)
  expect(screenNext.launcher).toEqual(screenToday.launcher)
  expect(screenNext.first_funder).toEqual(screenToday.first_funder)
  expect(screenNext.hint).toBe(screenToday.hint)
  expect(screenNext.launcher!.roles).not.toContain('Malicious')
  expect(screenNext.launcher!.crime.map((crime) => crime.value)).not.toContain('Malicious')

  expect(flowsRole(flowsRow(row.today))).toBe(row.expect.flows_role)
  expect(flowsRole(flowsRow(row.next))).toBe(row.expect.flows_role)

  // The labels the flows, details and deposit answers show, and their text.
  expect(detailsText(address, row.next)).toBe(detailsText(address, row.today))
  const flowsToday = flowsAnswer(address, row.today)
  const flowsNext = flowsAnswer(address, row.next)
  expect(flowsNext.view).toEqual(flowsToday.view)
  expect(flowsNext.text).toBe(flowsToday.text)
  expect(flowsNext.text).not.toContain('Malicious')
  const depositToday = depositCheck(address, row.today)
  const depositNext = depositCheck(address, row.next)
  expect(depositNext).toEqual(depositToday)
  expect(depositNext.labels).not.toContain('Malicious')
}

describe('label words: both graph forms give one answer', () => {
  it('every case is a full lowercase address pinned at a block height', () => {
    expect(fixture.cases.length).toBeGreaterThan(0)
    for (const row of fixture.cases) {
      expect(row.address).toMatch(/^0x[0-9a-f]{40}$/)
      expect(Number.isInteger(row.block_height) && row.block_height > 0).toBe(true)
    }
  })

  for (const row of fixture.cases) {
    it(`${row.name}: the same word, reasons, screen and flows role`, () => {
      assertBothForms(row.address, row)
    })
  }

  for (const row of fixture.scenarios) {
    it(`${row.name}: the same word, reasons, screen and flows role`, () => {
      assertBothForms(SCENARIO_ADDRESS, row)
    })
  }

  it('a copied token name alone sets no word and gives the reason of its own card entry', () => {
    const row = fixture.cases.find((c) => {
      const [category, , role] = caseOf(c.next)
      return category === 'suspect' && role === 'fake_token'
    })!
    const next = addressRisk(row.address, row.next)
    const entry = dictionary.find((item) => item.word === 'suspect' && item.value === 'FAKE_TOKEN')!
    expect(next.category).toBe('pattern')
    expect(next.risk.rules_word).toBe('none')
    expect(next.risk.reasons).toEqual([
      { word: 'pattern', value: 'FAKE_TOKEN', question: 'judgement', level: 'none', plain: entry.plain },
    ])
  })

  it('a funder that carries only the new mark and flag is a plain wallet, as before', () => {
    const plain: Form = {
      node_labels: ['Address', 'Account'],
      is_sanctioned: false,
      is_scam: false,
      is_victim: false,
      label_risk_labels: [],
      label_risk_levels: [],
    }
    const marked: Form = {
      ...plain,
      node_labels: ['Address', 'Account', 'Malicious', 'OnMoneyTrail'],
      labels: ['Malicious', 'OnMoneyTrail'],
      is_malicious: true,
      label_risk_labels: ['Malicious'],
      label_risk_levels: ['critical'],
    }
    const before = screen(FUNDED, plain).first_funder!
    const after = screen(FUNDED, marked).first_funder!
    expect(after.kind).toBe(before.kind)
    expect(after.kind).toBe('wallet')
    expect(after.crime).toEqual(before.crime)
    expect(after.roles).toEqual(['Account', 'OnMoneyTrail'])
    expect(flowsRole(flowsRow(marked))).toBe('other')
  })
})
