import { Command, Option } from 'commander'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { PACKAGE_INFO, PACKAGE_VERSION } from './version.js'

// Resolve bin/install.cjs relative to this file's location in dist/
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const installerPath = path.resolve(__dirname, '..', 'bin', 'install.cjs')

const program = new Command()

program
  .name('chain-insights')
  .description('AML investigation toolkit for blockchain analysis')
  .version(PACKAGE_INFO.version)
  .option('--claude', 'Install Claude Code skills globally to ~/.claude/skills/')
  .option('--codex', 'Install Codex skills globally to ~/.codex/skills/ and register MCP')
  .option('--hermes', 'Install Hermes skills globally to ~/.hermes/skills/chain-insights/ and register MCP')

// Handle installer flags when invoked with no subcommand (bare `chain-insights --claude`)
const rawArgs = process.argv.slice(2)
const installerFlags = rawArgs.filter(a => a === '--claude' || a === '--codex' || a === '--hermes')
if (installerFlags.length > 0 && !rawArgs.some(a => !a.startsWith('-'))) {
  try {
    execFileSync(process.execPath, [installerPath, ...installerFlags], { stdio: 'inherit' })
  } catch (err) {
    console.error('Installation failed:', (err as Error).message)
    process.exit(1)
  }
  process.exit(0)
}

if (rawArgs[0] === 'mcp' && rawArgs[1] === 'trace-funds') {
  console.error("error: unknown command 'trace-funds'")
  process.exit(1)
}

async function resolveCaseSelector(input: string): Promise<string> {
  const { resolveCaseSelector } = await import('./cases/selector.js')
  return resolveCaseSelector(input)
}

async function scopeCasesToInvocationDir(): Promise<void> {
  if (process.env['CHAIN_INSIGHTS_CASES_ROOT']?.trim()) return
  const { activeCasesRoot } = await import('./workspace/active.js')
  process.env['CHAIN_INSIGHTS_CASES_ROOT'] = activeCasesRoot()
}

async function showCaseContext(caseSelector: string): Promise<void> {
  const { CaseStore } = await import('./cases/index.js')
  const caseId = await resolveCaseSelector(caseSelector)
  const ctx = await CaseStore.loadContext(caseId)
  console.log(`\n=== Case: ${ctx.case.id} ===`)
  console.log(`Name:   ${ctx.case.name}`)
  console.log(`Status: ${ctx.case.status}`)
  console.log(`Tags:   ${ctx.case.tags.join(', ') || 'none'}`)
  console.log(`Evidence files: ${ctx.evidenceCount}`)
  console.log(`Dossiers: ${ctx.dossierSummaries.length}`)
  if (ctx.lastSession) {
    console.log(`\n--- Last Session (${ctx.lastSession.sessionId}) ---`)
    console.log(ctx.lastSession.body.slice(0, 500))
  } else {
    console.log('\nNo previous sessions.')
  }
  if (ctx.dossierSummaries.length > 0) {
    console.log('\n--- Entity Dossiers ---')
    for (const d of ctx.dossierSummaries) {
      console.log(`  ${d.address} [${d.type}] tags: ${d.riskTags || 'none'}`)
    }
  }
}

function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`)
  return parsed
}

function optionalNumberArg(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') return optionalNumber(value)
  throw new Error(`Invalid number for ${name}: ${String(value)}`)
}

type ScamTopologyActivityPolicyModeArg = 'node_relative_only' | 'global_incident_only'

function optionalScamTopologyActivityPolicy(value: unknown): ScamTopologyActivityPolicyModeArg | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (value === 'node_relative_only' || value === 'global_incident_only') return value
  throw new Error('activity_policy must be one of: node_relative_only, global_incident_only')
}

async function withGraphMcpClient<T>(name: string, fn: (client: import('@modelcontextprotocol/sdk/client/index.js').Client, config: Awaited<ReturnType<typeof import('./config/index.js').loadConfig>>) => Promise<T>): Promise<T> {
  const { loadConfig } = await import('./config/index.js')
  const config = await loadConfig()
  const { createConfiguredGraphMcpFetch, resolveGraphMcpEndpoint } = await import('./mcp/client.js')
  const paymentFetch = await createConfiguredGraphMcpFetch(config)
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
  const client = new Client({ name, version: PACKAGE_VERSION })
  await client.connect(new StreamableHTTPClientTransport(new URL(resolveGraphMcpEndpoint(config)), { fetch: paymentFetch }))
  try {
    return await fn(client, config)
  } finally {
    await client.close()
  }
}

function printMcpTextContent(result: { content?: Array<{ type: string; text?: string }> }): void {
  for (const item of result.content ?? []) {
    if (item.type === 'text') console.log(item.text)
  }
}

async function printNetworkCapabilities(opts: { json?: boolean }): Promise<void> {
  const { loadConfig } = await import('./config/index.js')
  const { fetchNetworkCapabilities, formatNetworkCapabilities } = await import('./mcp/capabilities.js')
  const document = await fetchNetworkCapabilities(await loadConfig())
  if (opts.json) {
    console.log(JSON.stringify(document, null, 2))
  } else {
    console.log(formatNetworkCapabilities(document))
  }
}

program
  .command('networks')
  .alias('network')
  .description('List supported graph networks, capability layers, retention, and freshness')
  .option('--json', 'Print raw capability JSON')
  .action(async (opts: { json?: boolean }) => {
    try {
      await printNetworkCapabilities(opts)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

program
  .command('serve')
  .description('Start local visualization server')
  .option('-p, --port <number>', 'Port to bind (default: 4321)', '4321')
  .action(async (opts: { port: string }) => {
    try {
      const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
      const workspaceRoot = requireWorkspaceRoot()
      const { startServer } = await import('./server/index.js')
      console.log(`Workspace: ${workspaceRoot}`)
      startServer(parseInt(opts.port, 10))
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

program
  .command('status')
  .description('Show toolkit status and configuration')
  .action(async () => {
    const { loadConfig } = await import('./config/index.js')
    const { findActiveWorkspace, activeDataDir } = await import('./workspace/active.js')
    const config = await loadConfig()
    const workspace = findActiveWorkspace()
    const graphMcpStatus = config.graphMcpMode === 'debug' && config.graphMcpAuthToken?.trim()
      ? 'bearer access mode'
      : `${config.graphMcpMode} mode`
    console.log('Config: ', activeDataDir(config.dataDir))
    if (workspace) console.log('Workspace:', workspace.root)
    console.log('Server: ', `http://127.0.0.1:${config.serverPort}`)
    console.log('Graph MCP:', graphMcpStatus)
    console.log('Graph endpoint:', config.graphMcpEndpoint)
  })

program
  .command('debug')
  .description('Configure Graph MCP debug mode')
  .addCommand(
    new Command('on')
      .description('Enable Graph MCP debug mode without x402 payments')
      .requiredOption('--token <token>', 'Debug bearer token')
      .option('--endpoint <url>', 'Graph MCP endpoint')
      .action(async (opts: { token: string; endpoint?: string }) => {
        try {
          const { saveConfig } = await import('./config/index.js')
          await saveConfig({
            graphMcpMode: 'debug',
            graphMcpAuthToken: opts.token,
            ...(opts.endpoint ? { graphMcpEndpoint: opts.endpoint } : {}),
          })
          console.log('Graph MCP debug mode enabled')
          if (opts.endpoint) console.log(`Graph endpoint: ${opts.endpoint}`)
          console.log('Payments: disabled for Graph MCP calls')
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
  .addCommand(
    new Command('off')
      .description('Disable Graph MCP debug mode and use paid x402 calls')
      .action(async () => {
        try {
          const { saveConfig } = await import('./config/index.js')
          await saveConfig({ graphMcpMode: 'paid', graphMcpAuthToken: '' })
          console.log('Graph MCP debug mode disabled')
          console.log('Payments: enabled for Graph MCP calls')
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
  .addCommand(
    new Command('status')
      .description('Show Graph MCP payment/debug mode')
      .action(async () => {
        try {
          const { loadConfig } = await import('./config/index.js')
          const config = await loadConfig()
          console.log(`Graph MCP mode: ${config.graphMcpMode}`)
          console.log(`Graph endpoint: ${config.graphMcpEndpoint}`)
          console.log(`Debug token:    ${config.graphMcpAuthToken?.trim() ? 'configured' : 'not configured'}`)
          console.log(`Payments:       ${config.graphMcpMode === 'debug' ? 'disabled' : 'enabled'}`)
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )

program
  .command('access-key')
  .description('Configure Graph MCP test access key mode')
  .addCommand(
    new Command('set')
      .description('Use a Graph MCP test access key without x402 payments')
      .argument('<key>', 'Test access key')
      .option('--endpoint <url>', 'Graph MCP endpoint')
      .action(async (key: string, opts: { endpoint?: string }) => {
        try {
          const normalizedKey = key.trim()
          if (!normalizedKey) throw new Error('Test access key is required')
          const { saveConfig } = await import('./config/index.js')
          await saveConfig({
            graphMcpMode: 'debug',
            graphMcpAuthToken: normalizedKey,
            ...(opts.endpoint ? { graphMcpEndpoint: opts.endpoint } : {}),
          })
          console.log('Graph MCP test access key configured')
          if (opts.endpoint) console.log(`Graph endpoint: ${opts.endpoint}`)
          console.log('Payments: disabled when the server accepts this key')
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
  .addCommand(
    new Command('clear')
      .description('Remove the Graph MCP test access key and use paid x402 calls')
      .action(async () => {
        try {
          const { saveConfig } = await import('./config/index.js')
          await saveConfig({ graphMcpMode: 'paid', graphMcpAuthToken: '' })
          console.log('Graph MCP test access key cleared')
          console.log('Payments: enabled for Graph MCP calls')
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
  .addCommand(
    new Command('status')
      .description('Show Graph MCP test access key status')
      .action(async () => {
        try {
          const { loadConfig } = await import('./config/index.js')
          const config = await loadConfig()
          console.log(`Graph endpoint: ${config.graphMcpEndpoint}`)
          console.log(`Access key:     ${config.graphMcpAuthToken?.trim() ? 'configured' : 'not configured'}`)
          console.log(`Payments:       ${config.graphMcpAuthToken?.trim() ? 'disabled when accepted by server' : 'enabled'}`)
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )

program
  .command('init')
  .description('Initialize an investigation workspace')
  .argument('[dir]', 'Workspace directory to initialize', '.')
  .option('--force', 'Overwrite existing workspace files')
  .action(async (dir: string, opts: { force?: boolean }) => {
    try {
      const { initWorkspace } = await import('./workspace/init.js')
      const result = await initWorkspace({ targetDir: dir, force: opts.force })
      console.log(`Workspace initialized: ${result.workspaceRoot}`)
      console.log(`Files written: ${result.filesWritten.length}`)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

program
  .command('setup')
  .description('Configure external MCP clients')
  .addCommand(
    new Command('claude-desktop')
      .alias('claude')
      .description('Install or update the Claude Desktop MCP server entry')
      .option('--config <path>', 'Path to claude_desktop_config.json')
      .option('--dry-run', 'Print the intended change without writing files')
      .action(async (opts: { config?: string; dryRun?: boolean }) => {
        try {
          const { setupClaudeDesktop } = await import('./claude-desktop/setup.js')
          const result = await setupClaudeDesktop({
            configPath: opts.config,
            dryRun: opts.dryRun,
          })

          console.log(`Claude Desktop config: ${result.configPath}`)
          console.log('MCP server:            chain-insights')
          console.log(`Command:               ${result.command}`)
          console.log(`Args:                  ${result.args.join(' ')}`)
          if (result.dryRun) {
            console.log(`Dry run:               ${result.changed ? 'would update config' : 'already up to date'}`)
          } else if (result.changed) {
            console.log(`Updated:               yes`)
            if (result.backupPath) console.log(`Backup:                ${result.backupPath}`)
          } else {
            console.log('Updated:               already up to date')
          }
          console.log('Reload required:       quit and reopen Claude Desktop; it does not hot-reload MCP config.')
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )

program
  .command('config')
  .description('Read or write configuration values')
  .addCommand(
    new Command('get')
      .argument('<key>', 'Config key to read')
      .action(async (key: string) => {
        const { loadConfig } = await import('./config/index.js')
        const { CONFIG_KEYS } = await import('./config/schema.js')
        if (!CONFIG_KEYS.includes(key as typeof CONFIG_KEYS[number])) {
          console.error(`Unknown config key: ${key}`)
          process.exit(1)
        }
        const config = await loadConfig()
        const value = (config as Record<string, unknown>)[key]
        console.log(value ?? '')
      })
  )
  .addCommand(
    new Command('set')
      .argument('<key>', 'Config key to write')
      .argument('<value>', 'Value to set')
      .action(async (key: string, value: string) => {
        // D-01: walletPrivateKey is intercepted before saveConfig — the raw private key
        // must NEVER be written to config.json.
        if (key === 'walletPrivateKey') {
          try {
            const { setWalletPrivateKey } = await import('./wallet/index.js')
            const address = await setWalletPrivateKey(value)
            console.log('Wallet private key encrypted and stored in ~/.chain-insights/wallet.json')
            console.log(`Wallet address: ${address}`)
          } catch (err) {
            console.error((err as Error).message)
            process.exit(1)
          }
          return // MUST return — walletPrivateKey must never reach saveConfig or config.json
        }
        const { loadConfig, saveConfig } = await import('./config/index.js')
        const { CONFIG_KEYS, DEFAULT_CONFIG } = await import('./config/schema.js')
        const current = await loadConfig()
        if (!CONFIG_KEYS.includes(key as typeof CONFIG_KEYS[number])) {
          console.error(`Unknown config key: ${key}`)
          process.exit(1)
        }
        const existing = (current as Record<string, unknown>)[key]
        const defaultValue = (DEFAULT_CONFIG as Record<string, unknown>)[key]
        const coerced = typeof existing === 'number' || typeof defaultValue === 'number' ? Number(value) : value
        await saveConfig({ [key]: coerced } as Parameters<typeof saveConfig>[0])
        const displayed = key.toLowerCase().includes('token') ? '[redacted]' : coerced
        console.log(`Set ${key} = ${displayed}`)
      })
  )

program
  .command('wallet')
  .description('Manage the local Base USDC payment wallet')
  .addCommand(
    new Command('address')
      .description('Print the local payment wallet address')
      .action(async () => {
        try {
          const { getWalletAccount } = await import('./wallet/tools.js')
          const account = await getWalletAccount()
          console.log(account.address)
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
  .addCommand(
    new Command('balance')
      .description('Show the local payment wallet Base USDC balance')
      .action(async () => {
        try {
          const { getWalletBalanceText } = await import('./wallet/tools.js')
          console.log(await getWalletBalanceText())
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
  .addCommand(
    new Command('ready')
      .description('Check and prepare the wallet for paid GraphRAG MCP calls')
      .option('--check-only', 'Only check readiness; do not submit the one-time payment setup')
      .addOption(new Option('--no-approve', 'Deprecated alias for --check-only').hideHelp())
      .option('--payment-usdc <amount>', 'USDC setup cap to prepare for paid calls', '1')
      .addOption(new Option('--approval-usdc <amount>', 'Deprecated alias for --payment-usdc').hideHelp())
      .option('--json', 'Print machine-readable readiness metadata')
      .action(async (opts: { checkOnly?: boolean; approve?: boolean; paymentUsdc?: string; approvalUsdc?: string; json?: boolean }) => {
        try {
          const { formatWalletReadiness, parsePaymentApprovalUnits, prepareWalletForPaidCalls } = await import('./wallet/tools.js')
          const minimumApprovalUnits = parsePaymentApprovalUnits(opts.paymentUsdc ?? opts.approvalUsdc ?? '1')
          const result = await prepareWalletForPaidCalls({
            minimumApprovalUnits,
            approve: opts.checkOnly ? false : opts.approve !== false,
          })

          if (opts.json) {
            console.log(JSON.stringify(result, (_key, value) => (
              typeof value === 'bigint' ? value.toString() : value
            ), 2))
            return
          }

          console.log(formatWalletReadiness(result.readiness, result.approval))
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
  .addCommand(
    new Command('topup')
      .description('Open a local browser page to top up the payment wallet')
      .option('--no-open', 'Print the top-up URL without opening a browser')
      .option('--json', 'Print machine-readable top-up metadata')
      .action(async (opts: { open?: boolean; json?: boolean }) => {
        try {
          const { buildTopupInfo, getWalletAccount } = await import('./wallet/tools.js')
          const { startTopupServer } = await import('./wallet/topup-server.js')
          const account = await getWalletAccount()
          const url = await startTopupServer(account)
          const info = buildTopupInfo(account.address, url)

          if (opts.json) {
            console.log(JSON.stringify(info, null, 2))
          } else {
            console.log(`Top-up URL: ${url}`)
            console.log(`Wallet:     ${account.address}`)
            console.log('Network:    Base')
            console.log('Token:      USDC')
            console.log('Press Ctrl+C to stop the top-up server.')
          }

          if (opts.open !== false) {
            const open = (await import('open')).default
            await open(url)
          }
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )

program
  .command('mcp')
  .description('Interact with the Chain Insights MCP endpoint')
  .allowExcessArguments(false)
  .addCommand(
    new Command('networks')
      .description('List supported graph networks, capability layers, retention, and freshness')
      .option('--json', 'Print raw capability JSON')
      .action(async (opts: { json?: boolean }) => {
        try {
          await printNetworkCapabilities(opts)
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
  .addCommand(
    new Command('tools')
      .description('List available MCP tools (cached 24h)')
      .option('--refresh', 'Force refresh schema cache')
      .action(async (opts: { refresh?: boolean }) => {
        try {
          const { loadSchema, saveSchema } = await import('./mcp/schema-cache.js')
          const { formatToolsTable } = await import('./mcp/format.js')
          const { visibleRemoteTools } = await import('./mcp/tool-visibility.js')
          const { loadConfig } = await import('./config/index.js')
          const { createConfiguredGraphMcpFetch, resolveGraphMcpEndpoint } = await import('./mcp/client.js')
          const config = await loadConfig()
          const graphMcpEndpoint = resolveGraphMcpEndpoint(config)
          let tools = opts.refresh ? null : await loadSchema(graphMcpEndpoint)
          if (!tools) {
            const paymentFetch = await createConfiguredGraphMcpFetch(config)
            const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
            const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
            const client = new Client({ name: 'chain-insights-cli', version: PACKAGE_VERSION })
            await client.connect(new StreamableHTTPClientTransport(new URL(graphMcpEndpoint), { fetch: paymentFetch }))
            try {
              const result = await client.listTools()
              tools = result.tools as Array<{ name: string; description?: string }>
              await saveSchema(tools, graphMcpEndpoint)
            } finally {
              await client.close()
            }
          }
          console.log(formatToolsTable(visibleRemoteTools(tools)))
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
  .addCommand(
    new Command('address-risk')
      .description('Screen an address for risk, exchange behavior, and optional compare_address connection risk')
      .requiredOption('--address <address>', 'Full blockchain address to screen')
      .requiredOption('--network <network>', 'Network to query. Run `cia mcp networks` for supported networks.')
      .option('--compare-address <address>', 'Optional second address for connection-risk compare mode')
      .option('--remote', 'Force remote MCP tool call instead of local Chain Insights recipe')
      .action(async (opts: { address: string; network: string; compareAddress?: string; remote?: boolean }) => {
        try {
          await withGraphMcpClient('chain-insights-cli-address-risk', async (client) => {
            if (opts.remote) {
              const result = await client.callTool({
                name: 'address_risk',
                arguments: {
                  address: opts.address,
                  network: opts.network,
                  ...(opts.compareAddress ? { compare_address: opts.compareAddress } : {}),
                },
              })
              printMcpTextContent(result as { content?: Array<{ type: string; text?: string }> })
              return
            }
            const { addressRisk } = await import('./investigation/public-tools.js')
            const result = await addressRisk(client, {
              address: opts.address,
              network: opts.network,
              compareAddress: opts.compareAddress,
            })
            console.log(result.summaryText)
          })
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
  .addCommand(
    new Command('track-funds')
      .description('Trace trusted/victim addresses and optional known untrusted/scammer addresses')
      .requiredOption('--trusted-addresses <addresses>', 'Comma-separated full trusted/victim addresses, max 5')
      .requiredOption('--network <network>', 'Network to query. Run `cia mcp networks` for supported networks.')
      .option('--untrusted-addresses <addresses>', 'Comma-separated full known untrusted/scammer addresses, max 5')
      .option('--case <id>', 'Case ID to attach compact evidence pointers')
      .option('--max-hops <number>', 'Maximum trace hops, 1-5')
      .option('--per-address-limit <number>', 'Maximum exchange paths/results per address, 1-10')
      .option('--min-amount-sum <number>', 'Minimum r.amount_sum for traced edges')
      .option('--remote', 'Force remote MCP tool call instead of local Chain Insights recipe')
      .action(async (opts: {
        trustedAddresses: string
        network: string
        untrustedAddresses?: string
        case?: string
        maxHops?: string
        perAddressLimit?: string
        minAmountSum?: string
        remote?: boolean
      }) => {
        try {
          const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
          requireWorkspaceRoot()
          await withGraphMcpClient('chain-insights-cli-track-funds', async (client, config) => {
            if (opts.remote) {
              const result = await client.callTool({
                name: 'track_funds',
                arguments: {
                  trusted_addresses: opts.trustedAddresses,
                  network: opts.network,
                  ...(opts.untrustedAddresses ? { untrusted_addresses: opts.untrustedAddresses } : {}),
                },
              })
              printMcpTextContent(result as { content?: Array<{ type: string; text?: string }> })
              return
            }
            const { trackFunds } = await import('./investigation/public-tools.js')
            const caseId = opts.case ? await resolveCaseSelector(opts.case) : undefined
            const result = await trackFunds(client, config, {
              trustedAddresses: opts.trustedAddresses,
              untrustedAddresses: opts.untrustedAddresses,
              network: opts.network,
              caseId,
              maxHops: optionalNumber(opts.maxHops),
              perAddressLimit: optionalNumber(opts.perAddressLimit),
              minAmountSum: optionalNumber(opts.minAmountSum),
            })
            console.log(result.summaryText)
            console.log(JSON.stringify(result.structuredContent, null, 2))
          })
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
  .addCommand(
    new Command('scam-topology')
      .description('Build victim-incident scam topology and ML-ready scam labels')
      .requiredOption('--network <network>', 'Network to query. Run `cia mcp networks` for supported networks.')
      .requiredOption('--victim-address <address>', 'Full victim/source address that anchors the incident')
      .requiredOption('--incident-timestamp-ms <milliseconds>', 'Earliest known incident transfer timestamp in milliseconds')
      .option('--max-hops <number>', 'Maximum trace hops, default 16, max 64')
      .option('--activity-policy <mode>', 'Traversal activity policy: node_relative_only or global_incident_only', 'node_relative_only')
      .option('--case <id>', 'Case ID to attach compact evidence pointers')
      .action(async (opts: {
        network: string
        victimAddress: string
        incidentTimestampMs: string
        maxHops?: string
        activityPolicy?: string
        case?: string
      }) => {
        try {
          const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
          requireWorkspaceRoot()
          await withGraphMcpClient('chain-insights-cli-scam-topology', async (client, config) => {
            const { scamTopology } = await import('./investigation/public-tools.js')
            const incidentTimestampMs = optionalNumber(opts.incidentTimestampMs)
            if (incidentTimestampMs === undefined) throw new Error('incident-timestamp-ms is required')
            const caseId = opts.case ? await resolveCaseSelector(opts.case) : undefined
            const result = await scamTopology(client, config, {
              victimAddress: opts.victimAddress,
              network: opts.network,
              maxHops: optionalNumber(opts.maxHops),
              incidentTimestampMs,
              activityPolicyMode: optionalScamTopologyActivityPolicy(opts.activityPolicy),
              caseId,
            })
            console.log(result.summaryText)
            console.log(JSON.stringify(result.structuredContent, null, 2))
          })
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
  .addCommand(
    new Command('stake-insights')
      .description('Explain Bittensor staking behavior around an address, coldkey, or hotkey')
      .requiredOption('--network <network>', 'Network to query. Run `cia mcp networks` for supported networks.')
      .option('--address <address>', 'Full Bittensor address to inspect as either coldkey or hotkey')
      .option('--coldkey <address>', 'Full Bittensor coldkey address to inspect')
      .option('--hotkey <address>', 'Full Bittensor hotkey address to inspect')
      .option('--netuid <number>', 'Optional subnet netuid filter')
      .option('--start-timestamp-ms <milliseconds>', 'Optional inclusive lower activity timestamp bound')
      .option('--end-timestamp-ms <milliseconds>', 'Optional inclusive upper activity timestamp bound')
      .option('--start-block <number>', 'Optional start block. Current stake graph parity may require timestamp windows instead.')
      .option('--end-block <number>', 'Optional end block. Current stake graph parity may require timestamp windows instead.')
      .option('--depth <number>', 'Optional expansion depth limit, default 1, max 3')
      .action(async (opts: {
        network: string
        address?: string
        coldkey?: string
        hotkey?: string
        netuid?: string
        startTimestampMs?: string
        endTimestampMs?: string
        startBlock?: string
        endBlock?: string
        depth?: string
      }) => {
        try {
          await withGraphMcpClient('chain-insights-cli-stake-insights', async (client) => {
            const { stakeInsights } = await import('./investigation/public-tools.js')
            const result = await stakeInsights(client, {
              network: opts.network,
              address: opts.address,
              coldkey: opts.coldkey,
              hotkey: opts.hotkey,
              netuid: optionalNumber(opts.netuid),
              startTimestampMs: optionalNumber(opts.startTimestampMs),
              endTimestampMs: optionalNumber(opts.endTimestampMs),
              startBlock: optionalNumber(opts.startBlock),
              endBlock: optionalNumber(opts.endBlock),
              depth: optionalNumber(opts.depth),
            })
            console.log(result.summaryText)
            console.log(JSON.stringify(result.structuredContent, null, 2))
          })
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
  .addCommand(
    new Command('call')
      .description('Call an MCP tool directly (debug)')
      .argument('<tool>', 'Tool name to call')
      .argument('[args...]', 'Key=value arguments (e.g. address=0x1234 chain=ethereum)')
      .action(async (tool: string, rawArgs: string[]) => {
        try {
          const { parseMcpCallArgs } = await import('./mcp/call-args.js')
          const { assertPublicMcpToolName } = await import('./mcp/tool-visibility.js')
          const args = parseMcpCallArgs(rawArgs)
          assertPublicMcpToolName(tool)
          await withGraphMcpClient('chain-insights-cli-call', async (client, config) => {
            if (tool === 'address_risk') {
              const { addressRisk } = await import('./investigation/public-tools.js')
              const result = await addressRisk(client, {
                address: String(args['address'] ?? ''),
                network: String(args['network'] ?? ''),
                compareAddress: args['compare_address'] === undefined ? undefined : String(args['compare_address']),
              })
              console.log(result.summaryText)
              return
            }
            if (tool === 'track_funds') {
              const { trackFunds } = await import('./investigation/public-tools.js')
              const result = await trackFunds(client, config, {
                trustedAddresses: args['trusted_addresses'] as string | string[] | undefined ?? '',
                untrustedAddresses: args['untrusted_addresses'] as string | string[] | undefined,
                network: String(args['network'] ?? ''),
                caseId: args['case_id'] === undefined ? undefined : String(args['case_id']),
                maxHops: typeof args['max_hops'] === 'number' ? args['max_hops'] : undefined,
                perAddressLimit: typeof args['per_address_limit'] === 'number' ? args['per_address_limit'] : undefined,
                minAmountSum: typeof args['min_amount_sum'] === 'number' ? args['min_amount_sum'] : undefined,
              })
              console.log(result.summaryText)
              console.log(JSON.stringify(result.structuredContent, null, 2))
              return
            }
            if (tool === 'scam_topology') {
              const { scamTopology } = await import('./investigation/public-tools.js')
              const victimAddress = String(args['victim_address'] ?? '').trim()
              if (!victimAddress) throw new Error('victim_address is required')
              const incidentTimestampMs = optionalNumberArg(args['incident_timestamp_ms'], 'incident_timestamp_ms')
              if (incidentTimestampMs === undefined) throw new Error('incident_timestamp_ms is required')
              const result = await scamTopology(client, config, {
                victimAddress,
                network: String(args['network'] ?? ''),
                caseId: args['case_id'] === undefined ? undefined : String(args['case_id']),
                maxHops: typeof args['max_hops'] === 'number' ? args['max_hops'] : undefined,
                incidentTimestampMs,
                activityPolicyMode: optionalScamTopologyActivityPolicy(args['activity_policy']),
              })
              console.log(result.summaryText)
              console.log(JSON.stringify(result.structuredContent, null, 2))
              return
            }
            if (tool === 'stake_insights') {
              const { stakeInsights } = await import('./investigation/public-tools.js')
              const result = await stakeInsights(client, {
                network: String(args['network'] ?? ''),
                address: args['address'] === undefined ? undefined : String(args['address']),
                coldkey: args['coldkey'] === undefined ? undefined : String(args['coldkey']),
                hotkey: args['hotkey'] === undefined ? undefined : String(args['hotkey']),
                netuid: optionalNumberArg(args['netuid'], 'netuid'),
                startTimestampMs: optionalNumberArg(args['start_timestamp_ms'], 'start_timestamp_ms'),
                endTimestampMs: optionalNumberArg(args['end_timestamp_ms'], 'end_timestamp_ms'),
                startBlock: optionalNumberArg(args['start_block'], 'start_block'),
                endBlock: optionalNumberArg(args['end_block'], 'end_block'),
                depth: optionalNumberArg(args['depth'] ?? args['max_hops'], 'depth'),
              })
              console.log(result.summaryText)
              console.log(JSON.stringify(result.structuredContent, null, 2))
              return
            }
            const result = await client.callTool({ name: tool, arguments: args })
            printMcpTextContent(result as { content?: Array<{ type: string; text?: string }> })
          })
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )

const caseCommand = new Command('case')
  .description('Manage investigation cases')
  .hook('preAction', async () => {
    await scopeCasesToInvocationDir()
  })
  .addCommand(
    new Command('open')
      .description('Open a new investigation case')
      .argument('<name>', 'Case name (e.g. "Tornado Mixer Investigation")')
      .option('--tags <tags>', 'Comma-separated tags (e.g. aml,mixer,defi)', '')
      .option('--description <desc>', 'Brief description of the investigation', '')
      .action(async (name: string, opts: { tags: string; description: string }) => {
        try {
          if (/^[1-9]\d*$/.test(name.trim())) {
            throw new Error('Numeric case names look like list selectors. Use a descriptive case name, e.g. `cia case open "Tracking stolen funds from <address>"`.')
          }
          const { CaseStore } = await import('./cases/index.js')
          const tags = opts.tags ? opts.tags.split(',').map(t => t.trim()).filter(Boolean) : []
          const c = await CaseStore.create({ name, tags, description: opts.description })
          const { casesRoot } = await import('./cases/store.js')
          console.log(`Case opened: ${c.id}`)
          console.log(`Directory:   ${path.join(casesRoot(), c.id)}/`)
          console.log(`Status:      ${c.status}`)
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
  .addCommand(
    new Command('activate')
      .description('Activate a case (set status to active)')
      .argument('<case-id>', 'Case ID to activate')
      .action(async (caseSelector: string) => {
        try {
          const { CaseStore } = await import('./cases/index.js')
          const caseId = await resolveCaseSelector(caseSelector)
          const c = await CaseStore.setStatus(caseId, 'active')
          console.log(`Case ${c.id} is now: active`)
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
  .addCommand(
    new Command('suspend')
      .description('Suspend a case (set status to suspended)')
      .argument('<case-id>', 'Case ID to suspend')
      .action(async (caseSelector: string) => {
        try {
          const { CaseStore } = await import('./cases/index.js')
          const caseId = await resolveCaseSelector(caseSelector)
          const c = await CaseStore.setStatus(caseId, 'suspended')
          console.log(`Case ${c.id} is now: suspended`)
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
  .addCommand(
    new Command('close')
      .description('Close a case permanently')
      .argument('<case-id>', 'Case ID to close')
      .action(async (caseSelector: string) => {
        try {
          const { CaseStore } = await import('./cases/index.js')
          const caseId = await resolveCaseSelector(caseSelector)
          const c = await CaseStore.setStatus(caseId, 'closed')
          console.log(`Case ${c.id} is now: closed`)
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
  .addCommand(
    new Command('list')
      .description('List all investigation cases')
      .option('--status <status>', 'Filter by status (open|active|suspended|closed)')
      .action(async (opts: { status?: string }) => {
        try {
          const { CaseStore } = await import('./cases/index.js')
          const cases = await CaseStore.list()
          const filtered = opts.status ? cases.filter(c => c.status === opts.status) : cases
          if (filtered.length === 0) {
            console.log('No cases found.')
            return
          }
          for (const [index, c] of filtered.entries()) {
            console.log(`${index + 1}. ${c.id}  [${c.status}]  ${c.name}`)
          }
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
  .addCommand(
    new Command('evidence')
      .description('Manage case evidence')
      .addCommand(
        new Command('add')
          .description('Add evidence to a case from an MCP query result')
          .argument('<case-id>', 'Case ID to add evidence to')
          .option('--source <tool>', 'MCP tool name that produced this evidence', 'manual')
          .option('--content <text>', 'Evidence content (MCP response or notes)', '')
          .option('--query-params <params>', 'Query parameters used (e.g. address=0x1234)', '')
          .action(async (caseSelector: string, opts: { source: string; content: string; queryParams: string }) => {
            try {
              const { EvidenceStore } = await import('./cases/index.js')
              const caseId = await resolveCaseSelector(caseSelector)
              const result = await EvidenceStore.append(caseId, {
                source: opts.source,
                content: opts.content,
                queryParams: opts.queryParams,
              })
              console.log(`Evidence saved: ${result.filename}`)
              console.log(`SHA-256: ${result.sha256}`)
            } catch (err) {
              console.error((err as Error).message)
              process.exit(1)
            }
          })
      )
      .addCommand(
        new Command('verify')
          .description('Verify evidence manifest integrity for a case')
          .argument('<case-id>', 'Case ID to verify')
          .action(async (caseSelector: string) => {
            try {
              const { EvidenceStore } = await import('./cases/index.js')
              const caseId = await resolveCaseSelector(caseSelector)
              const result = await EvidenceStore.verifyManifest(caseId)
              if (result.ok) {
                console.log(`Manifest OK — ${result.count} evidence file(s) verified`)
              } else {
                console.error(`Manifest FAILED — tampered files: ${(result.tampered ?? []).join(', ')}`)
                process.exit(1)
              }
            } catch (err) {
              console.error((err as Error).message)
              process.exit(1)
            }
          })
      )
  )
  .addCommand(
    new Command('dossier')
      .description('Manage entity dossiers for a case')
      .addCommand(
        new Command('update')
          .description('Append a finding to an entity dossier')
          .argument('<case-id>', 'Case ID')
          .argument('<address>', 'Entity address or identifier')
          .option('--finding <text>', 'Finding to append to the dossier', '')
          .option('--type <type>', 'Entity type (eoa|contract|exchange|mixer|unknown)', 'unknown')
          .action(async (caseSelector: string, address: string, opts: { finding: string; type: string }) => {
            try {
              const { DossierStore } = await import('./cases/index.js')
              const caseId = await resolveCaseSelector(caseSelector)
              const validTypes = ['eoa', 'contract', 'exchange', 'mixer', 'unknown'] as const
              const entityType = validTypes.includes(opts.type as typeof validTypes[number])
                ? (opts.type as typeof validTypes[number])
                : 'unknown'
              await DossierStore.appendFinding(caseId, address, opts.finding, entityType)
              console.log(`Dossier updated for ${address}`)
            } catch (err) {
              console.error((err as Error).message)
              process.exit(1)
            }
          })
      )
  )
  .addCommand(
    new Command('session')
      .description('Manage investigation sessions')
      .addCommand(
        new Command('start')
          .description('Start a new investigation session for a case')
          .argument('<case-id>', 'Case ID')
          .argument('[title...]', 'Optional session title')
          .action(async (caseSelector: string, titleParts: string[]) => {
            try {
              const { SessionStore } = await import('./cases/index.js')
              const caseId = await resolveCaseSelector(caseSelector)
              const title = titleParts.join(' ').trim()
              const s = await SessionStore.start(caseId, title ? { title } : {})
              console.log(`Session started: ${s.sessionId}`)
            } catch (err) {
              console.error((err as Error).message)
              process.exit(1)
            }
          })
      )
      .addCommand(
        new Command('end')
          .description('End the current session with findings and next steps')
          .argument('<case-id>', 'Case ID')
          .option('--findings <text>', 'Key findings from this session', '')
          .option('--next-steps <text>', 'Next steps for the investigation', '')
          .action(async (caseSelector: string, opts: { findings: string; nextSteps: string }) => {
            try {
              const { SessionStore } = await import('./cases/index.js')
              const caseId = await resolveCaseSelector(caseSelector)
              await SessionStore.end(caseId, { findings: opts.findings, nextSteps: opts.nextSteps })
              await SessionStore.archiveOldSessions(caseId)
              console.log(`Session ended for case ${caseId}`)
            } catch (err) {
              console.error((err as Error).message)
              process.exit(1)
            }
          })
      )
  )
  .addCommand(
    new Command('show')
      .description('Show saved case context')
      .argument('<case-id>', 'Case ID or case list number to show')
      .action(async (caseSelector: string) => {
        try {
          await showCaseContext(caseSelector)
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )

program.addCommand(caseCommand)

program
  .command('playbook')
  .description('Run and manage investigation playbooks')
  .addCommand(
    new Command('run')
      .description('Execute a playbook by name')
      .argument('<name>', 'Playbook name (e.g. trace-funds, risk-check, entity-profile)')
      .option('--case <id>', 'Case ID to attach evidence to (auto-created if omitted)')
      .option('--from <n>', 'Resume from step N (1-based)', '1')
      .option('--dry-run', 'Show steps without executing')
      .option('-p, --param <kv...>', 'Parameters as key=value pairs (repeatable, e.g. -p address=0x1 -p hops=3)')
      .action(async (name: string, opts: { case?: string; from: string; dryRun?: boolean; param?: string[] }) => {
        try {
          // 1. Parse --param key=value pairs into Record<string,string> — split on first '=' only (T-05-06)
          const resolvedParams: Record<string, string> = {}
          for (const kv of (opts.param ?? [])) {
            const eq = kv.indexOf('=')
            if (eq === -1) {
              console.error(`Invalid param format: "${kv}". Use key=value`)
              process.exit(1)
            }
            const key = kv.slice(0, eq)
            if (!key) {
              console.error(`Invalid param format: "${kv}". Key must be non-empty`)
              process.exit(1)
            }
            resolvedParams[key] = kv.slice(eq + 1)
          }
          // 2. Resolve playbook content (user-dir first, built-in fallback)
          const { resolvePlaybookContent } = await import('./playbooks/resolver.js')
          const markdown = await resolvePlaybookContent(name)
          // 3. Parse markdown → PlaybookDefinition
          const { PlaybookParser } = await import('./playbooks/parser.js')
          const definition = PlaybookParser.parse(markdown, resolvedParams)
          // 4. Validate required params are provided
          for (const spec of definition.params) {
            if (spec.required && !resolvedParams[spec.name] && !spec.default) {
              console.error(`Missing required param: ${spec.name}. Pass with: -p ${spec.name}=<value>`)
              process.exit(1)
            }
          }
          // 5. Validate --from value
          const fromN = parseInt(opts.from, 10)
          if (isNaN(fromN) || fromN < 1) {
            console.error(`Invalid --from value: "${opts.from}". Must be a positive integer.`)
            process.exit(1)
          }
          // 6. Run
          const { PlaybookRunner } = await import('./playbooks/runner.js')
          await PlaybookRunner.run(definition, {
            caseId:  opts.case,
            from:    fromN,
            dryRun:  opts.dryRun,
            params:  resolvedParams,
          })
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
  .addCommand(
    new Command('list')
      .description('List available playbooks (built-in and user-defined)')
      .action(async () => {
        try {
          const { listPlaybooks } = await import('./playbooks/resolver.js')
          const playbooks = await listPlaybooks()
          if (playbooks.length === 0) { console.log('No playbooks found.'); return }
          for (const p of playbooks) {
            console.log(`  ${p.name.padEnd(20)} [${p.source}]`)
          }
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
  .addCommand(
    new Command('show')
      .description('Show steps for a playbook without executing')
      .argument('<name>', 'Playbook name')
      .action(async (name: string) => {
        try {
          const { resolvePlaybookContent } = await import('./playbooks/resolver.js')
          const { PlaybookParser } = await import('./playbooks/parser.js')
          const markdown = await resolvePlaybookContent(name)
          const definition = PlaybookParser.parse(markdown, {})
          console.log(`Playbook: ${definition.name} v${definition.version}`)
          console.log(`${definition.description}\n`)
          console.log(`Parameters:`)
          for (const p of definition.params) {
            const req = p.required ? '(required)' : `(optional, default: ${p.default ?? 'none'})`
            console.log(`  ${p.name}: ${p.type} ${req}`)
          }
          console.log(`\nSteps:`)
          for (const step of definition.steps) {
            console.log(`  ${step.index}. ${step.label} → tool: ${step.tool}`)
          }
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )

program
  .command('viz')
  .description('Generate money flow visualization')
  .argument('[case-id]', 'Case ID to visualize')
  .option('--data <file>', 'Raw transaction JSON file for ad-hoc visualization')
  .option('-p, --port <number>', 'Server port', '4321')
  .action(async (caseId: string | undefined, opts: { data?: string; port: string }) => {
    try {
      if (!caseId && !opts.data) {
        console.error('Provide either a case ID or --data <file.json>')
        process.exit(1)
      }
      const { generateVisualization } = await import('./viz/index.js')
      const result = await generateVisualization({ caseId, dataFile: opts.data })
      const { startServer } = await import('./server/index.js')
      const port = parseInt(opts.port, 10)
      startServer(port)
      const url = `http://127.0.0.1:${port}/viz/${result.vizId}`
      console.log(`Visualization: ${url}`)
      const open = (await import('open')).default
      await open(url)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

program.parse(process.argv)
