import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  formatNetworkCapability,
  groupThousands,
  laneDisplayName,
  mirrorGraphNetworkCapabilities,
  type NetworkCapability,
} from '../src/mcp/capabilities.js'

// `cia network <name>` is the indexing progress of one network: the chain
// node's head first, then Indexing, Graph and Evidence, each row with its
// height and its blocks behind the head. The fixture is the production reply
// of 2026-10-13, recorded with `cia network robinhood --json`. The built CLI
// reads it from a local server.

const fixturePath = join(
  process.cwd(),
  'tests/fixtures/network-capabilities-robinhood-20261013.json'
)
const fixtureText = readFileSync(fixturePath, 'utf8')
const cliBin = join(process.cwd(), 'bin', 'cli.js')
const runCli = promisify(execFile)

/** A fresh copy of the recorded network, read as the CLI reads it. */
function recorded(): NetworkCapability {
  const raw = JSON.parse(fixtureText) as Record<string, unknown>
  return mirrorGraphNetworkCapabilities({ networks: [raw] }).networks[0]!
}

function lines(network: NetworkCapability): string[] {
  return formatNetworkCapability(network).split('\n')
}

/** The rows of one table, without its header. */
function table(output: string[], title: string): string[] {
  const start = output.findIndex((line) => line.startsWith(`${title} `) || line === title)
  expect(start, `table ${title}`).toBeGreaterThan(-1)
  const end = output.indexOf('', start)
  return output.slice(start + 1, end === -1 ? undefined : end)
}

// The agreed screen, character for character, from the 2026-10-13 reply.
const DESIGN_SCREEN = `Network           Robinhood Chain
Identifier        robinhood
Status            live (default)
Blockchain head   87,642,448  (1 s old)

Indexing                      height      behind head
  receipts                    87,642,307          141
  traces                      87,641,751          697
  dex                         11,959,694   75,682,754
  bridge                      87,641,751          697
  smart accounts              87,641,751          697

Graph                         height      behind head
  flows                       87,641,751          697
  operated_by                 87,642,307          141
  dex_swaps                   87,312,173      330,275
  dex_liquidity               87,312,173      330,275
  bridged                     87,641,751          697
  approvals                   87,642,307          141
  sponsored                   87,641,703          745
  bundled                     87,641,751          697
  signers                     87,641,703          745
  owners                      87,641,751          697
  contracts                   87,641,751          697

Evidence                      height      behind head
  evidence                    not reported`

describe('cia network <name>: the screen', () => {
  it('prints the agreed screen from the reply it was drawn from', () => {
    const network = recorded()
    network.freshness = {
      ...network.freshness,
      chain_head_block: 87642448,
      chain_head_age_seconds: 1,
    }
    network.lane_progress = [
      { lane: 'core_transfers_source_head', height: 87642307 },
      { lane: 'core_transfers_internal_follow', height: 87641751 },
      { lane: 'core_dex_follow', height: 11959694 },
      { lane: 'core_bridge_follow', height: 87641751 },
      { lane: 'core_smart_account_follow', height: 87641751 },
    ]
    const positions: [string, number][] = [
      ['flows', 87641751],
      ['operated_by', 87642307],
      ['dex_swaps', 87312173],
      ['dex_liquidity', 87312173],
      ['bridged', 87641751],
      ['approvals', 87642307],
      ['sponsored', 87641703],
      ['bundled', 87641751],
      ['signers', 87641703],
      ['owners', 87641751],
      ['contracts', 87641751],
    ]
    network.graph_progress = {
      complete_through_block: 87312173,
      layers: positions.map(([layer, position]) => ({ layer, position })),
    }

    expect(formatNetworkCapability(network)).toBe(DESIGN_SCREEN)
  })

  it('full reply: head on line four, five lanes, eleven layers, one evidence row, lag is head minus height', () => {
    const network = recorded()
    network.lane_progress = [...network.lane_progress!, { lane: 'evidence_sync', height: 80000000 }]
    const output = lines(network)
    const head = network.freshness!.chain_head_block!

    expect(output.slice(0, 4)).toEqual([
      'Network           Robinhood Chain',
      'Identifier        robinhood',
      'Status            live (default)',
      'Blockchain head   87,661,214  (1 s old)',
    ])
    const indexing = table(output, 'Indexing')
    const graph = table(output, 'Graph')
    const evidence = table(output, 'Evidence')
    expect(indexing).toHaveLength(5)
    expect(graph).toHaveLength(11)
    expect(evidence).toEqual(['  evidence                    80,000,000    7,661,214'])

    const heights = [
      ...network.lane_progress
        .filter((lane) => lane.lane !== 'evidence_sync')
        .map((lane) => lane.height!),
      ...network.graph_progress!.layers.map((layer) => layer.position),
    ]
    for (const [index, row] of [...indexing, ...graph].entries()) {
      const height = heights[index]!
      const cells = row.trim().split(/\s{2,}/)
      expect(cells.slice(1)).toEqual([groupThousands(height), groupThousands(head - height)])
    }
  })

  it('no row carries a mark: the public screen says nothing beyond heights and lag', () => {
    const text = formatNetworkCapability(recorded())

    expect(text).not.toContain('◀')
    expect(text).not.toContain('slowest')
    expect(table(text.split('\n'), 'Indexing')[2]).toBe(
      '  dex                         12,617,066   75,044,148'
    )
  })

  it('a lane not started prints "not started" and no lag', () => {
    const network = recorded()
    network.lane_progress = network.lane_progress!.map((lane) =>
      lane.lane === 'core_bridge_follow' ? { ...lane, height: null } : lane
    )
    const indexing = table(lines(network), 'Indexing')

    expect(indexing[3]).toBe('  bridge                      not started')
    expect(indexing[2]).toBe('  dex                         12,617,066   75,044,148')
  })

  it('evidence absent: the Evidence table is one row, "evidence  not reported"', () => {
    const output = lines(recorded())

    expect(table(output, 'Evidence')).toEqual(['  evidence                    not reported'])
    expect(output.at(-1)).toBe('  evidence                    not reported')
  })

  it('no head: no head line, no lag column, every height still prints', () => {
    const network = recorded()
    delete network.freshness!.chain_head_block
    const text = formatNetworkCapability(network)
    const output = text.split('\n')

    expect(text).not.toContain('Blockchain head')
    expect(text).not.toContain('behind head')
    expect(output[3]).toBe('')
    expect(output[4]).toBe('Indexing                      height')
    expect(table(output, 'Indexing')[0]).toBe('  receipts                    87,659,858')
    expect(table(output, 'Indexing')[2]).toBe('  dex                         12,617,066')
    for (const layer of network.graph_progress!.layers) {
      expect(text).toContain(`  ${layer.layer}`.padEnd(30) + groupThousands(layer.position))
    }
  })

  it('a head without its age prints the head alone', () => {
    const network = recorded()
    delete network.freshness!.chain_head_age_seconds

    expect(lines(network)[3]).toBe('Blockchain head   87,661,214')
  })
})

// A server that groups its graph layers into families. The fixture is the 2026-10-13 reply with the
// families block of the design added and the head set to 90,266,314, until a
// live reply replaces it. The Families table sits between Indexing and Graph,
// by plain name, in the order the server sends.
const familiesFixtureText = readFileSync(
  join(process.cwd(), 'tests/fixtures/network-capabilities-robinhood-families.json'),
  'utf8'
)

function recordedWithFamilies(): NetworkCapability {
  const raw = JSON.parse(familiesFixtureText) as Record<string, unknown>
  return mirrorGraphNetworkCapabilities({ networks: [raw] }).networks[0]!
}

// The agreed screen of a server that sends families, character for character.
const FAMILIES_SCREEN = `Network           Robinhood Chain
Identifier        robinhood
Status            live (default)
Blockchain head   90,266,314  (1 s old)

Indexing                      height      behind head
  receipts                    90,266,100          214
  traces                      90,266,000          314
  dex                         12,617,066   77,649,248
  bridge                      90,266,000          314
  smart accounts              90,266,000          314

Families                      height      behind head
  money                       90,260,000        6,314
  dex                          8,300,000   81,966,314
  interactions                90,266,000          314
  smart accounts              90,266,000          314
  annotations                 fresh
  transfers                   90,266,000          314

Graph                         height      behind head
  flows                       90,260,000        6,314
  operated_by                 90,266,000          314
  dex_swaps                    8,300,000   81,966,314
  dex_liquidity                8,300,000   81,966,314
  bridged                     90,266,000          314
  approvals                   90,266,000          314
  sponsored                   90,266,000          314
  bundled                     90,266,000          314
  signers                     90,266,000          314
  owners                      90,266,000          314
  contracts                   90,266,000          314
  transfers_by_asset          90,266,000          314

Evidence                      height      behind head
  evidence                    not reported`

describe('cia network <name>: the layer families', () => {
  it('prints the agreed screen of a server that sends families', () => {
    expect(formatNetworkCapability(recordedWithFamilies())).toBe(FAMILIES_SCREEN)
  })

  it('a server with no families prints no Families table', () => {
    const network = recordedWithFamilies()
    delete network.graph_progress!.families
    const text = formatNetworkCapability(network)

    expect(text).not.toContain('Families')
    expect(text).not.toContain('interactions')
  })

  it('annotations walking prints "walking" and no lag', () => {
    const network = recordedWithFamilies()
    network.graph_progress!.families = network.graph_progress!.families!.map((family) =>
      family.name === 'annotations' ? { ...family, fresh: false } : family
    )

    expect(table(lines(network), 'Families')[4]).toBe('  annotations                 walking')
  })

  it('a block family with no lag from the server prints head minus height', () => {
    const network = recordedWithFamilies()
    network.graph_progress!.families = network.graph_progress!.families!.map((family) => ({
      ...family,
      blocks_behind_head: null,
    }))
    const families = table(lines(network), 'Families')

    expect(families[0]).toBe('  money                       90,260,000        6,314')
    expect(families[1]).toBe('  dex                          8,300,000   81,966,314')
  })

  it('no head: families print their heights and no lag', () => {
    const network = recordedWithFamilies()
    delete network.freshness!.chain_head_block
    const families = table(lines(network), 'Families')

    expect(families[0]).toBe('  money                       90,260,000')
    expect(families[1]).toBe('  dex                          8,300,000')
    expect(families[4]).toBe('  annotations                 fresh')
  })
})

describe('cia network <name>: names', () => {
  it('prints the five known lanes by plain name, and no internal lane name', () => {
    const text = formatNetworkCapability(recorded())

    expect(table(text.split('\n'), 'Indexing').map((row) => row.trim().split(/\s{2,}/)[0])).toEqual(
      ['receipts', 'traces', 'dex', 'bridge', 'smart accounts']
    )
    expect(laneDisplayName('core_smart_account_follow')).toBe('smart accounts')
    expect(laneDisplayName('evidence_sync')).toBe('evidence')
    expect(text).not.toMatch(/core_|_follow|source_head|evidence_sync/)
    expect(text).not.toContain('Dataset')
    expect(text).not.toContain('Available tools')
  })

  it('an unknown lane prints as sent, in Indexing, after the known rows', () => {
    const network = recorded()
    network.lane_progress = [
      { lane: 'core_future_follow', height: 87000000 },
      ...network.lane_progress!,
      { lane: 'evidence_sync', height: 80000000 },
    ]
    const output = lines(network)

    expect(table(output, 'Indexing').map((row) => row.trim().split(/\s{2,}/)[0])).toEqual([
      'receipts',
      'traces',
      'dex',
      'bridge',
      'smart accounts',
      'core_future_follow',
    ])
    expect(table(output, 'Evidence')).toHaveLength(1)
  })

  it('groups thousands the same way on every machine', () => {
    const cases: [number, string][] = [
      [0, '0'],
      [999, '999'],
      [1000, '1,000'],
      [87642448, '87,642,448'],
      [1234567890123, '1,234,567,890,123'],
      [-1234, '-1,234'],
    ]
    expect(cases.map(([value]) => groupThousands(value))).toEqual(cases.map(([, text]) => text))
  })
})

describe('cia network <name>: the built CLI', () => {
  let server: Server
  let endpoint: string
  let home: string

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'ci-cli-network-detail-'))
    const reply = JSON.stringify({
      schema: 'chain-insights.network-capabilities.v1',
      networks: [JSON.parse(fixtureText)],
    })
    server = createServer((request, response) => {
      if (request.url?.startsWith('/metadata/networks')) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(reply)
      } else {
        response.writeHead(404)
        response.end()
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(home, { recursive: true, force: true })
  })

  async function run(args: string[]) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT: endpoint,
    }
    delete env['CIA_ACTION_LOG']
    return runCli(process.execPath, [cliBin, ...args], { encoding: 'utf8', env, timeout: 30_000 })
  }

  it('prints the progress screen', async () => {
    const { stdout, stderr } = await run(['network', 'robinhood'])

    expect(stderr).toBe('')
    expect(stdout).toBe(`${formatNetworkCapability(recorded())}\n`)
    expect(stdout.split('\n')[3]).toBe('Blockchain head   87,661,214  (1 s old)')
  })

  it('--json is the reply unchanged, with no plain lane name in it', async () => {
    const { stdout } = await run(['network', 'robinhood', '--json'])

    expect(stdout).toBe(fixtureText)
    expect(stdout).not.toContain('receipts')
  })
})
