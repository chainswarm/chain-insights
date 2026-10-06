import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'

const srcCli = join(process.cwd(), 'src', 'cli.ts')
const tsxLoader = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'loader.mjs')

function cia(home: string, ...args: string[]) {
  const env = { ...process.env, HOME: home }
  delete env['CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT']
  delete env['GRAPH_MCP_ENDPOINT']
  return spawnSync('node', ['--import', tsxLoader, srcCli, ...args], { env, encoding: 'utf8' })
}

describe('cia config reset', () => {
  let home: string
  const configFile = () => join(home, '.chain-insights', 'config.json')

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ci-config-reset-'))
    mkdirSync(join(home, '.chain-insights'), { recursive: true })
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('puts an old debug setup back to the defaults, keeps the wallet address and backs up the old file', () => {
    const old = {
      graphMcpEndpoint: 'http://127.0.0.1:8012/mcp',
      graphMcpAuthToken: 'ci_test_old',
      graphMcpMode: 'debug',
      walletAddress: '0x1111111111111111111111111111111111111111',
      serverPort: 4321,
      version: '1',
    }
    writeFileSync(configFile(), JSON.stringify(old), 'utf8')
    writeFileSync(join(home, '.chain-insights', 'wallet.json'), '{"untouched":true}', 'utf8')

    const run = cia(home, 'config', 'reset')
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('config.json.bak')
    expect(run.stdout).toContain('https://mcp.chain-insights.ai/')

    const now = JSON.parse(readFileSync(configFile(), 'utf8'))
    expect(now.graphMcpEndpoint).toBe('https://mcp.chain-insights.ai/')
    expect(now.graphMcpMode).toBe('paid')
    expect(now.graphMcpAuthToken).toBeUndefined()
    expect(now.walletAddress).toBe(old.walletAddress)
    expect(JSON.parse(readFileSync(`${configFile()}.bak`, 'utf8'))).toEqual(old)
    expect(statSync(configFile()).mode & 0o777).toBe(0o600)
    expect(statSync(`${configFile()}.bak`).mode & 0o777).toBe(0o600)
    expect(readFileSync(join(home, '.chain-insights', 'wallet.json'), 'utf8')).toBe(
      '{"untouched":true}'
    )
  })

  it('writes the defaults when no settings file exists, with no backup', () => {
    const run = cia(home, 'config', 'reset')
    expect(run.status).toBe(0)
    expect(run.stdout).not.toContain('.bak')
    expect(JSON.parse(readFileSync(configFile(), 'utf8')).graphMcpEndpoint).toBe(
      'https://mcp.chain-insights.ai/'
    )
  })

  it('replaces a settings file that is not valid JSON, keeping it as the backup', () => {
    writeFileSync(configFile(), '{ broken', 'utf8')
    const run = cia(home, 'config', 'reset')
    expect(run.status).toBe(0)
    expect(readFileSync(`${configFile()}.bak`, 'utf8')).toBe('{ broken')
    expect(JSON.parse(readFileSync(configFile(), 'utf8')).graphMcpMode).toBe('paid')
  })
})

describe('cia mcp call for the money-flow tools', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ci-mcp-call-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('names money_flows as the CLI route when graph_expand is called', () => {
    const run = cia(home, 'mcp', 'call', 'graph_expand', 'network=robinhood', 'address=0x0')
    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain('cia mcp call money_flows')
  })

  it('asks for the address before money_flows reaches the graph', () => {
    const run = cia(home, 'mcp', 'call', 'money_flows', 'network=robinhood')
    expect(run.status).not.toBe(0)
    expect(run.stderr).toMatch(/address/)
  })

  it('lists config reset in config --help', () => {
    const out = execFileSync('node', ['--import', tsxLoader, srcCli, 'config', '--help'], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home },
    })
    expect(out).toContain('reset')
  })
})
