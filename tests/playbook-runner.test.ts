import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PlaybookDefinition } from '../src/playbooks/schema.js'

// Mock all infrastructure dependencies
vi.mock('../src/db/init.js', () => ({
  getDb: vi.fn(),
  initSchema: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../src/cases/store.js', () => ({
  CaseStore: {
    create: vi.fn(),
    get: vi.fn(),
  },
}))

vi.mock('../src/cases/evidence.js', () => ({
  EvidenceStore: {
    append: vi.fn(),
  },
}))

vi.mock('../src/viz/index.js', () => ({
  generateVisualization: vi.fn(),
}))

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(function() { return this }),
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(function() { return this }),
}))

vi.mock('../src/config/index.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    mcpEndpoint: 'http://localhost:3000/mcp',
    walletPrivateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  }),
}))

vi.mock('../src/mcp/client.js', () => ({
  createMcpFetchClient: vi.fn().mockReturnValue(fetch),
}))

vi.mock('../src/wallet/index.js', () => ({
  isWalletConfigured: vi.fn().mockResolvedValue(true),
  decryptKey: vi.fn().mockResolvedValue('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'),
}))

const SAMPLE_PLAYBOOK: PlaybookDefinition = {
  name: 'test-playbook',
  description: 'Test',
  version: '1.0.0',
  params: [],
  steps: [
    { index: 1, label: 'Step 1: Query', tool: 'blockchain_query', params: { address: '0xabc' } },
    { index: 2, label: 'Step 2: Risk', tool: 'risk_score', params: { address: '0xabc' } },
  ],
}

const TRACE_FUNDS_PLAYBOOK: PlaybookDefinition = {
  name: 'trace-funds',
  description: 'Trace funds',
  version: '1.0.0',
  params: [],
  steps: [
    { index: 1, label: 'Step 1: Trace', tool: 'trace_funds', params: { address: '0xabc' } },
  ],
}

describe('PlaybookRunner', () => {
  let mockClient: {
    connect: ReturnType<typeof vi.fn>
    callTool: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'query result' }],
      }),
      close: vi.fn().mockResolvedValue(undefined),
    }

    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    vi.mocked(Client).mockImplementation(function(this: typeof mockClient) {
      this.connect = mockClient.connect
      this.callTool = mockClient.callTool
      this.close = mockClient.close
    } as unknown as typeof Client)

    const { getDb } = await import('../src/db/init.js')
    const mockConn = { closeSync: vi.fn() }
    vi.mocked(getDb).mockResolvedValue(mockConn as unknown as Awaited<ReturnType<typeof import('../src/db/init.js').getDb>>)

    const { CaseStore } = await import('../src/cases/store.js')
    vi.mocked(CaseStore.create).mockResolvedValue({
      id: 'test-case-123',
      name: 'quick-test-playbook',
      status: 'open',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      tags: ['quick', 'playbook'],
      description: 'Auto-created',
      slug: 'quick-test-playbook',
    })
    vi.mocked(CaseStore.get).mockResolvedValue({
      id: 'existing-case-456',
      name: 'Existing Case',
      status: 'open',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      tags: [],
      description: '',
      slug: 'existing-case',
    })

    const { EvidenceStore } = await import('../src/cases/evidence.js')
    vi.mocked(EvidenceStore.append).mockResolvedValue({ filename: 'ev.md', sha256: 'abc123' })

    const { generateVisualization } = await import('../src/viz/index.js')
    vi.mocked(generateVisualization).mockResolvedValue({ vizId: 'viz-1', htmlPath: '/tmp/viz.html' })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('run() with --dry-run prints all step names and returns without calling client.callTool', async () => {
    const { PlaybookRunner } = await import('../src/playbooks/runner.js')
    const output: string[] = []
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      output.push(msg)
    })

    await PlaybookRunner.run(SAMPLE_PLAYBOOK, { dryRun: true })

    consoleSpy.mockRestore()

    // Should not call MCP client
    expect(mockClient.callTool).not.toHaveBeenCalled()
    // Should print step info
    const outputStr = output.join('\n')
    expect(outputStr).toMatch(/blockchain_query/)
    expect(outputStr).toMatch(/risk_score/)
  })

  it('run() with no --case option calls CaseStore.create() and uses the returned case ID', async () => {
    const { PlaybookRunner } = await import('../src/playbooks/runner.js')
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await PlaybookRunner.run(SAMPLE_PLAYBOOK, {})

    const { CaseStore } = await import('../src/cases/store.js')
    expect(CaseStore.create).toHaveBeenCalledOnce()
    const { EvidenceStore } = await import('../src/cases/evidence.js')
    // Evidence should be stored against the auto-created case ID
    expect(EvidenceStore.append).toHaveBeenCalledWith(
      'test-case-123',
      expect.objectContaining({ source: expect.any(String) })
    )
    vi.restoreAllMocks()
  })

  it('run() calls EvidenceStore.append() once per step with step.tool as source', async () => {
    const { PlaybookRunner } = await import('../src/playbooks/runner.js')
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await PlaybookRunner.run(SAMPLE_PLAYBOOK, {})

    const { EvidenceStore } = await import('../src/cases/evidence.js')
    expect(EvidenceStore.append).toHaveBeenCalledTimes(2)
    expect(EvidenceStore.append).toHaveBeenNthCalledWith(
      1,
      'test-case-123',
      expect.objectContaining({ source: 'blockchain_query' })
    )
    expect(EvidenceStore.append).toHaveBeenNthCalledWith(
      2,
      'test-case-123',
      expect.objectContaining({ source: 'risk_score' })
    )
    vi.restoreAllMocks()
  })

  it('--from 2 skips step index 0 (1-based input → 0-based internal)', async () => {
    const { PlaybookRunner } = await import('../src/playbooks/runner.js')
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await PlaybookRunner.run(SAMPLE_PLAYBOOK, { from: 2 })

    const { EvidenceStore } = await import('../src/cases/evidence.js')
    // Only step 2 should run (1 call)
    expect(EvidenceStore.append).toHaveBeenCalledTimes(1)
    expect(EvidenceStore.append).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ source: 'risk_score' })
    )
    vi.restoreAllMocks()
  })

  it('run() retries up to 3x on timeout (AbortError twice, then succeed)', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')

    const abortError = new Error('The operation was aborted.')
    abortError.name = 'AbortError'

    const retryClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      callTool: vi.fn()
        .mockRejectedValueOnce(abortError)
        .mockRejectedValueOnce(abortError)
        .mockResolvedValue({ content: [{ type: 'text', text: 'success after retry' }] }),
      close: vi.fn().mockResolvedValue(undefined),
    }
    vi.mocked(Client).mockImplementation(function(this: typeof retryClient) {
      this.connect = retryClient.connect
      this.callTool = retryClient.callTool
      this.close = retryClient.close
    } as unknown as typeof Client)

    const { PlaybookRunner } = await import('../src/playbooks/runner.js')
    vi.spyOn(console, 'log').mockImplementation(() => {})

    // Should not throw — 2 AbortErrors then success
    await expect(PlaybookRunner.run({ ...SAMPLE_PLAYBOOK, steps: [SAMPLE_PLAYBOOK.steps[0]!] }, {})).resolves.not.toThrow()
    expect(retryClient.callTool).toHaveBeenCalledTimes(3)
    vi.restoreAllMocks()
  })

  it('run() stops and reports on MCP error (non-timeout)', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')

    const mcpError = new Error('MCP tool not found')

    const errClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      callTool: vi.fn().mockRejectedValue(mcpError),
      close: vi.fn().mockResolvedValue(undefined),
    }
    vi.mocked(Client).mockImplementation(function(this: typeof errClient) {
      this.connect = errClient.connect
      this.callTool = errClient.callTool
      this.close = errClient.close
    } as unknown as typeof Client)

    const { PlaybookRunner } = await import('../src/playbooks/runner.js')
    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((msg: string) => output.push(msg))
    vi.spyOn(console, 'error').mockImplementation((msg: string) => output.push(msg))

    await expect(PlaybookRunner.run({ ...SAMPLE_PLAYBOOK, steps: [SAMPLE_PLAYBOOK.steps[0]!] }, {})).rejects.toThrow()
    const outputStr = output.join('\n')
    expect(outputStr).toMatch(/Step 1 failed/)
    vi.restoreAllMocks()
  })

  it('run() calls generateVisualization after all steps when playbookName === trace-funds', async () => {
    const { PlaybookRunner } = await import('../src/playbooks/runner.js')
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await PlaybookRunner.run(TRACE_FUNDS_PLAYBOOK, {})

    const { generateVisualization } = await import('../src/viz/index.js')
    expect(generateVisualization).toHaveBeenCalledOnce()
    vi.restoreAllMocks()
  })

  it('run() does NOT crash when generateVisualization throws "No Transaction Data"', async () => {
    const { generateVisualization } = await import('../src/viz/index.js')
    vi.mocked(generateVisualization).mockRejectedValue(new Error('No Transaction Data'))

    const { PlaybookRunner } = await import('../src/playbooks/runner.js')
    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((msg: string) => output.push(msg))

    // Should not throw even though generateVisualization throws
    await expect(PlaybookRunner.run(TRACE_FUNDS_PLAYBOOK, {})).resolves.not.toThrow()
    const outputStr = output.join('\n')
    expect(outputStr).toMatch(/No transaction data/)
    vi.restoreAllMocks()
  })

  it('run() with existing --case option calls CaseStore.get() (not create)', async () => {
    const { PlaybookRunner } = await import('../src/playbooks/runner.js')
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await PlaybookRunner.run(SAMPLE_PLAYBOOK, { caseId: 'existing-case-456' })

    const { CaseStore } = await import('../src/cases/store.js')
    expect(CaseStore.get).toHaveBeenCalledWith('existing-case-456')
    expect(CaseStore.create).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('process.stdin.isTTY falsy → payment failure aborts instead of prompting readline', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')

    const paymentError = new Error('HTTP 402 Payment Required')

    const payClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      callTool: vi.fn().mockRejectedValue(paymentError),
      close: vi.fn().mockResolvedValue(undefined),
    }
    vi.mocked(Client).mockImplementation(function(this: typeof payClient) {
      this.connect = payClient.connect
      this.callTool = payClient.callTool
      this.close = payClient.close
    } as unknown as typeof Client)

    // Simulate non-TTY environment
    const originalIsTTY = process.stdin.isTTY
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })

    const { PlaybookRunner } = await import('../src/playbooks/runner.js')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    // Should throw (abort) without prompting
    await expect(PlaybookRunner.run({ ...SAMPLE_PLAYBOOK, steps: [SAMPLE_PLAYBOOK.steps[0]!] }, {})).rejects.toThrow()

    // Restore isTTY
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true })
    vi.restoreAllMocks()
  })
})
