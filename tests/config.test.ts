import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const DNS_LOOPBACK_LOOKALIKE_ENDPOINTS = [
  'http://127.evil.com/mcp',
  'http://127.0.0.1.evil.com/mcp',
] as const

const CLUSTER_LOCAL_GRAPH_MCP_ENDPOINT =
  'http://chainswarm-chain-insights-graph.chainswarm-staging.svc.cluster.local:8012/mcp'

describe('Config system (FOUND-05)', () => {
  let fakeHome: string
  let prevHome: string | undefined
  let prevWorkspace: string | undefined
  let prevGraphEndpoint: string | undefined
  let prevLegacyGraphEndpoint: string | undefined

  beforeEach(async () => {
    fakeHome = join(tmpdir(), `ci-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(join(fakeHome, '.chain-insights'), { recursive: true })
    prevHome = process.env['HOME']
    prevWorkspace = process.env['CHAIN_INSIGHTS_WORKSPACE']
    prevGraphEndpoint = process.env['CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT']
    prevLegacyGraphEndpoint = process.env['GRAPH_MCP_ENDPOINT']
    process.env['HOME'] = fakeHome
    delete process.env['CHAIN_INSIGHTS_WORKSPACE']
    delete process.env['CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT']
    delete process.env['GRAPH_MCP_ENDPOINT']
  })

  afterEach(async () => {
    process.env['HOME'] = prevHome
    if (prevWorkspace === undefined) delete process.env['CHAIN_INSIGHTS_WORKSPACE']
    else process.env['CHAIN_INSIGHTS_WORKSPACE'] = prevWorkspace
    if (prevGraphEndpoint === undefined) delete process.env['CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT']
    else process.env['CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT'] = prevGraphEndpoint
    if (prevLegacyGraphEndpoint === undefined) delete process.env['GRAPH_MCP_ENDPOINT']
    else process.env['GRAPH_MCP_ENDPOINT'] = prevLegacyGraphEndpoint
    await rm(fakeHome, { recursive: true, force: true })
  })

  it('returns DEFAULT_CONFIG when config file absent', async () => {
    // Dynamic import after HOME override so config path resolves to fakeHome
    const { loadConfig, resetConfigCache } = await import('../src/config/index.js')
    await resetConfigCache()
    const config = await loadConfig()
    expect(config.serverPort).toBe(4321)
    expect(config.version).toBe('1')
    expect(config.graphMcpMode).toBe('paid')
    expect(config.graphMcpEndpoint).toBe('http://127.0.0.1:8012/mcp')
  })

  it('loads config values from config.json on disk', async () => {
    const configPath = join(fakeHome, '.chain-insights', 'config.json')
    await writeFile(configPath, JSON.stringify({ serverPort: 5000, version: '1' }), { mode: 0o600 })
    const { loadConfig, resetConfigCache } = await import('../src/config/index.js')
    await resetConfigCache()
    const config = await loadConfig()
    expect(config.serverPort).toBe(5000)
  })

  it('saveConfig writes file with 0o600 permissions', async () => {
    const { saveConfig, resetConfigCache } = await import('../src/config/index.js')
    await resetConfigCache()
    await saveConfig({ serverPort: 9999 })
    const { stat } = await import('node:fs/promises')
    const st = await stat(join(fakeHome, '.chain-insights', 'config.json'))
    expect((st.mode & 0o777).toString(8)).toBe('600')
  })

  it('saveConfig rejects remote http graphMcpEndpoint values with deterministic validation text', async () => {
    const { saveConfig, resetConfigCache } = await import('../src/config/index.js')
    await resetConfigCache()
    await expect(saveConfig({ graphMcpEndpoint: 'http://staging-mcp.chain-insights.ai/mcp' }))
      .rejects
      .toThrow('graphMcpEndpoint must use https:// for remote hosts')
  })

  it('loadConfig rejects malformed endpoint values instead of silently falling back to defaults', async () => {
    const configPath = join(fakeHome, '.chain-insights', 'config.json')
    await writeFile(configPath, JSON.stringify({ graphMcpEndpoint: 'http://example.com/mcp' }), { mode: 0o600 })
    const { loadConfig, resetConfigCache } = await import('../src/config/index.js')
    await resetConfigCache()
    await expect(loadConfig()).rejects.toThrow(
      `Invalid configuration in ${configPath}: graphMcpEndpoint must use https:// for remote hosts`,
    )
  })

  it('allows Kubernetes service DNS http graphMcpEndpoint values for in-cluster proxy use', async () => {
    const configPath = join(fakeHome, '.chain-insights', 'config.json')
    await writeFile(configPath, JSON.stringify({ graphMcpEndpoint: CLUSTER_LOCAL_GRAPH_MCP_ENDPOINT }), { mode: 0o600 })
    const { loadConfig, resetConfigCache } = await import('../src/config/index.js')
    await resetConfigCache()
    const config = await loadConfig()
    expect(config.graphMcpEndpoint).toBe(CLUSTER_LOCAL_GRAPH_MCP_ENDPOINT)
  })

  it('CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT overrides saved graphMcpEndpoint', async () => {
    const configPath = join(fakeHome, '.chain-insights', 'config.json')
    await writeFile(configPath, JSON.stringify({ graphMcpEndpoint: 'http://127.0.0.1:8012/mcp' }), { mode: 0o600 })
    process.env['CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT'] = 'https://prod-mcp.example.com/mcp'
    const { loadConfig, resetConfigCache } = await import('../src/config/index.js')
    await resetConfigCache()
    const config = await loadConfig()
    expect(config.graphMcpEndpoint).toBe('https://prod-mcp.example.com/mcp')
  })

  it('GRAPH_MCP_ENDPOINT legacy env var overrides saved graphMcpEndpoint', async () => {
    const configPath = join(fakeHome, '.chain-insights', 'config.json')
    await writeFile(configPath, JSON.stringify({ graphMcpEndpoint: 'http://127.0.0.1:8012/mcp' }), { mode: 0o600 })
    process.env['GRAPH_MCP_ENDPOINT'] = 'https://legacy-mcp.example.com/mcp'
    const { loadConfig, resetConfigCache } = await import('../src/config/index.js')
    await resetConfigCache()
    const config = await loadConfig()
    expect(config.graphMcpEndpoint).toBe('https://legacy-mcp.example.com/mcp')
  })

  it('env endpoint override rejects remote http before use', async () => {
    process.env['CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT'] = 'http://staging-mcp.chain-insights.ai/mcp'
    const { loadConfig, resetConfigCache } = await import('../src/config/index.js')
    await resetConfigCache()
    await expect(loadConfig()).rejects.toThrow(
      'Invalid configuration in environment: graphMcpEndpoint must use https:// for remote hosts',
    )
  })

  it('env endpoint override allows Kubernetes service DNS http values', async () => {
    process.env['CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT'] = CLUSTER_LOCAL_GRAPH_MCP_ENDPOINT
    const { loadConfig, resetConfigCache } = await import('../src/config/index.js')
    await resetConfigCache()
    const config = await loadConfig()
    expect(config.graphMcpEndpoint).toBe(CLUSTER_LOCAL_GRAPH_MCP_ENDPOINT)
  })

  it('legacy env endpoint override rejects remote http before use', async () => {
    process.env['GRAPH_MCP_ENDPOINT'] = 'http://staging-mcp.chain-insights.ai/mcp'
    const { loadConfig, resetConfigCache } = await import('../src/config/index.js')
    await resetConfigCache()
    await expect(loadConfig()).rejects.toThrow(
      'Invalid configuration in environment: graphMcpEndpoint must use https:// for remote hosts',
    )
  })

  it('env endpoint override rejects credentials, query strings, and fragments', async () => {
    const invalidEndpoints = [
      ['https://user:pass@example.com/mcp', 'must not include URL credentials'],
      ['https://example.com/mcp?tenant=prod', 'must not include query parameters or URL fragments'],
      ['https://example.com/mcp#prod', 'must not include query parameters or URL fragments'],
    ] as const
    const { loadConfig, resetConfigCache } = await import('../src/config/index.js')

    for (const [endpoint, message] of invalidEndpoints) {
      process.env['CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT'] = endpoint
      await resetConfigCache()
      await expect(loadConfig()).rejects.toThrow(`Invalid configuration in environment: graphMcpEndpoint ${message}`)
    }
  })

  it('saveConfig rejects DNS hostnames that only look like loopback addresses', async () => {
    const { saveConfig, resetConfigCache } = await import('../src/config/index.js')

    for (const endpoint of DNS_LOOPBACK_LOOKALIKE_ENDPOINTS) {
      await resetConfigCache()
      await expect(saveConfig({ graphMcpEndpoint: endpoint }))
        .rejects
        .toThrow('graphMcpEndpoint must use https:// for remote hosts')
    }
  })

  it('loadConfig rejects saved DNS hostnames that only look like loopback addresses', async () => {
    const configPath = join(fakeHome, '.chain-insights', 'config.json')
    const { loadConfig, resetConfigCache } = await import('../src/config/index.js')

    for (const endpoint of DNS_LOOPBACK_LOOKALIKE_ENDPOINTS) {
      await writeFile(configPath, JSON.stringify({ graphMcpEndpoint: endpoint }), { mode: 0o600 })
      await resetConfigCache()
      await expect(loadConfig()).rejects.toThrow(
        `Invalid configuration in ${configPath}: graphMcpEndpoint must use https:// for remote hosts`,
      )
    }
  })

  it('env endpoint overrides reject DNS hostnames that only look like loopback addresses', async () => {
    const envKeys = ['CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT', 'GRAPH_MCP_ENDPOINT'] as const
    const { loadConfig, resetConfigCache } = await import('../src/config/index.js')

    for (const envKey of envKeys) {
      for (const endpoint of DNS_LOOPBACK_LOOKALIKE_ENDPOINTS) {
        process.env[envKey] = endpoint
        await resetConfigCache()
        await expect(loadConfig()).rejects.toThrow(
          'Invalid configuration in environment: graphMcpEndpoint must use https:// for remote hosts',
        )
        delete process.env[envKey]
      }
    }
  })

  it('rejects DNS hostnames that only look like Kubernetes service DNS', async () => {
    const endpoint = 'http://chainswarm-chain-insights-graph.chainswarm-staging.svc.cluster.local.evil.com:8012/mcp'
    const { saveConfig, resetConfigCache } = await import('../src/config/index.js')
    await resetConfigCache()
    await expect(saveConfig({ graphMcpEndpoint: endpoint }))
      .rejects
      .toThrow('graphMcpEndpoint must use https:// for remote hosts')
  })

  it('.env.example documents the Chain Insights Graph endpoint override with a safe local value', async () => {
    const body = await readFile('.env.example', 'utf8')
    expect(body).toContain('CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT=http://127.0.0.1:8012/mcp')
    expect(body).toContain('Remote Chain Insights Graph endpoints must use https://')
  })

  it('activeDataDir prefers CHAIN_INSIGHTS_WORKSPACE over global dataDir', async () => {
    const workspace = join(tmpdir(), `ci-workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    const globalDataDir = join(fakeHome, '.chain-insights-global')
    try {
      const { initWorkspace } = await import('../src/workspace/init.js')
      const { activeDataDir } = await import('../src/workspace/active.js')
      await initWorkspace({ targetDir: workspace })
      process.env['CHAIN_INSIGHTS_WORKSPACE'] = workspace
      expect(activeDataDir(globalDataDir)).toBe(workspace)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
