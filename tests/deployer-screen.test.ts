import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  AML_DEPLOYER_SCREEN_ARGS,
  AML_DEPLOYER_SCREEN_SCHEMA,
  AML_DEPLOYER_SCREEN_TOOL,
  NOT_COVERED,
  deployerScreenQueries,
  funderKind,
  handleAmlDeployerScreen,
  type AmlDeployerScreenResult,
  type DeployerScreenDependencies,
  type FunderKind,
} from '../src/mcp/deployer-screen.js'
import { KNOWN_PUBLIC_TOOL_DESCRIPTIONS, LOCAL_TOOL_NAMES } from '../src/mcp/proxy.js'
import type { GraphAnswer } from '../src/mcp/token-lookup.js'
import { PUBLIC_MCP_TOOL_ALLOWED_ARGS } from '../src/mcp/tool-visibility.js'

// aml_deployer_screen against a fake graph transport at the proxy boundary. The
// member answers are the structuredContent the graph answered on 2026-11-06 for
// the same two reads, recorded in tests/fixtures/deployer-screen-graph.json. No
// graph is reached.

type Row = Record<string, unknown>
type Case = { path: 'token' | 'wallet'; address: string; response: { facts: { query: { results: Row[] } } } }
const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'tests', 'fixtures', 'deployer-screen-graph.json'), 'utf8')
) as { queries: { token: string; wallet: string }; cases: Record<string, Case> }

const rowsOf = (name: string): Row[] => structuredClone(fixture.cases[name]!.response.facts.query.results)
const addressOf = (name: string): string => fixture.cases[name]!.address

type MemberReply = Row[] | { error: string }

function batchAnswer(token: MemberReply, wallet: MemberReply): GraphAnswer {
  const member = (id: string, reply: MemberReply) =>
    Array.isArray(reply)
      ? { id, ok: true, results: reply, count: reply.length }
      : { id, ok: false, error: reply.error, results: [] }
  return {
    structuredContent: {
      schema: 'chain-insights.result.v1',
      tool: 'graph_query_batch',
      facts: { queries: [member('token', token), member('wallet', wallet)] },
      hint: null,
    },
    isError: false,
  }
}

function harness(reply: GraphAnswer | Error, unavailable?: string) {
  const calls: Array<{ network: string; queries: Array<{ id: string; query: string }> }> = []
  const deps: DeployerScreenDependencies = {
    graphQueryBatch: async (args) => {
      calls.push(args)
      if (reply instanceof Error) throw reply
      return reply
    },
    unavailable: () => unavailable,
    describeFailure: (err) => `MCP call failed: ${(err as Error).message}`,
  }
  const screen = async (args: Record<string, unknown>) => {
    const result = await handleAmlDeployerScreen(args, deps)
    return { result, structured: result.structuredContent as unknown as AmlDeployerScreenResult }
  }
  return { calls, screen }
}

describe('aml_deployer_screen reads', () => {
  it('sends one batch with the members token and wallet, the recorded reads with the address lowercased', async () => {
    const address = addressOf('token_direct_wallet_funder')
    const { calls, screen } = harness(batchAnswer(rowsOf('token_direct_wallet_funder'), []))
    await screen({ network: 'Robinhood', address: address.toUpperCase().replace('0X', '0x') })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.network).toBe('robinhood')
    expect(calls[0]!.queries.map((q) => q.id)).toEqual(['token', 'wallet'])
    expect(calls[0]!.queries).toEqual([
      { id: 'token', query: fixture.queries.token.replace('$ADDR', address) },
      { id: 'wallet', query: fixture.queries.wallet.replace('$ADDR', address) },
    ])
    expect(deployerScreenQueries(address)).toEqual(calls[0]!.queries)
  })

  it('the read builder refuses anything but a lowercase address', () => {
    expect(() => deployerScreenQueries("0x0cf82166c2ca93ef16ed87e3239945953d71b789'})")).toThrow()
    expect(() => deployerScreenQueries('0x0CF82166C2CA93EF16ED87E3239945953D71B789')).toThrow()
  })

  it.each([
    ['no address', {}],
    ['a ticker', { address: 'TCITY' }],
    ['a short address', { address: '0x0cf82166c2ca93ef16ed87e3239945953d71b7' }],
    ['an injection', { address: "0x0cf82166c2ca93ef16ed87e3239945953d71b789'}) MATCH (n) RETURN n //" }],
    ['a number', { address: 12345 }],
  ])('refuses %s before any graph read', async (_name, args) => {
    const { calls, screen } = harness(batchAnswer([], []))
    const { result } = await screen({ network: 'robinhood', ...args })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toMatch(/^invalid_address:/)
    expect(calls).toEqual([])
  })

  it('refuses a missing network before any graph read', async () => {
    const { calls, screen } = harness(batchAnswer([], []))
    const { result } = await screen({ address: addressOf('token_factory') })
    expect(result.isError).toBe(true)
    expect(calls).toEqual([])
  })
})

describe('aml_deployer_screen answers from the recorded graph', () => {
  it('a token created directly, funded by a plain wallet that paid two addresses', async () => {
    const address = addressOf('token_direct_wallet_funder')
    const { screen } = harness(batchAnswer(rowsOf('token_direct_wallet_funder'), []))
    const { result, structured } = await screen({ network: 'robinhood', address })
    expect(result.isError).toBe(false)
    expect(structured).toMatchObject({
      schema: AML_DEPLOYER_SCREEN_SCHEMA,
      tool: AML_DEPLOYER_SCREEN_TOOL,
      network: 'robinhood',
      input: address,
      found: true,
      input_kind: 'token',
      token: { address, roles: ['Contract', 'Token'] },
      creation: {
        tx: '0x97f555661706efb480b83b904bb3872023889f5e5e3d68a0460901b8a22b6070',
        block: 100983361,
        time: 1793285251000,
        time_utc: '2026-10-29 14:47:31 UTC',
        deployer: '0xc65dd873f3ed0f3889f6c1f1a42e0bbe3bc613ac',
        factory: null,
        mode: 'direct',
      },
      launcher: {
        address: '0xc65dd873f3ed0f3889f6c1f1a42e0bbe3bc613ac',
        roles: ['Account'],
        crime: [],
        first_activity: 1793285245000,
        degree_in: 7,
        degree_out: 3,
      },
      launcher_resolved: true,
      first_funder: {
        address: '0x8b58a1acddb907963476ff92ec7018d9e7c29b9a',
        kind: 'wallet',
        roles: ['Account'],
        crime: [],
        degree_out: 2,
        funded_at: 1793285245000,
        funding_tx_count: 1,
        funding_usd: 2404.7781255,
      },
      bridged_in: null,
      not_covered: [...NOT_COVERED],
    })
    expect(structured.first_funder!.funded_at_utc).toBe('2026-10-29 14:47:25 UTC')
    expect(structured.launcher!.first_activity_utc).toBe('2026-10-29 14:47:25 UTC')
    expect(JSON.parse(result.content[0]!.text)).toEqual(structured)
  })

  it('a token created by a factory: the launcher is the sender, not the factory', async () => {
    const { screen } = harness(batchAnswer(rowsOf('token_factory'), []))
    const { structured } = await screen({ network: 'robinhood', address: addressOf('token_factory') })
    expect(structured.input_kind).toBe('token')
    expect(structured.creation).toMatchObject({
      mode: 'factory',
      factory: '0x3711cea4feade896c913c68f01eda97cb06d1a42',
      deployer: '0x3711cea4feade896c913c68f01eda97cb06d1a42',
    })
    expect(structured.launcher!.address).toBe('0x86d16c227da14845d74d248e7737599d3eafe29a')
    expect(structured.launcher!.address).not.toBe(structured.creation!.deployer)
    expect(structured.first_funder).toMatchObject({ kind: 'contract', degree_out: 30767 })
  })

  it('a token whose launcher was funded by a bridge: kind bridge and its risk label with level', async () => {
    const { screen } = harness(batchAnswer(rowsOf('token_bridge_funder'), []))
    const { structured } = await screen({ network: 'robinhood', address: addressOf('token_bridge_funder') })
    expect(structured.first_funder).toMatchObject({
      address: '0xf70da97812cb96acdf810712aa562db8dfa3dbef',
      kind: 'bridge',
      roles: ['Account', 'Bundler', 'Protocol', 'Bridge'],
      crime: [{ kind: 'risk', value: 'Bridge', level: 'low' }],
      degree_out: 367780,
    })
    expect(structured.launcher_resolved).toBe(true)
  })

  it('a wallet: the token read is empty, the wallet read answers with its bridge deposit and a victim funder', async () => {
    const address = addressOf('wallet_bridged_in')
    expect(addressOf('token_path_on_a_wallet')).toBe(address)
    const { screen } = harness(batchAnswer(rowsOf('token_path_on_a_wallet'), rowsOf('wallet_bridged_in')))
    const { result, structured } = await screen({ network: 'robinhood', address })
    expect(result.isError).toBe(false)
    expect(structured).toMatchObject({
      found: true,
      input_kind: 'wallet',
      token: null,
      creation: null,
      launcher: { address, roles: ['Account'], degree_in: 12, degree_out: 4 },
      launcher_resolved: true,
      bridged_in: {
        chain: 'abstract',
        bridge: '0x111b8f9cc335704ceb3009d10213cd78d1434e98',
        kind: 'TOKEN_DEPOSIT',
        asset: '0x5825b287c9769701091b74b925841a2b815c9514',
        first_block: 4164876,
      },
    })
    expect(structured.first_funder!.kind).toBe('bridge')
    expect(structured.first_funder!.roles).toContain('Victim')
    expect(structured.first_funder!.crime).toEqual([
      { kind: 'victim', value: 'Victim', level: null },
      { kind: 'risk', value: 'Bridge', level: 'low' },
      { kind: 'risk', value: 'Victim', level: 'none' },
    ])
  })

  it('an address the graph knows only as a dust receiver is screened as a wallet, honestly', async () => {
    const address = addressOf('unknown_address')
    const { screen } = harness(batchAnswer([], rowsOf('unknown_address')))
    const { structured } = await screen({ network: 'robinhood', address })
    expect(structured).toMatchObject({
      found: true,
      input_kind: 'wallet',
      launcher: { address, roles: [], degree_in: 2, degree_out: 0 },
      first_funder: { kind: 'wallet', degree_out: 5, funding_usd: 0.02506343 },
    })
  })

  it('an address with no node in the graph is "not found", not an error', async () => {
    const address = '0x000000000000000000000000000000000000f00d'
    const { screen } = harness(batchAnswer([], []))
    const { result, structured } = await screen({ network: 'robinhood', address })
    expect(result.isError).toBe(false)
    expect(structured).toMatchObject({
      found: false,
      input: address,
      input_kind: null,
      token: null,
      creation: null,
      launcher: null,
      launcher_resolved: null,
      first_funder: null,
      bridged_in: null,
      not_covered: [...NOT_COVERED],
    })
    expect(structured.hint).toContain('is not in the Chain Insights Graph')
  })

  it('a bundler launcher is not resolved: the person behind the launch is unknown', async () => {
    const rows = rowsOf('token_direct_wallet_funder')
    rows[0]!.launcher_roles = ['Account', 'Address', 'Bundler']
    const { screen } = harness(batchAnswer(rows, []))
    const { structured } = await screen({ network: 'robinhood', address: addressOf('token_direct_wallet_funder') })
    expect(structured.launcher_resolved).toBe(false)
  })

  it('never serves a label from an explorer tag source, in roles or in risk labels', async () => {
    const rows = rowsOf('token_bridge_funder')
    rows[0]!.funder_roles = [...(rows[0]!.funder_roles as string[]), 'etherscan:Phish']
    rows[0]!.funder_risk_labels = ['Bridge', 'data:etherscan/phish-hack']
    rows[0]!.funder_risk_levels = ['low', 'high']
    rows[0]!.launcher_risk_labels = ['etherscan-fake-phishing']
    rows[0]!.launcher_risk_levels = ['high']
    const { result, structured } = await screen(rows)
    expect(structured.first_funder!.roles).toEqual(['Account', 'Bundler', 'Protocol', 'Bridge'])
    expect(structured.first_funder!.crime).toEqual([{ kind: 'risk', value: 'Bridge', level: 'low' }])
    expect(structured.launcher!.crime).toEqual([])
    expect(result.content[0]!.text.toLowerCase()).not.toContain('etherscan')

    async function screen(r: Row[]) {
      return harness(batchAnswer(r, [])).screen({ network: 'robinhood', address: addressOf('token_bridge_funder') })
    }
  })
})

describe('aml_deployer_screen when a read fails', () => {
  const address = addressOf('wallet_bridged_in')

  it('a failed token read is an error, never a fallback to the wallet read', async () => {
    const { result } = await harness(
      batchAnswer({ error: 'query_timeout: the read ran past its time' }, rowsOf('wallet_bridged_in'))
    ).screen({ network: 'robinhood', address })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('query_timeout')
    expect(result.content[0]!.text).toContain('not "not found"')
  })

  it('a failed wallet read after an empty token read is an error', async () => {
    const { result } = await harness(batchAnswer([], { error: 'graph_busy: try again' })).screen({
      network: 'robinhood',
      address,
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('graph_busy')
  })

  it('a batch call that throws is an error with the failure text', async () => {
    const { result } = await harness(new Error('payment required')).screen({ network: 'robinhood', address })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('MCP call failed: payment required')
  })

  it('an unreachable graph sends no read', async () => {
    const h = harness(batchAnswer([], []), 'Chain Insights Graph is not connected.')
    const { result } = await h.screen({ network: 'robinhood', address })
    expect(result.isError).toBe(true)
    expect(h.calls).toEqual([])
  })
})

describe('the funder kind', () => {
  it.each<[string[], boolean, FunderKind]>([
    [['Account'], false, 'wallet'],
    [['Account'], true, 'scam'],
    [['Scam', 'Bridge'], false, 'scam'],
    [['Mixer', 'Exchange'], false, 'mixer'],
    [['Exchange', 'Bridge'], false, 'exchange'],
    [['Bundler', 'Protocol', 'Bridge'], false, 'bridge'],
    [['Bundler', 'Protocol'], false, 'bundler'],
    [['Pool'], false, 'launchpad'],
    [['Protocol', 'Contract'], false, 'launchpad'],
    [['Contract', 'Victim'], false, 'contract'],
  ])('%j with is_scam %s is %s', (roles, isScam, kind) => {
    expect(funderKind(roles, isScam)).toBe(kind)
  })
})

describe('aml_deployer_screen is a local tool every host reads', () => {
  it('is registered locally with its description and its arguments', () => {
    expect(LOCAL_TOOL_NAMES.has(AML_DEPLOYER_SCREEN_TOOL)).toBe(true)
    expect(PUBLIC_MCP_TOOL_ALLOWED_ARGS[AML_DEPLOYER_SCREEN_TOOL]).toEqual([...AML_DEPLOYER_SCREEN_ARGS])
  })

  it('its description opens with facts only and no score', () => {
    const description = KNOWN_PUBLIC_TOOL_DESCRIPTIONS[AML_DEPLOYER_SCREEN_TOOL] ?? ''
    expect(description.split(':')[0]).toBe('Facts only, no score and no verdict')
  })
})
