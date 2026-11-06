/**
 * aml_deployer_screen: who is behind a token or a wallet, as facts.
 *
 * A local tool of the proxy. It sends one graph_query_batch with two reads on
 * USE topology, both anchored on the address:
 *
 *   token   the address as a contract: its first creation (DEPLOYED_CONTRACT),
 *           the launcher (the transaction's sender), the launcher's first funder
 *           of all time and its first inbound bridge deposit;
 *   wallet  the address as the launcher itself: the same funder and bridge reads.
 *
 * The token read answers first when it holds a row; the wallet read answers
 * otherwise. The tool returns facts and never a score, a level or a verdict:
 * the description below is the contract with every host, Claude Desktop chat
 * included, which reads no skill.
 */

import { ANSWER_HINT } from './answer-hint.js'
import { DexRegistryError, normalizeDexNetwork } from './dex-registry.js'
import { isEpochMs, utcText } from './timestamp-text.js'
import {
  membersOf,
  refusalOf,
  type GraphAnswer,
  type Member,
  type TokenToolDependencies,
} from './token-lookup.js'

export const AML_DEPLOYER_SCREEN_TOOL = 'aml_deployer_screen' as const
export const AML_DEPLOYER_SCREEN_SCHEMA = 'chain-insights.aml-deployer-screen.v1' as const
export const AML_DEPLOYER_SCREEN_TITLE = 'Deployer screen'
export const AML_DEPLOYER_SCREEN_DESCRIPTION =
  'Facts only, no score and no verdict: screens who is behind a token or a wallet. ' +
  'For a token contract it returns the creation transaction and the launcher (the wallet that sent it); ' +
  'for a wallet, that wallet as the launcher. Then the launcher\'s first funder of all time and what kind of ' +
  'wallet that funder is (wallet, contract, bridge, bundler, launchpad, exchange, mixer, scam), how many addresses the ' +
  'funder ever paid, the sanctions, scam, victim and risk labels on each, and the first inbound bridge deposit. ' +
  'The caller decides. A fresh launcher funded by a wallet that paid few addresses is the pattern to look at; ' +
  'a funder that paid thousands is shared infrastructure. A launcher that is a bundler hides the real sender: ' +
  'launcher_resolved is then false. not_covered lists what the graph cannot see yet.'
export const AML_DEPLOYER_SCREEN_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const
export const AML_DEPLOYER_SCREEN_ARGS = ['network', 'address'] as const

/** What the two reads cannot see yet, named in every answer. */
export const NOT_COVERED = ['exploit_labels', 'ml_labels', 'bridge_sender', 'ethereum_history'] as const

export type CrimeKind = 'sanctioned' | 'scam' | 'victim' | 'issuer_frozen' | 'risk'
export interface Crime {
  kind: CrimeKind
  value: string
  level: string | null
}

export interface Party {
  address: string
  roles: string[]
  crime: Crime[]
  first_activity: number | null
  first_activity_utc: string | null
  degree_in: number | null
  degree_out: number | null
}

export type FunderKind = 'scam' | 'mixer' | 'exchange' | 'bridge' | 'bundler' | 'launchpad' | 'contract' | 'wallet'

export interface Funder {
  address: string
  kind: FunderKind
  roles: string[]
  crime: Crime[]
  degree_out: number | null
  first_activity: number | null
  first_activity_utc: string | null
  funded_at: number | null
  funded_at_utc: string | null
  funding_tx_count: number | null
  funding_usd: number | null
}

export interface Creation {
  tx: string | null
  block: number | null
  time: number | null
  time_utc: string | null
  deployer: string | null
  factory: string | null
  mode: 'direct' | 'factory'
}

export interface BridgedIn {
  chain: string | null
  bridge: string | null
  kind: string | null
  asset: string | null
  first_block: number | null
}

export interface AmlDeployerScreenResult {
  schema: typeof AML_DEPLOYER_SCREEN_SCHEMA
  tool: typeof AML_DEPLOYER_SCREEN_TOOL
  network: string
  input: string
  /** false when the graph holds no node for the address: every fact below is then null. */
  found: boolean
  input_kind: 'token' | 'wallet' | null
  token: { address: string; roles: string[] } | null
  creation: Creation | null
  launcher: Party | null
  launcher_resolved: boolean | null
  first_funder: Funder | null
  bridged_in: BridgedIn | null
  not_covered: string[]
  hint: string
}

export type DeployerScreenDependencies = Pick<
  TokenToolDependencies,
  'graphQueryBatch' | 'unavailable' | 'describeFailure'
>

export type AmlDeployerScreenToolResult = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError: boolean
}

// The only address form ever written into a read: 0x and 40 lowercase hex.
const ADDRESS_INPUT = /^0x[0-9a-fA-F]{40}$/
const ADDRESS_READ = /^0x[0-9a-f]{40}$/

// The funder's first inbound flow and the first inbound bridge deposit of the
// launcher `l`, and the columns both reads return about them.
const FUNDER_READ = 'OPTIONAL MATCH (f:Address)-[e:FLOWED_TO]->(l)'
const BRIDGE_READ =
  "OPTIONAL MATCH (ch:Chain)-[b:BRIDGED]->(l) WHERE b.kind IN ['TOKEN_DEPOSIT','NATIVE_DEPOSIT']"
const PARTY_COLUMNS = [
  'labels(l) AS launcher_roles',
  'l.first_activity_timestamp AS launcher_first_activity',
  'l.degree_in AS launcher_degree_in',
  'l.degree_out AS launcher_degree_out',
  'l.is_sanctioned AS launcher_is_sanctioned',
  'l.is_scam AS launcher_is_scam',
  'l.is_victim AS launcher_is_victim',
  'l.is_issuer_frozen AS launcher_is_issuer_frozen',
  'l.label_risk_labels AS launcher_risk_labels',
  'l.label_risk_levels AS launcher_risk_levels',
  'f.address AS funder',
  'labels(f) AS funder_roles',
  'f.degree_out AS funder_degree_out',
  'f.first_activity_timestamp AS funder_first_activity',
  'f.is_sanctioned AS funder_is_sanctioned',
  'f.is_scam AS funder_is_scam',
  'f.is_victim AS funder_is_victim',
  'f.is_issuer_frozen AS funder_is_issuer_frozen',
  'f.label_risk_labels AS funder_risk_labels',
  'f.label_risk_levels AS funder_risk_levels',
  'e.first_seen_timestamp AS funded_at',
  'e.tx_count AS funding_tx_count',
  'e.amount_usd_sum AS funding_usd',
  'ch.network AS bridged_chain',
  'ch.address AS bridged_bridge',
  'b.kind AS bridged_kind',
  'b.asset AS bridged_asset',
  'b.first_height AS bridged_first_block',
].join(', ')
const TOKEN_COLUMNS = [
  't.address AS token',
  'labels(t) AS token_roles',
  'c.tx_origin AS launcher',
  'c.deployer_address AS deployer',
  'c.factory_address AS factory',
  'c.kind AS creation_kind',
  'c.tx_id AS creation_tx',
  'c.block_height AS creation_block',
  'c.block_timestamp AS creation_time',
].join(', ')

function assertReadAddress(address: string): void {
  if (!ADDRESS_READ.test(address)) {
    throw new Error(`deployer screen: ${JSON.stringify(address)} is not a lowercase 0x address`)
  }
}

/** The token read: the address as a contract, its first creation and who sent it. */
export function tokenScreenQuery(address: string): string {
  assertReadAddress(address)
  return [
    `USE topology MATCH (t:Address {address:'${address}'})<-[c:DEPLOYED_CONTRACT]-(:Address)`,
    'WITH t, c ORDER BY c.block_height LIMIT 1',
    'MATCH (l:Address {address: c.tx_origin})',
    FUNDER_READ,
    'WITH t, c, l, f, e ORDER BY e.first_seen_timestamp LIMIT 1',
    BRIDGE_READ,
    'WITH t, c, l, f, e, ch, b ORDER BY b.first_height LIMIT 1',
    `RETURN ${TOKEN_COLUMNS}, ${PARTY_COLUMNS} LIMIT 1`,
  ].join(' ')
}

/** The wallet read: the address as the launcher itself. */
export function walletScreenQuery(address: string): string {
  assertReadAddress(address)
  return [
    `USE topology MATCH (l:Address {address:'${address}'})`,
    FUNDER_READ,
    'WITH l, f, e ORDER BY e.first_seen_timestamp LIMIT 1',
    BRIDGE_READ,
    'WITH l, f, e, ch, b ORDER BY b.first_height LIMIT 1',
    `RETURN l.address AS launcher, ${PARTY_COLUMNS} LIMIT 1`,
  ].join(' ')
}

/** The one batch the tool sends: members `token` and `wallet`. */
export function deployerScreenQueries(address: string): Array<{ id: 'token' | 'wallet'; query: string }> {
  return [
    { id: 'token', query: tokenScreenQuery(address) },
    { id: 'wallet', query: walletScreenQuery(address) },
  ]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

const numberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
    return Number(value)
  return null
}

const addressOrNull = (value: unknown): string | null =>
  typeof value === 'string' && ADDRESS_INPUT.test(value.trim()) ? value.trim().toLowerCase() : null

const utcOrNull = (ms: number | null): string | null => (isEpochMs(ms) ? utcText(ms) : null)

/**
 * A label from a third-party explorer tag source is training data, never served.
 * The graph is not meant to carry one; this drops it if it ever does.
 */
export function isServedLabel(value: string): boolean {
  const lower = value.trim().toLowerCase()
  return !(lower.startsWith('etherscan') || lower.startsWith('data:etherscan'))
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

/** labels(n) minus Address, with an unserved label dropped. */
function rolesOf(value: unknown): string[] {
  return strings(value).filter((role) => role !== 'Address' && isServedLabel(role))
}

// The flag of each judgement mark, and the mark's label word served as its value.
const FLAG_CRIMES: Array<[CrimeKind, string, string]> = [
  ['sanctioned', 'is_sanctioned', 'Sanctioned'],
  ['scam', 'is_scam', 'Scam'],
  ['victim', 'is_victim', 'Victim'],
  ['issuer_frozen', 'is_issuer_frozen', 'IssuerFrozen'],
]

/** The flags that are true, then one risk entry per served risk label with its level. */
function crimeOf(row: Record<string, unknown>, prefix: 'launcher' | 'funder'): Crime[] {
  const crime: Crime[] = []
  for (const [kind, flag, value] of FLAG_CRIMES) {
    if (row[`${prefix}_${flag}`] === true) crime.push({ kind, value, level: null })
  }
  const labels = Array.isArray(row[`${prefix}_risk_labels`]) ? (row[`${prefix}_risk_labels`] as unknown[]) : []
  const levels = Array.isArray(row[`${prefix}_risk_levels`]) ? (row[`${prefix}_risk_levels`] as unknown[]) : []
  labels.forEach((label, at) => {
    if (typeof label !== 'string' || label.trim() === '' || !isServedLabel(label)) return
    crime.push({ kind: 'risk', value: label, level: textOrNull(levels[at]) })
  })
  return crime
}

/** The funder kinds, first match wins; a contract with no role is 'contract', no match is a plain wallet. */
export const FUNDER_KIND_RULES: ReadonlyArray<
  readonly [FunderKind, (roles: readonly string[], isScam: boolean) => boolean]
> = [
  ['scam', (roles, isScam) => isScam || roles.includes('Scam')],
  ['mixer', (roles) => roles.includes('Mixer')],
  ['exchange', (roles) => roles.includes('Exchange')],
  ['bridge', (roles) => roles.includes('Bridge')],
  ['bundler', (roles) => roles.includes('Bundler')],
  ['launchpad', (roles) => roles.includes('Pool') || roles.includes('Protocol')],
  ['contract', (roles) => roles.includes('Contract')],
]

export function funderKind(roles: readonly string[], isScam = false): FunderKind {
  return FUNDER_KIND_RULES.find(([, rule]) => rule(roles, isScam))?.[0] ?? 'wallet'
}

function partyOf(row: Record<string, unknown>): Party | null {
  const address = addressOrNull(row.launcher)
  if (!address) return null
  const firstActivity = numberOrNull(row.launcher_first_activity)
  return {
    address,
    roles: rolesOf(row.launcher_roles),
    crime: crimeOf(row, 'launcher'),
    first_activity: firstActivity,
    first_activity_utc: utcOrNull(firstActivity),
    degree_in: numberOrNull(row.launcher_degree_in),
    degree_out: numberOrNull(row.launcher_degree_out),
  }
}

function funderOf(row: Record<string, unknown>): Funder | null {
  const address = addressOrNull(row.funder)
  if (!address) return null
  const roles = rolesOf(row.funder_roles)
  const firstActivity = numberOrNull(row.funder_first_activity)
  const fundedAt = numberOrNull(row.funded_at)
  return {
    address,
    kind: funderKind(roles, row.funder_is_scam === true),
    roles,
    crime: crimeOf(row, 'funder'),
    degree_out: numberOrNull(row.funder_degree_out),
    first_activity: firstActivity,
    first_activity_utc: utcOrNull(firstActivity),
    funded_at: fundedAt,
    funded_at_utc: utcOrNull(fundedAt),
    funding_tx_count: numberOrNull(row.funding_tx_count),
    funding_usd: numberOrNull(row.funding_usd),
  }
}

function bridgedInOf(row: Record<string, unknown>): BridgedIn | null {
  const chain = textOrNull(row.bridged_chain)
  const kind = textOrNull(row.bridged_kind)
  if (!chain && !kind) return null
  const asset = textOrNull(row.bridged_asset)
  return {
    chain,
    bridge: addressOrNull(row.bridged_bridge) ?? textOrNull(row.bridged_bridge),
    kind,
    asset: addressOrNull(asset) ?? asset,
    first_block: numberOrNull(row.bridged_first_block),
  }
}

function creationOf(row: Record<string, unknown>): Creation {
  const factory = addressOrNull(row.factory)
  const kind = textOrNull(row.creation_kind)
  const time = numberOrNull(row.creation_time)
  return {
    tx: textOrNull(row.creation_tx)?.toLowerCase() ?? null,
    block: numberOrNull(row.creation_block),
    time,
    time_utc: utcOrNull(time),
    deployer: addressOrNull(row.deployer),
    factory,
    mode: kind === 'factory' || (kind !== 'direct' && factory !== null) ? 'factory' : 'direct',
  }
}

/** The first row of a member that names a launcher, or null when it has none. */
function launcherRow(member: Member | undefined): Record<string, unknown> | null {
  if (!member || !Array.isArray(member.results)) return null
  return member.results.find((row) => isRecord(row) && addressOrNull(row.launcher) !== null) ?? null
}

const answered = (member: Member | undefined): boolean =>
  member?.ok === true && Array.isArray(member.results)

function memberFailure(id: string, member: Member | undefined): string {
  if (!member) return `the ${id} read is missing from the batch answer`
  return typeof member.error === 'string' && member.error.trim() !== ''
    ? member.error
    : `the ${id} read did not answer`
}

/** The screen built from the two batch members, or why it cannot be. */
export function screenFromMembers(
  network: string,
  input: string,
  members: Map<string, Member>
): { result: AmlDeployerScreenResult } | { failure: string } {
  const token = members.get('token')
  const wallet = members.get('wallet')
  const base = {
    schema: AML_DEPLOYER_SCREEN_SCHEMA,
    tool: AML_DEPLOYER_SCREEN_TOOL,
    network,
    input,
    not_covered: [...NOT_COVERED] as string[],
  }

  // A token read that failed cannot be told from "not a token": no fallback.
  if (!answered(token)) return { failure: memberFailure('token', token) }
  const tokenRow = launcherRow(token)
  if (tokenRow) {
    const launcher = partyOf(tokenRow)!
    const result = {
      ...base,
      found: true,
      input_kind: 'token' as const,
      token: {
        address: addressOrNull(tokenRow.token) ?? input,
        roles: rolesOf(tokenRow.token_roles),
      },
      creation: creationOf(tokenRow),
      launcher,
      launcher_resolved: !launcher.roles.includes('Bundler'),
      first_funder: funderOf(tokenRow),
      bridged_in: bridgedInOf(tokenRow),
    }
    return { result: { ...result, hint: hintFor(result) } }
  }

  if (!answered(wallet)) return { failure: memberFailure('wallet', wallet) }
  const walletRow = launcherRow(wallet)
  if (walletRow) {
    const launcher = partyOf(walletRow)!
    const result = {
      ...base,
      found: true,
      input_kind: 'wallet' as const,
      token: null,
      creation: null,
      launcher,
      launcher_resolved: !launcher.roles.includes('Bundler'),
      first_funder: funderOf(walletRow),
      bridged_in: bridgedInOf(walletRow),
    }
    return { result: { ...result, hint: hintFor(result) } }
  }

  const result = {
    ...base,
    found: false,
    input_kind: null,
    token: null,
    creation: null,
    launcher: null,
    launcher_resolved: null,
    first_funder: null,
    bridged_in: null,
  }
  return { result: { ...result, hint: hintFor(result) } }
}

const FACTS_ONLY =
  'Report these as facts. Give no score, no risk level and no verdict of your own: the user decides.'

function hintFor(result: Omit<AmlDeployerScreenResult, 'hint'>): string {
  const parts: string[] = [ANSWER_HINT]
  if (!result.found) {
    parts.push(
      `${result.input} is not in the Chain Insights Graph of ${result.network}: no flow, creation or bridge touches it. ` +
        'Say so in one line. That is not proof the address is clean, and it is not proof it is a token. ' +
        'Check the network and the address with the user.'
    )
    return parts.join(' ')
  }
  parts.push(FACTS_ONLY)
  if (result.input_kind === 'wallet' && result.launcher?.roles.some((r) => r === 'Contract' || r === 'Token')) {
    parts.push(
      'The address is a contract, but the graph holds no creation record for it, so it was screened as a wallet.'
    )
  }
  if (result.launcher_resolved === false) {
    parts.push(
      'The launcher is a bundler: it sends transactions for others, so the person behind the launch is not known from this read.'
    )
  }
  if (!result.first_funder) parts.push('The launcher has no inbound flow in the graph: no first funder.')
  parts.push(`not_covered names what the graph cannot see yet (${NOT_COVERED.join(', ')}); say so when it matters.`)
  return parts.join(' ')
}

function errorResult(text: string): AmlDeployerScreenToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

function textResult(structured: AmlDeployerScreenResult): AmlDeployerScreenToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured as unknown as Record<string, unknown>,
    isError: false,
  }
}

/** aml_deployer_screen, {network, address}. Every argument is checked before a read is sent. */
export async function handleAmlDeployerScreen(
  args: unknown,
  deps: DeployerScreenDependencies
): Promise<AmlDeployerScreenToolResult> {
  const record = isRecord(args) ? args : {}
  let network: string
  try {
    network = normalizeDexNetwork(record.network)
  } catch (err) {
    return errorResult(
      err instanceof DexRegistryError ? err.message : `invalid_network: ${(err as Error).message}`
    )
  }
  const raw = typeof record.address === 'string' ? record.address.trim() : ''
  if (!ADDRESS_INPUT.test(raw)) {
    return errorResult(
      'invalid_address: address is required: a token contract or a wallet, 0x plus 40 hex characters. ' +
        'A ticker or a name is not an address: call meta_token_lookup first.'
    )
  }
  const address = raw.toLowerCase()

  const unavailable = await deps.unavailable?.()
  if (unavailable) {
    return errorResult(
      `No deployer screen read was sent: ${unavailable} There is no answer yet, which is not "not found": try again later.`
    )
  }

  let answer: GraphAnswer
  try {
    answer = await deps.graphQueryBatch({ network, queries: deployerScreenQueries(address) })
  } catch (err) {
    return errorResult(
      `The deployer screen read failed: ${deps.describeFailure(err)} This is not "not found": send the same screen again once.`
    )
  }
  const members = membersOf(answer)
  if (members.size === 0) {
    const text = answer.isError === true ? refusalOf(answer).text : 'the batch answer held no reads'
    return errorResult(`The deployer screen read failed: ${text} This is not "not found".`)
  }
  const screen = screenFromMembers(network, address, members)
  if ('failure' in screen) {
    return errorResult(
      `The deployer screen read failed: ${screen.failure} This is not "not found": send the same screen again once.`
    )
  }
  return textResult(screen.result)
}
