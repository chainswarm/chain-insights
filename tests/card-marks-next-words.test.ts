import { describe, expect, it } from 'vitest'

import { cardMarksOf } from '../src/mcp/card-marks.js'
import { screenFromMembers } from '../src/mcp/deployer-screen.js'
import { addressSummary, buildAddressView, flowsRole } from '../src/mcp/flows.js'
import type { Member } from '../src/mcp/token-lookup.js'

// Nodes as the staging graph served them on 2026-11-27, read with graph_query
// (`labels(a)`, `properties(a)`), card_version 4. A card of the next words
// carries no is_scam and no is_sanctioned: it says is_malicious, categories
// and case_judgements, and the case type `sanctioned` names a sanctions
// listing. Only the fields the flows tools and the deployer screen read are
// kept. No server is reached.

type Node = { node_labels: string[]; properties: Record<string, unknown> }

const OFAC = '0x098b716b8aaf21512996dc57eb0615e2383e2f96'
const DEPLOYER = '0x01917b0c50898a56769e4f49c6fb08d24d543149'
const VICTIM = '0x792093f44d08d27989b4cbfaebacfffa2ea53897'
const COPIED_TOKEN = '0xd60e1de4eb0e14f49dc49c2579c07d4c69a1b46c'

const STAGING: Record<string, Node> = {
  [OFAC]: {
    node_labels: ['Address', 'Malicious'],
    properties: {
      address: OFAC,
      card_version: '4',
      case_judgements: ['malicious|sanctioned||list:data:ofac-sanctions'],
      categories: ['malicious'],
      evidence: ['malicious:Lazarus Group'],
      is_malicious: true,
      label_risk_labels: ['Lazarus Group', 'Malicious'],
      label_risk_levels: ['critical', 'critical'],
      labels: ['Lazarus Group', 'Malicious'],
      malicious_claims: ['Lazarus Group'],
      risk: 'critical',
      sources: ['registry'],
    },
  },
  [DEPLOYER]: {
    node_labels: ['Address', 'Account', 'Malicious'],
    properties: {
      address: DEPLOYER,
      card_version: '4',
      case_judgements: ['malicious|fake-token|deployer|', 'suspect|fake-token||'],
      categories: ['malicious'],
      degree_in: 1,
      degree_out: 2,
      evidence: ['malicious:FAKE_TOKEN_DEPLOYER'],
      first_activity_timestamp: 1785094076000,
      is_malicious: true,
      judgements: ['suspect:FAKE_TOKEN_LP'],
      label_risk_labels: ['Malicious'],
      label_risk_levels: ['critical'],
      labels: ['Malicious'],
      malicious_claims: ['FAKE_TOKEN_DEPLOYER'],
      suspect_labels: ['FAKE_TOKEN_LP'],
      total_in_usd: 17938.83933781,
      total_out_usd: 35091.5295739,
    },
  },
  [VICTIM]: {
    node_labels: ['Address', 'Account', 'Victim'],
    properties: {
      address: VICTIM,
      card_version: '4',
      case_judgements: ['victim|||'],
      categories: ['victim'],
      degree_in: 44,
      degree_out: 20,
      evidence: ['victim'],
      is_victim: true,
      label_risk_labels: ['Victim'],
      label_risk_levels: ['none'],
      labels: ['Victim'],
      victim_claims: ['VICTIM'],
    },
  },
  [COPIED_TOKEN]: {
    node_labels: ['Address', 'Contract', 'Token'],
    properties: {
      address: COPIED_TOKEN,
      card_version: '4',
      case_judgements: ['suspect|fake-token|fake_token|'],
      categories: ['suspect'],
      judgements: ['suspect:FAKE_TOKEN'],
    },
  },
}

/** A frozen card (card_version 2) that also carries the next words' fields: it keeps its flags. */
const OLD_SANCTIONED: Node = {
  node_labels: ['Address', 'Sanctioned', 'Malicious'],
  properties: {
    address: '0x5ce0000000000000000000000000000000000009',
    card_version: '2',
    is_sanctioned: true,
    is_malicious: true,
    categories: ['malicious'],
    case_judgements: ['malicious|sanctioned||'],
    label_risk_labels: ['Sanctioned', 'Malicious'],
    label_risk_levels: ['critical', 'critical'],
    labels: ['Sanctioned', 'Malicious'],
  },
}
const OLD_MALICIOUS_ONLY: Node = {
  node_labels: ['Address', 'Account', 'Malicious', 'OnMoneyTrail'],
  properties: {
    address: '0x5ce000000000000000000000000000000000000a',
    card_version: '2',
    is_malicious: true,
    categories: ['malicious'],
    case_judgements: ['malicious||mule|'],
    labels: ['Malicious', 'OnMoneyTrail'],
  },
}

/** The flows read of a node: its properties and b:Pool. */
const flowsRow = (node: Node) => ({ ...node.properties, is_exchange: false, pool: false })

const FLAGS = [
  'card_version',
  'is_sanctioned',
  'is_scam',
  'is_victim',
  'is_issuer_frozen',
  'is_malicious',
  'categories',
  'case_judgements',
  'label_risk_labels',
  'label_risk_levels',
] as const

/** One side of the deployer screen's wallet read, as the read names its columns. */
function side(prefix: 'launcher' | 'funder', node: Node): Record<string, unknown> {
  const row: Record<string, unknown> = { [`${prefix}_roles`]: node.node_labels }
  for (const flag of FLAGS) {
    const source =
      flag === 'label_risk_labels'
        ? 'risk_labels'
        : flag === 'label_risk_levels'
          ? 'risk_levels'
          : flag
    row[`${prefix}_${source}`] = node.properties[flag]
  }
  return row
}

const ok = (id: string, results: unknown[]): Member => ({ id, ok: true, results })

function screen(launcher: Node, funder: Node) {
  const row = {
    launcher: launcher.properties.address,
    ...side('launcher', launcher),
    funder: funder.properties.address,
    ...side('funder', funder),
  }
  const members = new Map<string, Member>([
    ['token', ok('token', [])],
    ['wallet', ok('wallet', [row])],
  ])
  const built = screenFromMembers('robinhood', launcher.properties.address as string, members)
  if ('failure' in built) throw new Error(built.failure)
  return built.result
}

describe('card marks of a card_version 4 node, as staging serves it', () => {
  it('the OFAC address is sanctioned in flows, not a plain wallet', () => {
    expect(flowsRole(flowsRow(STAGING[OFAC]!))).toBe('sanctioned')
    const view = buildAddressView('robinhood', OFAC, flowsRow(STAGING[OFAC]!))
    expect(view).toMatchObject({
      role: 'sanctioned',
      is_sanctioned: true,
      is_malicious: true,
      is_scam: false,
      labels: ['Lazarus Group'],
    })
    expect(addressSummary(view)).toContain(': sanctioned;')
  })

  it('a fake-token deployer is malicious in flows; its suspect case adds nothing', () => {
    expect(flowsRole(flowsRow(STAGING[DEPLOYER]!))).toBe('malicious')
    expect(cardMarksOf(STAGING[DEPLOYER]!.properties)).toMatchObject({
      next_words: true,
      sanctioned: false,
      malicious: true,
      victim: false,
    })
  })

  it('a victim is a victim, and a copied token name alone accuses nobody', () => {
    expect(flowsRole(flowsRow(STAGING[VICTIM]!))).toBe('victim')
    expect(flowsRole(flowsRow(STAGING[COPIED_TOKEN]!))).toBe('other')
  })

  it('a card of the frozen words keeps its flags: is_malicious alone is no role', () => {
    expect(flowsRole(flowsRow(OLD_SANCTIONED))).toBe('sanctioned')
    expect(flowsRole(flowsRow(OLD_MALICIOUS_ONLY))).toBe('other')
    expect(
      buildAddressView(
        'robinhood',
        OLD_MALICIOUS_ONLY.properties.address as string,
        flowsRow(OLD_MALICIOUS_ONLY)
      )
    ).toMatchObject({ role: 'other', is_malicious: false, is_scam: false })
  })

  it('the deployer screen names the sanctioned launcher and the malicious funder', () => {
    const result = screen(STAGING[OFAC]!, STAGING[DEPLOYER]!)
    expect(result.launcher!.crime).toEqual([
      { kind: 'sanctioned', value: 'Sanctioned', level: null },
      { kind: 'risk', value: 'Lazarus Group', level: 'critical' },
    ])
    expect(result.launcher!.roles).toEqual([])
    expect(result.first_funder!.kind).toBe('scam')
    expect(result.first_funder!.crime).toEqual([
      { kind: 'malicious', value: 'fake-token', level: null },
    ])
    expect(result.first_funder!.roles).toEqual(['Account'])
  })

  it('a sanctions listing alone keeps the funder its own kind, with the listing in its crime', () => {
    const result = screen(STAGING[DEPLOYER]!, STAGING[OFAC]!)
    expect(result.launcher!.crime).toEqual([
      { kind: 'malicious', value: 'fake-token', level: null },
    ])
    expect(result.first_funder!.kind).toBe('wallet')
    expect(result.first_funder!.crime).toEqual([
      { kind: 'sanctioned', value: 'Sanctioned', level: null },
      { kind: 'risk', value: 'Lazarus Group', level: 'critical' },
    ])
  })

  it('a victim launcher shows the victim, a copied token name shows no crime', () => {
    expect(screen(STAGING[VICTIM]!, STAGING[COPIED_TOKEN]!).launcher!.crime).toEqual([
      { kind: 'victim', value: 'Victim', level: null },
    ])
    const copied = screen(STAGING[COPIED_TOKEN]!, STAGING[VICTIM]!)
    expect(copied.launcher!.crime).toEqual([])
  })

  it('a frozen card on the deployer screen reads its flags and risk labels, as before', () => {
    const result = screen(OLD_SANCTIONED, OLD_MALICIOUS_ONLY)
    expect(result.launcher!.crime).toEqual([
      { kind: 'sanctioned', value: 'Sanctioned', level: null },
      { kind: 'risk', value: 'Sanctioned', level: 'critical' },
    ])
    expect(result.first_funder!.kind).toBe('wallet')
    expect(result.first_funder!.crime).toEqual([])
  })
})
