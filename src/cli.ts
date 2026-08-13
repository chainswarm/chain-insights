import { Command, Option } from 'commander'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { PACKAGE_INFO, PACKAGE_VERSION } from './version.js'
import { printMcpTextContent } from './mcp/print-result.js'

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
// A help/version request must never trigger a global install side effect — let
// commander handle it and print help/version instead.
const wantsHelpOrVersion = rawArgs.some(a => a === '--help' || a === '-h' || a === '--version' || a === '-V')
if (installerFlags.length > 0 && !wantsHelpOrVersion && !rawArgs.some(a => !a.startsWith('-'))) {
  try {
    execFileSync(process.execPath, [installerPath, ...installerFlags], { stdio: 'inherit' })
  } catch (err) {
    console.error('Installation failed:', (err as Error).message)
    process.exit(1)
  }
  process.exit(0)
}

// Legacy mcp aliases for retired graph tools are not commands; reject them
// before Commander can mis-parse them. Members are built by concatenation so
// retired names never appear as literal source strings.
const retiredMcpAliases = new Set([['trace', '-funds'].join(''), ['track', '-funds'].join('')])
if (rawArgs[0] === 'mcp' && retiredMcpAliases.has(rawArgs[1] ?? '')) {
  console.error(`error: unknown command '${rawArgs[1]}'`)
  process.exit(1)
}

function runInstaller(flag: '--claude' | '--codex' | '--hermes'): void {
  try {
    execFileSync(process.execPath, [installerPath, flag], { stdio: 'inherit' })
  } catch (err) {
    console.error('Installation failed:', (err as Error).message)
    process.exit(1)
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

async function withGraphMcpClient<T>(name: string, fn: (client: import('@modelcontextprotocol/sdk/client/index.js').Client, config: Awaited<ReturnType<typeof import('./config/index.js').loadConfig>>) => Promise<T>): Promise<T> {
  const { loadConfig } = await import('./config/index.js')
  const config = await loadConfig()
  const { createConfiguredGraphMcpFetch, resolveGraphMcpEndpoint } = await import('./mcp/client.js')
  const paymentFetch = await createConfiguredGraphMcpFetch(config)
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
  const client = new Client({ name, version: PACKAGE_VERSION })
  await client.connect(new StreamableHTTPClientTransport(new URL(resolveGraphMcpEndpoint(config)), { fetch: paymentFetch }))
  // Every CLI command builds its own client, separate from the MCP proxy's.
  // Without this, an unattended instance driven by `cia monitor watch` writes
  // nothing to the action log while the proxy path logs fine.
  const { installActionLogging } = await import('./mcp/action-log.js')
  installActionLogging(client)
  try {
    return await fn(client, config)
  } finally {
    await client.close()
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
  .description('List supported graph networks, capability layers, and available tools')
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
  .option('-p, --port <number>', 'Port to bind (defaults to the configured serverPort)')
  .action(async (opts: { port?: string }) => {
    try {
      const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
      const workspaceRoot = requireWorkspaceRoot()
      const { loadConfig } = await import('./config/index.js')
      const { resolveServerPort } = await import('./server/resolve-port.js')
      const config = await loadConfig()
      const port = resolveServerPort(opts.port, config.serverPort)
      const { startServer } = await import('./server/index.js')
      console.log(`Workspace: ${workspaceRoot}`)
      startServer(port)
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
    console.log('Chain Insights Graph:', graphMcpStatus)
    console.log('Graph endpoint:', config.graphMcpEndpoint)
  })

program
  .command('update')
  .description('Check npmjs for a newer Chain Insights release and update this CLI')
  .option('--check', 'Only check for a newer release')
  .option('--dry-run', 'Print the update command without running it')
  .action(async (opts: { check?: boolean; dryRun?: boolean }) => {
    try {
      const { checkForUpdate, runPackageUpdate } = await import('./update.js')
      const result = await checkForUpdate()
      if (result.error) {
        throw new Error(`Could not check npmjs for updates: ${result.error}`)
      }
      if (!result.updateAvailable || !result.latestVersion) {
        console.log(`Chain Insights is up to date (${result.currentVersion}).`)
        return
      }

      console.log(`Chain Insights ${result.latestVersion} is available (current ${result.currentVersion}).`)
      if (opts.check) {
        console.log(`Run: ${result.updateCommand}`)
        return
      }
      if (opts.dryRun) {
        console.log(`Would run: ${result.updateCommand}`)
        return
      }

      console.log(`Running: ${result.updateCommand}`)
      runPackageUpdate(result.packageName)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

program
  .command('debug')
  .description('Configure Chain Insights Graph debug mode')
  .addCommand(
    new Command('on')
      .description('Enable Chain Insights Graph debug mode without x402 payments')
      .requiredOption('--token <token>', 'Debug bearer token')
      .option('--endpoint <url>', 'Chain Insights Graph endpoint')
      .action(async (opts: { token: string; endpoint?: string }) => {
        try {
          const { saveConfig } = await import('./config/index.js')
          await saveConfig({
            graphMcpMode: 'debug',
            graphMcpAuthToken: opts.token,
            ...(opts.endpoint ? { graphMcpEndpoint: opts.endpoint } : {}),
          })
          console.log('Chain Insights Graph debug mode enabled')
          if (opts.endpoint) console.log(`Graph endpoint: ${opts.endpoint}`)
          console.log('Payments: disabled for Chain Insights Graph calls')
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
  .addCommand(
    new Command('off')
      .description('Disable Chain Insights Graph debug mode and use paid x402 calls')
      .action(async () => {
        try {
          const { saveConfig } = await import('./config/index.js')
          await saveConfig({ graphMcpMode: 'paid', graphMcpAuthToken: '' })
          console.log('Chain Insights Graph debug mode disabled')
          console.log('Payments: enabled for Chain Insights Graph calls')
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
  .addCommand(
    new Command('status')
      .description('Show Chain Insights Graph payment/debug mode')
      .action(async () => {
        try {
          const { loadConfig } = await import('./config/index.js')
          const config = await loadConfig()
          console.log(`Chain Insights Graph mode: ${config.graphMcpMode}`)
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
  .description('Configure Chain Insights Graph test access key mode')
  .addCommand(
    new Command('set')
      .description('Use a Chain Insights Graph test access key without x402 payments')
      .argument('<key>', 'Test access key')
      .option('--endpoint <url>', 'Chain Insights Graph endpoint')
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
          console.log('Chain Insights Graph test access key configured')
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
      .description('Remove the Chain Insights Graph test access key and use paid x402 calls')
      .action(async () => {
        try {
          const { saveConfig } = await import('./config/index.js')
          await saveConfig({ graphMcpMode: 'paid', graphMcpAuthToken: '' })
          console.log('Chain Insights Graph test access key cleared')
          console.log('Payments: enabled for Chain Insights Graph calls')
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
  .addCommand(
    new Command('status')
      .description('Show Chain Insights Graph test access key status')
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
      const { maybePromptForUpdate } = await import('./update.js')
      await maybePromptForUpdate()
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

program
  .command('setup')
  .description('Configure external MCP clients')
  .addCommand(
    new Command('claude-code')
      .alias('claude')
      .description('Install Claude Code skills and register the MCP proxy')
      .action(() => {
        runInstaller('--claude')
      })
  )
  .addCommand(
    new Command('codex')
      .description('Install Codex skills and register the MCP proxy')
      .action(() => {
        runInstaller('--codex')
      })
  )
  .addCommand(
    new Command('hermes')
      .description('Install Hermes skills and register the MCP proxy')
      .action(() => {
        runInstaller('--hermes')
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
    new Command('import')
      .description('Import a Base payment wallet')
      .argument('<private-key>', '0x-prefixed EVM private key')
      .option('--force', 'Replace an existing wallet (the previous key is backed up next to wallet.json)')
      .action(async (privateKey: string, opts: { force?: boolean }) => {
        try {
          const { setWalletPrivateKey, isWalletConfigured } = await import('./wallet/index.js')
          const replacing = opts.force === true && await isWalletConfigured()
          const address = await setWalletPrivateKey(privateKey, { force: opts.force })
          if (replacing) {
            console.log('Previous wallet key backed up next to ~/.chain-insights/wallet.json')
          }
          console.log(`Wallet imported: ${address}`)
          console.log('Next: run `chain-insights wallet ready`')
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
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
      .description('Check and prepare the wallet for paid Chain Insights Graph calls')
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
      .description('List supported graph networks, capability layers, dataset coverage, and available tools')
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
    new Command('aml-address-risk')
      .description('Screen an address for AML risk, exchange behavior, and optional comparison with another address')
      .requiredOption('--address <address>', 'Full blockchain address to screen')
      .requiredOption('--network <network>', 'Network to query. Run `cia mcp networks` for supported networks.')
      .option('--compare-address <address>', 'Optional second address to compare against the screened address')
      .action(async (opts: { address: string; network: string; compareAddress?: string }) => {
        try {
          await withGraphMcpClient('chain-insights-cli-aml-address-risk', async (client) => {
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
    new Command('call')
      .description('Call an MCP tool directly (debug)')
      .argument('<tool>', 'Tool name to call')
      .argument('[args...]', 'Key=value arguments (e.g. address=0x1234... network=robinhood)')
      .action(async (tool: string, rawArgs: string[]) => {
        try {
          const { parseMcpCallArgs } = await import('./mcp/call-args.js')
          const { assertPublicMcpToolName, validatePublicMcpToolArguments } = await import('./mcp/tool-visibility.js')
          const args = parseMcpCallArgs(rawArgs)
          assertPublicMcpToolName(tool)
          validatePublicMcpToolArguments(tool, args)

          if (tool === 'wallet_balance') {
            const { getWalletBalanceText } = await import('./wallet/tools.js')
            console.log(await getWalletBalanceText())
            return
          }

          if (tool === 'meta_network_capabilities') {
            await printNetworkCapabilities({ json: true })
            return
          }

          if (tool === 'meta_help') {
            console.log('Chain Insights tools: aml_*, graph_query, graph_query_batch, meta_*, and wallet_balance.')
            return
          }

          await withGraphMcpClient('chain-insights-cli-call', async (client, config) => {
            if (tool === 'meta_usage_status') {
              try {
                const result = await client.callTool({ name: 'usage_status', arguments: {} })
                printMcpTextContent(result as { content?: Array<{ type: string; text?: string }> })
              } catch (err) {
                const { isMissingUsageStatusToolError, primitiveBackendUsageStatus, usageStatusText } = await import('./mcp/usage-status.js')
                if (!isMissingUsageStatusToolError(err)) throw err
                const { resolveGraphMcpEndpoint } = await import('./mcp/client.js')
                console.log(usageStatusText(primitiveBackendUsageStatus(resolveGraphMcpEndpoint(config))))
              }
              return
            }
            if (tool === 'aml_address_risk') {
              const { addressRisk } = await import('./investigation/public-tools.js')
              const result = await addressRisk(client, {
                address: String(args['address'] ?? ''),
                network: String(args['network'] ?? ''),
                compareAddress: args['compare_address'] === undefined ? undefined : String(args['compare_address']),
              })
              console.log(result.summaryText)
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



program
  .command('viz')
  .description('Generate a workspace visualization')
  .argument('[source-id]', 'Workspace graph report ID to render')
  .option('--data <file>', 'Raw transaction JSON file for ad-hoc visualization')
  .option('-p, --port <number>', 'Server port (defaults to the configured serverPort)')
  .action(async (sourceId: string | undefined, opts: { data?: string; port?: string }) => {
    try {
      if (!sourceId && !opts.data) {
        console.error('Provide either a visualization source ID or --data <file.json>')
        process.exit(1)
      }
      const { loadConfig } = await import('./config/index.js')
      const { resolveServerPort } = await import('./server/resolve-port.js')
      const config = await loadConfig()
      const port = resolveServerPort(opts.port, config.serverPort)
      const { generateVisualization } = await import('./viz/index.js')
      const result = await generateVisualization({ sourceId, dataFile: opts.data })
      const { startServer } = await import('./server/index.js')
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

const MONITOR_EXIT_ISOLATED = 2

// Status log for `cia monitor status`: one JSON line per run, latest last.
async function appendRunLog(workspaceRoot: string, doc: { run_timestamp: number; cases: Array<{ case_id: string; rendered?: boolean; skipped_reason?: string; duration_ms: number; error?: string }> }): Promise<void> {
  const { monitorPaths } = await import('./monitor/paths.js')
  const { appendFile, mkdir } = await import('node:fs/promises')
  const { logsDir } = monitorPaths(workspaceRoot)
  await mkdir(logsDir, { recursive: true })
  await appendFile(`${logsDir}/monitor-runs.jsonl`, `${JSON.stringify(doc)}\n`, 'utf8')
}

const monitor = program
  .command('monitor')
  .description('Continuous case tracking: per-case dossier rendering over the configured interval. Docs: docs/monitoring.md')

monitor
  .command('run')
  .description('One monitoring pass: render the dossier of every open case')
  .action(async () => {
    try {
      const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
      const workspaceRoot = requireWorkspaceRoot()
      const { loadMonitorConfig } = await import('./monitor/config.js')
      const { runMonitorOnce } = await import('./monitor/runner.js')
      const { acquireRunLock } = await import('./monitor/lock.js')
      const lock = await acquireRunLock(workspaceRoot)
      if (!lock.acquired) {
        console.log(`[monitor] already running (pid ${lock.holderPid}); exiting`)
        return
      }
      // process.exit inside the try would skip the release, so the exit code is
      // captured and applied only AFTER the lock is released.
      let exitCode = 0
      try {
        const config = await loadMonitorConfig(workspaceRoot)
        const doc = await runMonitorOnce(undefined as never, workspaceRoot, config, Date.now())
        await appendRunLog(workspaceRoot, doc)
        const failed = doc.cases.filter((c) => c.error)
        console.log(`[monitor] run ${doc.run_timestamp}: ${doc.cases.length} case(s)`)
        for (const cell of failed) console.error(`[monitor]   ${cell.case_id} FAILED: ${cell.error}`)
        if (failed.length > 0) exitCode = MONITOR_EXIT_ISOLATED
      } finally {
        await lock.release()
      }
      if (exitCode !== 0) process.exit(exitCode)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

monitor
  .command('watch')
  .description('Loop `monitor run` on an interval (thin daemon; cron `cia monitor run` works too)')
  .option('--interval <seconds>', 'Override the configured interval')
  .action(async (opts: { interval?: string }) => {
    try {
      const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
      const workspaceRoot = requireWorkspaceRoot()
      const { loadMonitorConfig } = await import('./monitor/config.js')
      const { runMonitorOnce } = await import('./monitor/runner.js')
      const { acquireRunLock } = await import('./monitor/lock.js')
      const lock = await acquireRunLock(workspaceRoot)
      if (!lock.acquired) {
        console.log(`[monitor] already running (pid ${lock.holderPid}); exiting`)
        return
      }
      try {
        const config = await loadMonitorConfig(workspaceRoot)
        const intervalMs = Math.max(60, Number(opts.interval) || config.intervalSeconds) * 1000
        // eslint-disable-next-line no-constant-condition
        for (;;) {
          const doc = await runMonitorOnce(undefined as never, workspaceRoot, config, Date.now())
            .catch((err) => { console.error(`[monitor] run failed: ${(err as Error).message}`); return null })
          if (doc) await appendRunLog(workspaceRoot, doc)
          await new Promise((resolve) => setTimeout(resolve, intervalMs))
        }
      } finally {
        await lock.release()
      }
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

monitor
  .command('render')
  .description('Render the human-readable case dossier, seed notes and timeline from the case document (no re-trace)')
  .argument('[case_id]', 'Render one case instead of all open cases')
  .option('--force', 'Re-render even when the case document is unchanged')
  .action(async (caseId: string | undefined, opts: { force?: boolean }) => {
    try {
      const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
      const workspaceRoot = requireWorkspaceRoot()
      const { loadMonitorConfig } = await import('./monitor/config.js')
      const { renderCaseFromDoc, renderAllCasesFromDoc } = await import('./monitor/render/index.js')
      const config = await loadMonitorConfig(workspaceRoot)
      const outcomes = caseId
        ? [{ case_id: caseId, ...(await renderCaseFromDoc(workspaceRoot, caseId, config, Date.now(), { force: opts.force })) }]
        : await renderAllCasesFromDoc(workspaceRoot, config, Date.now(), { force: opts.force })
      if (outcomes.length === 0) console.log('[render] no open cases')
      for (const o of outcomes) {
        console.log(o.rendered
          ? `[render] ${o.case_id}: rendered`
          : `[render] ${o.case_id}: skipped (${o.skipped_reason})`)
      }
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

monitor
  .command('status')
  .description('Show monitor status: open cases and last run')
  .action(async () => {
    try {
      const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
      const workspaceRoot = requireWorkspaceRoot()
      const { statusText } = await import('./monitor/report.js')
      console.log(await statusText(workspaceRoot))
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

monitor
  .command('init')
  .description('Bootstrap a monitor profile in this workspace (victim: stolen-funds case tracking)')
  .argument('<profile>', 'Profile to initialize; only "victim" is supported (operators write config.json directly)')
  .requiredOption('--case-id <id>', 'Case identifier (lowercase letters, digits, hyphens)')
  .requiredOption('--network <network>', 'Network for the case. Run `cia networks` for supported networks.')
  .requiredOption('--seed <addresses...>', 'Stolen-funds seed address(es) — usually the drained wallet(s)')
  .option('--note <text>', 'Optional free-text note')
  .action(async (profile: string, opts: { caseId: string; network: string; seed: string[]; note?: string }) => {
    try {
      if (profile !== 'victim') throw new Error(`unknown init profile "${profile}" — only "victim" is supported (operator workspaces write .chain-insights/monitor/config.json directly; see docs/monitoring.md)`)
      const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
      const workspaceRoot = requireWorkspaceRoot()
      const { initVictimWorkspace } = await import('./monitor/init.js')
      const result = await initVictimWorkspace(workspaceRoot, { caseId: opts.caseId, network: opts.network, seeds: opts.seed, note: opts.note }, Date.now())
      console.log('Victim monitoring initialized.')
      console.log(`  case:      ${result.monitorCase.case_id} (stolen-funds, ${result.monitorCase.network}, ${result.monitorCase.seeds.length} seed(s))`)
      console.log(`  config:    ${result.configPath}`)
      console.log('')
      console.log('Next steps:')
      console.log('  cia monitor run          # render the dossier for every open case')
      console.log('  cia monitor watch        # interval loop; keep it alive under pm2 (docs/monitoring.md "Scheduling")')
      console.log(`Dossier after the first run: published/cases/${result.monitorCase.case_id}/dossier.md`)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

const monitorCase = monitor
  .command('case')
  .description('Manage incident-centric monitor cases (stolen-funds, scam-topology)')

monitorCase
  .command('add')
  .description('Register a new monitor case with one or more seed addresses')
  .argument('<case-id>', 'Case identifier (lowercase letters, digits, hyphens)')
  .addOption(new Option('--type <type>', 'Case type').choices(['stolen-funds', 'scam-topology']).makeOptionMandatory())
  .requiredOption('--network <network>', 'Network for this case. Run `cia mcp networks` for supported networks.')
  .requiredOption('--seed <addresses...>', 'Seed address(es) for the case')
  .option('--note <text>', 'Optional free-text note')
  .action(async (caseId: string, opts: { type: 'stolen-funds' | 'scam-topology'; network: string; seed: string[]; note?: string }) => {
    try {
      const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
      const workspaceRoot = requireWorkspaceRoot()
      const { addCase } = await import('./monitor/cases.js')
      const created = await addCase(
        workspaceRoot,
        { case_id: caseId, type: opts.type, network: opts.network, seeds: opts.seed, note: opts.note },
        Date.now(),
      )
      console.log(`Case created: ${created.case_id} (${created.type}, ${created.network}, ${created.seeds.length} seed(s))`)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

monitorCase
  .command('list')
  .description('List monitor cases (open only by default)')
  .option('--all', 'Include closed cases')
  .action(async (opts: { all?: boolean }) => {
    try {
      const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
      const workspaceRoot = requireWorkspaceRoot()
      const { listCases } = await import('./monitor/cases.js')
      const cases = await listCases(workspaceRoot, { openOnly: !opts.all })
      if (cases.length === 0) {
        console.log('(no cases)')
        return
      }
      console.log('case_id\ttype\tnetwork\tstatus\tseeds')
      for (const c of cases) console.log(`${c.case_id}\t${c.type}\t${c.network}\t${c.status}\t${c.seeds.join(',')}`)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

monitorCase
  .command('add-seed')
  .description('Add seed address(es) to an OPEN case. Idempotent; the next run widens the corridor without reporting the newly visible addresses as movements.')
  .argument('<case-id>', 'Case identifier')
  .requiredOption('--address <addresses...>', 'Address(es) to add as case seeds')
  .option('--note <text>', 'Why the case is being widened (recorded on the seed event)')
  .action(async (caseId: string, opts: { address: string[]; note?: string }) => {
    try {
      const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
      const workspaceRoot = requireWorkspaceRoot()
      const { addCaseSeeds } = await import('./monitor/cases.js')
      const { monitorCase: updated, added } = await addCaseSeeds(workspaceRoot, caseId, opts.address, Date.now(), { note: opts.note })
      if (added.length === 0) {
        console.log(`Case ${updated.case_id} unchanged: all ${opts.address.length} address(es) are already seeds (${updated.seeds.length} seed(s)).`)
        return
      }
      console.log(`Case ${updated.case_id}: added ${added.length} seed(s) [${added.join(', ')}], now ${updated.seeds.length} seed(s).`)
      console.log('The next `cia monitor run` re-traces the wider corridor. Addresses that appear only because of these seeds are recorded as scope_expansion, not as movements.')
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

monitorCase
  .command('remove-seed')
  .description('Remove seed address(es) from an OPEN case. Idempotent; a case may never be left with zero seeds.')
  .argument('<case-id>', 'Case identifier')
  .requiredOption('--address <addresses...>', 'Address(es) to remove from the case seeds')
  .action(async (caseId: string, opts: { address: string[] }) => {
    try {
      const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
      const workspaceRoot = requireWorkspaceRoot()
      const { removeCaseSeeds } = await import('./monitor/cases.js')
      const { monitorCase: updated, removed } = await removeCaseSeeds(workspaceRoot, caseId, opts.address, Date.now())
      if (removed.length === 0) {
        console.log(`Case ${updated.case_id} unchanged: none of the ${opts.address.length} address(es) is a seed (${updated.seeds.length} seed(s)).`)
        return
      }
      console.log(`Case ${updated.case_id}: removed ${removed.length} seed(s) [${removed.join(', ')}], now ${updated.seeds.length} seed(s).`)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

monitorCase
  .command('close')
  .description('Close a monitor case')
  .argument('<case-id>', 'Case identifier')
  .action(async (caseId: string) => {
    try {
      const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
      const workspaceRoot = requireWorkspaceRoot()
      const { closeCase } = await import('./monitor/cases.js')
      const { monitorCase, alreadyClosed } = await closeCase(workspaceRoot, caseId, Date.now())
      if (alreadyClosed) {
        console.warn(`Warning: case "${caseId}" is already closed (closed_at ${monitorCase.closed_at_timestamp}); nothing changed.`)
      } else {
        console.log(`Case closed: ${monitorCase.case_id}`)
      }
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

// parseAsync (not parse) so a rejected async action surfaces as a clean
// one-line error and a non-zero exit, instead of an unhandled-rejection stack
// trace. Commands with their own try/catch still exit(1) before this fires.
program.parseAsync(process.argv).catch((err) => {
  console.error((err as Error).message)
  process.exit(1)
})
