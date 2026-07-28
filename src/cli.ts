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

if (rawArgs[0] === 'mcp' && ['trace-funds', 'track-funds'].includes(rawArgs[1] ?? '')) {
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
    new Command('aml-trace-victim-funds')
      .description('Trace victim/source addresses forward to exchange deposit candidates')
      .requiredOption('--victim-addresses <addresses>', 'Comma-separated full victim/source addresses, max 5')
      .requiredOption('--network <network>', 'Network to query. Run `cia mcp networks` for supported networks.')
      .option('--known-suspect-addresses <addresses>', 'Optional known suspect addresses for context only, max 5')
      .option('--incident-timestamp <milliseconds>', 'Optional incident timestamp in milliseconds')
      .option('--max-hops <number>', 'Maximum trace hops, 1-5')
      .option('--per-address-limit <number>', 'Maximum exchange paths/results per address, default 5, max 50')
      .option('--min-amount-sum <number>', 'Minimum USD amount (amount_usd_sum) for traced edges')
      .action(async (opts: {
        victimAddresses: string
        network: string
        knownSuspectAddresses?: string
        incidentTimestamp?: string
        maxHops?: string
        perAddressLimit?: string
        minAmountSum?: string
      }) => {
        try {
          const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
          requireWorkspaceRoot()
          await withGraphMcpClient('chain-insights-cli-aml-trace-victim-funds', async (client, config) => {
            const { traceVictimFunds } = await import('./investigation/public-tools.js')
            const result = await traceVictimFunds(client, config, {
              victimAddresses: opts.victimAddresses,
              knownSuspectAddresses: opts.knownSuspectAddresses,
              network: opts.network,
              incidentTimestamp: optionalNumber(opts.incidentTimestamp),
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
    new Command('aml-trace-suspect-funds')
      .description('Trace suspected scammer, mule, operator, or laundering-ring addresses forward to cashout topology')
      .requiredOption('--network <network>', 'Network to query. Run `cia mcp networks` for supported networks.')
      .requiredOption('--suspect-addresses <addresses>', 'Comma-separated full suspect-controlled addresses, max 5')
      .option('--incident-timestamp <milliseconds>', 'Optional incident timestamp in milliseconds')
      .option('--max-hops <number>', 'Maximum trace hops, default 3, max 5')
      .option('--per-address-limit <number>', 'Maximum exchange paths/results per address, default 5, max 50')
      .option('--min-amount-sum <number>', 'Minimum USD amount (amount_usd_sum) for traced edges')
      .action(async (opts: {
        network: string
        suspectAddresses: string
        incidentTimestamp?: string
        maxHops?: string
        perAddressLimit?: string
        minAmountSum?: string
      }) => {
        try {
          const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
          requireWorkspaceRoot()
          await withGraphMcpClient('chain-insights-cli-aml-trace-suspect-funds', async (client, config) => {
            const { traceSuspectFunds } = await import('./investigation/public-tools.js')
            const result = await traceSuspectFunds(client, config, {
              suspectAddresses: opts.suspectAddresses,
              network: opts.network,
              maxHops: optionalNumber(opts.maxHops),
              perAddressLimit: optionalNumber(opts.perAddressLimit),
              minAmountSum: optionalNumber(opts.minAmountSum),
              incidentTimestamp: optionalNumber(opts.incidentTimestamp),
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
    new Command('aml-trace-deposit-sources')
      .description('Trace backward from suspected deposit/cashout addresses to upstream sources and convergence')
      .requiredOption('--network <network>', 'Network to query. Run `cia mcp networks` for supported networks.')
      .requiredOption('--deposit-addresses <addresses>', 'Comma-separated full suspected deposit/cashout addresses, max 5')
      .option('--max-hops <number>', 'Maximum reverse traceback hops, default 2, max 5')
      .option('--row-limit <number>', 'Value-ordered upstream paths kept per depth, default 500, max 20000. Raise to reach a distant origin behind a high-fan-in deposit.')
      .action(async (opts: {
        network: string
        depositAddresses: string
        maxHops?: string
        rowLimit?: string
      }) => {
        try {
          const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
          requireWorkspaceRoot()
          await withGraphMcpClient('chain-insights-cli-aml-trace-deposit-sources', async (client, config) => {
            const { traceDepositSources } = await import('./investigation/public-tools.js')
            const result = await traceDepositSources(client, config, {
              depositAddresses: opts.depositAddresses,
              network: opts.network,
              maxHops: optionalNumber(opts.maxHops),
              rowLimit: optionalNumber(opts.rowLimit),
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
    new Command('aml-scam-corridor-trace')
      .description('[internal] Trace a scam seed address hop-by-hop for corridor/exchange/hub gate classification. Not on the public MCP surface — findings are proposals, not label writes.')
      .requiredOption('--seed-address <address>', 'Full scam seed address to trace')
      .requiredOption('--network <network>', 'Network to query. Run `cia mcp networks` for supported networks.')
      .option('--max-hops <number>', 'Maximum trace hops, default 3, hard cap 4')
      .action(async (opts: { seedAddress: string; network: string; maxHops?: string }) => {
        try {
          const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
          requireWorkspaceRoot()
          await withGraphMcpClient('chain-insights-cli-aml-scam-corridor-trace', async (client) => {
            const { scamCorridorTrace } = await import('./investigation/scam-corridor-trace.js')
            const result = await scamCorridorTrace(client, {
              seedAddress: opts.seedAddress,
              network: opts.network,
              maxHops: optionalNumber(opts.maxHops),
            })
            console.log(result.summaryText)
            console.log(JSON.stringify(result.document, null, 2))
          })
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
  .addCommand(
    new Command('aml-exchange-likeness')
      .description('[internal] Classify 1-25 candidate addresses for exchange-likeness via fan-in/reciprocity/lifetime-inbound thresholds. Not on the public MCP surface — findings are proposals, not label writes.')
      .requiredOption('--addresses <addresses>', 'Comma-separated candidate addresses, max 25')
      .requiredOption('--network <network>', 'Network to query. Run `cia mcp networks` for supported networks.')
      .action(async (opts: { addresses: string; network: string }) => {
        try {
          const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
          requireWorkspaceRoot()
          await withGraphMcpClient('chain-insights-cli-aml-exchange-likeness', async (client) => {
            const { exchangeLikeness } = await import('./investigation/exchange-likeness.js')
            const result = await exchangeLikeness(client, {
              addresses: opts.addresses,
              network: opts.network,
            })
            console.log(result.summaryText)
            console.log(JSON.stringify(result.document, null, 2))
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
      .argument('[args...]', 'Key=value arguments (e.g. address=5Seed network=bittensor)')
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
            if (tool === 'aml_trace_victim_funds') {
              const { traceVictimFunds } = await import('./investigation/public-tools.js')
              const result = await traceVictimFunds(client, config, {
                victimAddresses: args['victim_addresses'] as string | string[] | undefined ?? '',
                knownSuspectAddresses: args['known_suspect_addresses'] as string | string[] | undefined,
                network: String(args['network'] ?? ''),
                incidentTimestamp: optionalNumberArg(args['incident_timestamp'], 'incident_timestamp'),
                maxHops: typeof args['max_hops'] === 'number' ? args['max_hops'] : undefined,
                perAddressLimit: typeof args['per_address_limit'] === 'number' ? args['per_address_limit'] : undefined,
              })
              console.log(result.summaryText)
              console.log(JSON.stringify(result.structuredContent, null, 2))
              return
            }
            if (tool === 'aml_trace_suspect_funds') {
              const { traceSuspectFunds } = await import('./investigation/public-tools.js')
              const result = await traceSuspectFunds(client, config, {
                suspectAddresses: args['suspect_addresses'] as string | string[] | undefined ?? '',
                network: String(args['network'] ?? ''),
                maxHops: typeof args['max_hops'] === 'number' ? args['max_hops'] : undefined,
                perAddressLimit: typeof args['per_address_limit'] === 'number' ? args['per_address_limit'] : undefined,
                incidentTimestamp: optionalNumberArg(args['incident_timestamp'], 'incident_timestamp'),
              })
              console.log(result.summaryText)
              console.log(JSON.stringify(result.structuredContent, null, 2))
              return
            }
            if (tool === 'aml_trace_deposit_sources') {
              const { traceDepositSources } = await import('./investigation/public-tools.js')
              const result = await traceDepositSources(client, config, {
                depositAddresses: args['deposit_addresses'] as string | string[] | undefined ?? '',
                network: String(args['network'] ?? ''),
                maxHops: typeof args['max_hops'] === 'number' ? args['max_hops'] : undefined,
                rowLimit: typeof args['row_limit'] === 'number' ? args['row_limit'] : undefined,
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

program
  .command('detect')
  .description(
    '[internal] Run a relocated detection scan (rbmk#462) — emits reviewable findings, never a direct label. Available: fake-token, mixer, address-poisoning, attack-attribution.',
  )
  .argument('<detector>', 'Detector id: fake-token | mixer | address-poisoning | attack-attribution')
  .requiredOption('--network <network>', 'Network to scan. Run `cia mcp networks` for supported networks.')
  .option('--full', 'Scan from genesis (ignore the checkpoint)', false)
  .option('--since-checkpoint', 'Scan only since the last checkpoint (default)', false)
  .option('--watch', 'Loop the scan as a daemon', false)
  .option('--interval <seconds>', 'Watch interval seconds', '3600')
  .option(
    '--param <key=value>',
    'Detector-specific tuning override (repeatable). E.g. mixer: --param min_in=80 --param time_scope=recent. Unset knobs use per-network defaults.',
    (kv: string, acc: Record<string, string>) => {
      const eq = kv.indexOf('=')
      if (eq <= 0) throw new Error(`--param must be key=value, got "${kv}"`)
      acc[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim()
      return acc
    },
    {} as Record<string, string>,
  )
  .action(
    async (
      detector: string,
      opts: {
        network: string
        full?: boolean
        sinceCheckpoint?: boolean
        watch?: boolean
        interval?: string
        param?: Record<string, string>
      },
    ) => {
      try {
        const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
        const workspaceRoot = requireWorkspaceRoot()
        const { runOneDetection } = await import('./detection/run.js')
        const full = Boolean(opts.full)
        const once = async () => {
          await withGraphMcpClient('chain-insights-cli-detect', async (client) => {
            const outcome = await runOneDetection(client, {
              detector,
              network: opts.network,
              full,
              workspaceRoot,
              nowTimestamp: Date.now(),
              params: opts.param ?? {},
            })
            console.log(
              `[detect] ${detector} ${opts.network}: ${outcome.findingsCount} finding(s), status=${outcome.status} -> ${outcome.findingsPath}`,
            )
          })
        }
        if (opts.watch) {
          const intervalMs = Math.max(60, Number(opts.interval) || 3600) * 1000
          // eslint-disable-next-line no-constant-condition
          for (;;) {
            await once()
            await new Promise((resolve) => setTimeout(resolve, intervalMs))
          }
        } else {
          await once()
        }
      } catch (err) {
        console.error((err as Error).message)
        process.exit(1)
      }
    },
  )

const monitor = program
  .command('monitor')
  .description('Continuous address monitoring: scheduled detector sweeps, case tracking, review, alerts. Docs: docs/monitoring.md')

monitor
  .command('run')
  .description('One monitoring pass over the configured detector×network matrix and every open case')
  .option('--force-trace', 'Trace every open case this pass even in on_movement mode')
  .action(async (opts: { forceTrace?: boolean }) => {
    try {
      const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
      const workspaceRoot = requireWorkspaceRoot()
      const { loadMonitorConfig } = await import('./monitor/config.js')
      const { runMonitorOnce, MONITOR_EXIT_ISOLATED } = await import('./monitor/runner.js')
      const { traceCase } = await import('./monitor/tracker.js')
      const { renderCase } = await import('./monitor/render/index.js')
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
        const doc = await withGraphMcpClient('chain-insights-cli-monitor', async (client) =>
          runMonitorOnce(client, workspaceRoot, config, Date.now(), {
            traceCase: (c, root, id, hops, now) => traceCase(c, root, id, hops, now),
            renderCase: (c, root, id, cfg, now) => renderCase(c, root, id, cfg, now),
          }, { forceTrace: opts.forceTrace }),
        )
        const failed = doc.cells.filter((c) => c.error)
        console.log(`[monitor] run ${doc.run_timestamp}: ${doc.cells.length} cell(s), ${doc.alerts_emitted} alert(s)${doc.halted ? `, HALTED: ${doc.halted}` : ''}`)
        for (const cell of failed) console.error(`[monitor]   ${cell.cell} FAILED: ${cell.error}`)
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
      const { traceCase } = await import('./monitor/tracker.js')
      const { renderCase } = await import('./monitor/render/index.js')
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
          await withGraphMcpClient('chain-insights-cli-monitor', async (client) =>
            runMonitorOnce(client, workspaceRoot, config, Date.now(), {
              traceCase: (c, root, id, hops, now) => traceCase(c, root, id, hops, now),
              renderCase: (c, root, id, cfg, now) => renderCase(c, root, id, cfg, now),
            }),
          ).catch((err) => console.error(`[monitor] run failed: ${(err as Error).message}`))
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
  .description('Render the human-readable case dossier, address notes and timeline (re-traces changed cases)')
  .argument('[case_id]', 'Render one case instead of all open cases')
  .option('--force', 'Re-trace and re-render even when the case is unchanged')
  .action(async (caseId: string | undefined, opts: { force?: boolean }) => {
    try {
      const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
      const workspaceRoot = requireWorkspaceRoot()
      const { loadMonitorConfig } = await import('./monitor/config.js')
      const { renderCase, renderAllCases } = await import('./monitor/render/index.js')
      const config = await loadMonitorConfig(workspaceRoot)
      const outcomes = await withGraphMcpClient('chain-insights-cli-monitor-render', async (client) =>
        caseId
          ? [await renderCase(client, workspaceRoot, caseId, config, Date.now(), { force: opts.force })]
          : renderAllCases(client, workspaceRoot, config, Date.now(), { force: opts.force }),
      )
      if (outcomes.length === 0) console.log('[render] no open cases')
      for (const o of outcomes) {
        console.log(o.rendered
          ? `[render] ${o.case_id}: rendered → ${o.dossier_path}`
          : `[render] ${o.case_id}: skipped (${o.skipped_reason})`)
      }
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

monitor
  .command('status')
  .description('Show monitor status: cells, open cases, pending reviews, unacked alerts, last run')
  .action(async () => {
    try {
      const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
      const workspaceRoot = requireWorkspaceRoot()
      const { loadMonitorConfig } = await import('./monitor/config.js')
      const { statusText } = await import('./monitor/report.js')
      const config = await loadMonitorConfig(workspaceRoot)
      console.log(await statusText(workspaceRoot, config))
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

monitor
  .command('init')
  .description('Bootstrap a monitor profile in this workspace (victim: stolen-funds watch with event-driven tracing)')
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
      console.log(`  config:    ${result.configPath} (profile: victim, trace_mode: on_movement)`)
      console.log(`  watchlist: ${result.watchlisted.length} managed seed entr${result.watchlisted.length === 1 ? 'y' : 'ies'} (managed_by: case:${result.monitorCase.case_id})`)
      console.log('')
      console.log('Next steps:')
      console.log('  cia monitor run          # bootstrap trace now — the first pass always traces')
      console.log('  cia monitor watch        # hourly loop; keep it alive under pm2 (docs/monitoring.md "Scheduling")')
      console.log('  cia monitor alerts list  # alerts, including watchlist_activity movement tripwires')
      console.log(`Dossier after the first trace: published/cases/${result.monitorCase.case_id}/dossier.md`)
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
      const { monitorCase, alreadyClosed, managedKept } = await closeCase(workspaceRoot, caseId, Date.now())
      if (alreadyClosed) {
        console.warn(`Warning: case "${caseId}" is already closed (closed_at ${monitorCase.closed_at_timestamp}); nothing changed.`)
      } else {
        console.log(`Case closed: ${monitorCase.case_id}`)
      }
      if (managedKept > 0) {
        console.log(`Kept ${managedKept} managed watchlist entr${managedKept === 1 ? 'y' : 'ies'} (managed_by case:${caseId}) as the dormancy tripwire: new activity on them raises a case_reactivated alert. Remove them with \`cia monitor watchlist remove\` only if the topology should stop being watched.`)
      } else {
        console.log('No managed watchlist entries exist for this case; there is no reactivation tripwire to keep.')
      }
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

const monitorWatchlist = monitor
  .command('watchlist')
  .description('Manage the my-address watchlist (alerts when detections or case movements touch your addresses)')

monitorWatchlist
  .command('add')
  .description('Watch an address for detector findings, case movements, and incoming dust')
  .argument('<address>', 'Address to watch')
  .requiredOption('--network <network>', 'Network for this address. Run `cia mcp networks` for supported networks.')
  .option('--note <text>', 'Optional free-text note')
  .action(async (address: string, opts: { network: string; note?: string }) => {
    try {
      const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
      const { addWatched } = await import('./monitor/watchlist.js')
      const list = await addWatched(requireWorkspaceRoot(), { address, network: opts.network, note: opts.note })
      console.log(`Watching ${address} (${opts.network}); ${list.length} address(es) on the watchlist`)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

monitorWatchlist
  .command('list')
  .description('List watched addresses')
  .action(async () => {
    try {
      const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
      const { listWatched } = await import('./monitor/watchlist.js')
      const list = await listWatched(requireWorkspaceRoot())
      if (list.length === 0) {
        console.log('Watchlist is empty. Add one with: cia monitor watchlist add <address> --network <network>')
        return
      }
      for (const e of list) console.log(`${e.network}\t${e.address}${e.managed_by ? `\t[${e.managed_by}]` : ''}${e.note ? `\t${e.note}` : ''}`)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

monitorWatchlist
  .command('remove')
  .description('Stop watching an address')
  .argument('<address>', 'Address to stop watching')
  .requiredOption('--network <network>', 'Network for this address')
  .action(async (address: string, opts: { network: string }) => {
    try {
      const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
      const { removeWatched } = await import('./monitor/watchlist.js')
      const list = await removeWatched(requireWorkspaceRoot(), address, opts.network)
      console.log(`Stopped watching ${address} (${opts.network}); ${list.length} address(es) remain`)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

const monitorReview = monitor
  .command('review')
  .description('Human review of machine-produced findings before they become case expansion or labels')

monitorReview
  .command('list')
  .description('List pending (undecided) findings documents')
  .action(async () => {
    try {
      const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
      const workspaceRoot = requireWorkspaceRoot()
      const { listPending } = await import('./monitor/review.js')
      const pending = await listPending(workspaceRoot)
      if (pending.length === 0) {
        console.log('(no pending reviews)')
        return
      }
      console.log('doc_path\ttool\tnetwork\tfindings_count')
      for (const p of pending) console.log(`${p.doc_path}\t${p.tool}\t${p.network}\t${p.findings_count}`)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

monitorReview
  .command('approve')
  .description('Approve a findings document: writes a reviewer-stamped copy plus a decision record')
  .argument('<doc-path>', 'Path to the findings document to approve')
  .option('--reviewer <id>', 'Reviewer identity (falls back to the configured reviewer)')
  .option('--force', 'Supersede an existing decision for this document (append-only: writes a new decision recording what it supersedes)')
  .action(async (docPath: string, opts: { reviewer?: string; force?: boolean }) => {
    try {
      const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
      const workspaceRoot = requireWorkspaceRoot()
      const { loadMonitorConfig } = await import('./monitor/config.js')
      const config = await loadMonitorConfig(workspaceRoot)
      const reviewer = opts.reviewer ?? config.reviewer
      if (!reviewer) throw new Error('Reviewer identity is required: pass --reviewer <id> or set "reviewer" in monitor config')
      const { approveDoc } = await import('./monitor/review.js')
      const result = await approveDoc(workspaceRoot, docPath, reviewer, Date.now(), { force: opts.force })
      if (result.superseded) console.log(`Superseded prior decision: ${result.superseded}`)
      console.log(`Approved. Reviewed copy: ${result.reviewedCopy}`)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

monitorReview
  .command('reject')
  .description('Reject a findings document: writes a decision record only, no reviewed copy')
  .argument('<doc-path>', 'Path to the findings document to reject')
  .option('--reviewer <id>', 'Reviewer identity (falls back to the configured reviewer)')
  .option('--force', 'Supersede an existing decision for this document (append-only: writes a new decision recording what it supersedes)')
  .action(async (docPath: string, opts: { reviewer?: string; force?: boolean }) => {
    try {
      const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
      const workspaceRoot = requireWorkspaceRoot()
      const { loadMonitorConfig } = await import('./monitor/config.js')
      const config = await loadMonitorConfig(workspaceRoot)
      const reviewer = opts.reviewer ?? config.reviewer
      if (!reviewer) throw new Error('Reviewer identity is required: pass --reviewer <id> or set "reviewer" in monitor config')
      const { rejectDoc } = await import('./monitor/review.js')
      const result = await rejectDoc(workspaceRoot, docPath, reviewer, Date.now(), { force: opts.force })
      if (result.superseded) console.log(`Superseded prior decision: ${result.superseded}`)
      console.log(`Rejected: ${docPath}`)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

monitor
  .command('report')
  .description('Write a markdown rollup report over derived store state (runs, pending review, alerts, case timelines)')
  .action(async () => {
    try {
      const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
      const workspaceRoot = requireWorkspaceRoot()
      const { writeReport } = await import('./monitor/report.js')
      const reportPath = await writeReport(workspaceRoot, Date.now())
      console.log(`Report written: ${reportPath}`)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

const monitorExport = monitor
  .command('export')
  .description('Export reviewer-approved findings as curated labels')

monitorExport
  .command('labels')
  .description('Export approved findings to labels-<ms>.json and labels-<ms>.csv')
  .action(async () => {
    try {
      const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
      const workspaceRoot = requireWorkspaceRoot()
      const { exportLabels } = await import('./monitor/export.js')
      const result = await exportLabels(workspaceRoot, Date.now())
      console.log(`Exported ${result.rows.length} label row(s)`)
      console.log(`JSON: ${result.jsonPath}`)
      console.log(`CSV:  ${result.csvPath}`)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

const monitorAlerts = monitor
  .command('alerts')
  .description('Monitor-emitted alert stream: new findings, case movements, cashout/frontier signals')

monitorAlerts
  .command('list')
  .description('List alerts (unacked only by default)')
  .option('--all', 'Include acked alerts')
  .action(async (opts: { all?: boolean }) => {
    try {
      const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
      const workspaceRoot = requireWorkspaceRoot()
      const { listAlerts } = await import('./monitor/alerts.js')
      const alerts = await listAlerts(workspaceRoot, { unackedOnly: !opts.all })
      if (alerts.length === 0) {
        console.log('(no alerts)')
        return
      }
      for (const a of alerts) {
        const detectorOrCase = a.detector ?? a.case_id ?? ''
        const addressOrCount = a.address ?? a.count ?? ''
        const labelPair = a.label ? ` ${a.label}(${a.source ?? ''})` : ''
        console.log(`${a.alert_id} ${a.type} ${a.network} ${detectorOrCase} ${addressOrCount}${labelPair}`)
      }
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

monitorAlerts
  .command('ack')
  .description('Acknowledge an alert')
  .argument('<alert-id>', 'Alert identifier')
  .action(async (alertId: string) => {
    try {
      const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
      const workspaceRoot = requireWorkspaceRoot()
      const { ackAlert } = await import('./monitor/alerts.js')
      await ackAlert(workspaceRoot, alertId, Date.now())
      console.log(`Acked: ${alertId}`)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

monitor
  .command('rebuild')
  .description('Rebuild the derived DuckDB store from canonical workspace JSON')
  .action(async () => {
    try {
      const { requireWorkspaceRoot } = await import('./workspace/output-root.js')
      const workspaceRoot = requireWorkspaceRoot()
      const { rebuildStore } = await import('./monitor/store.js')
      const count = await rebuildStore(workspaceRoot)
      console.log(`Rebuilt store: ${count} doc(s) ingested`)
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
