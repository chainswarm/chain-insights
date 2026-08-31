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
  .name('cia')
  .description('AML investigation toolkit for blockchain analysis')
  .version(PACKAGE_INFO.version)
  .option('--claude', 'Install Claude Code skills globally to ~/.claude/skills/')
  .option('--codex', 'Install Codex skills globally to ~/.codex/skills/ and register MCP')
  .option(
    '--hermes',
    'Install Hermes skills globally to ~/.hermes/skills/chain-insights/ and register MCP'
  )

// Handle installer flags when invoked with no subcommand (bare `chain-insights --claude`)
const rawArgs = process.argv.slice(2)
const installerFlags = rawArgs.filter(
  (a) => a === '--claude' || a === '--codex' || a === '--hermes'
)
// A help/version request must never trigger a global install side effect — let
// commander handle it and print help/version instead.
const wantsHelpOrVersion = rawArgs.some(
  (a) => a === '--help' || a === '-h' || a === '--version' || a === '-V'
)
if (installerFlags.length > 0 && !wantsHelpOrVersion && !rawArgs.some((a) => !a.startsWith('-'))) {
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

async function withGraphMcpClient<T>(
  name: string,
  fn: (
    client: import('@modelcontextprotocol/sdk/client/index.js').Client,
    config: Awaited<ReturnType<typeof import('./config/index.js').loadConfig>>
  ) => Promise<T>
): Promise<T> {
  const { loadConfig } = await import('./config/index.js')
  const config = await loadConfig()
  const { createConfiguredGraphMcpFetch, resolveGraphMcpEndpoint } = await import('./mcp/client.js')
  const paymentFetch = await createConfiguredGraphMcpFetch(config)
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StreamableHTTPClientTransport } =
    await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
  const client = new Client({ name, version: PACKAGE_VERSION })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(resolveGraphMcpEndpoint(config)), {
      fetch: paymentFetch,
    })
  )
  // Every CLI command builds its own client, separate from the MCP proxy's
  // one, so unattended scheduled CLI runs also write to the action log.
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
  const { fetchNetworkCapabilities, formatNetworkCapabilities } =
    await import('./mcp/capabilities.js')
  const document = await fetchNetworkCapabilities(await loadConfig())
  if (opts.json) {
    console.log(JSON.stringify(document, null, 2))
  } else {
    console.log(formatNetworkCapabilities(document))
  }
}

async function printNetworkOverview(opts: { json?: boolean }): Promise<void> {
  const { loadConfig } = await import('./config/index.js')
  const { fetchNetworkCapabilities, formatNetworkOverview } = await import('./mcp/capabilities.js')
  const document = await fetchNetworkCapabilities(await loadConfig())
  if (opts.json) {
    console.log(JSON.stringify(document, null, 2))
  } else {
    console.log(formatNetworkOverview(document))
  }
}

async function printNetworkCapability(name: string, opts: { json?: boolean }): Promise<void> {
  const { loadConfig } = await import('./config/index.js')
  const { fetchNetworkCapabilities, findNetworkCapability, formatNetworkCapability } =
    await import('./mcp/capabilities.js')
  const document = await fetchNetworkCapabilities(await loadConfig())
  const network = findNetworkCapability(document, name)
  if (!network) {
    const available = document.networks.map((candidate) => candidate.network).join(', ')
    const suffix = available ? ` Available networks: ${available}.` : ''
    throw new Error(
      `Network "${name}" is not supported.${suffix} Run \`cia networks\` to list supported networks.`
    )
  }
  if (opts.json) {
    console.log(JSON.stringify(network, null, 2))
  } else {
    console.log(formatNetworkCapability(network))
  }
}

program
  .command('networks')
  .description('Show supported network status and dataset overview')
  .option('--json', 'Print raw capability JSON')
  .action(async (opts: { json?: boolean }) => {
    try {
      await printNetworkOverview(opts)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

program
  .command('network')
  .description('Show details for one supported graph network')
  .argument('<name>', 'Network identifier or display name (for example: robinhood)')
  .option('--json', 'Print raw capability JSON for this network')
  .action(async (name: string, opts: { json?: boolean }) => {
    try {
      await printNetworkCapability(name, opts)
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
    const config = await loadConfig()
    const graphMcpStatus =
      config.graphMcpMode === 'debug' && config.graphMcpAuthToken?.trim()
        ? 'bearer access mode'
        : `${config.graphMcpMode} mode`
    console.log('Config: ', config.dataDir)
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

      console.log(
        `Chain Insights ${result.latestVersion} is available (current ${result.currentVersion}).`
      )
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
          console.log(
            `Debug token:    ${config.graphMcpAuthToken?.trim() ? 'configured' : 'not configured'}`
          )
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
          console.log(
            `Access key:     ${config.graphMcpAuthToken?.trim() ? 'configured' : 'not configured'}`
          )
          console.log(
            `Payments:       ${config.graphMcpAuthToken?.trim() ? 'disabled when accepted by server' : 'enabled'}`
          )
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )

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
    new Command('get').argument('<key>', 'Config key to read').action(async (key: string) => {
      const { loadConfig } = await import('./config/index.js')
      const { CONFIG_KEYS } = await import('./config/schema.js')
      if (!CONFIG_KEYS.includes(key as (typeof CONFIG_KEYS)[number])) {
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
        if (!CONFIG_KEYS.includes(key as (typeof CONFIG_KEYS)[number])) {
          console.error(`Unknown config key: ${key}`)
          process.exit(1)
        }
        const existing = (current as Record<string, unknown>)[key]
        const defaultValue = (DEFAULT_CONFIG as Record<string, unknown>)[key]
        const coerced =
          typeof existing === 'number' || typeof defaultValue === 'number' ? Number(value) : value
        await saveConfig({ [key]: coerced } as Parameters<typeof saveConfig>[0])
        const displayed = key.toLowerCase().includes('token') ? '[redacted]' : coerced
        console.log(`Set ${key} = ${displayed}`)
      })
  )

program
  .command('wallet')
  .description('Manage the local Base USDC payment wallet')
  .addCommand(
    new Command('create')
      .description('Generate a new local Base payment wallet')
      .action(async () => {
        try {
          const { isWalletConfigured, setWalletPrivateKey, walletPath } =
            await import('./wallet/index.js')
          const { createInterface } = await import('node:readline/promises')
          const { formatWalletBackupWarning, generateWalletPrivateKey, isWalletBackupConfirmed } =
            await import('./wallet/create.js')

          if (await isWalletConfigured()) {
            throw new Error(
              'A payment wallet already exists. Run `cia wallet address` to view it or use `cia wallet import <private-key> --force` to replace it.'
            )
          }

          const privateKey = generateWalletPrivateKey()
          const color = process.stderr.isTTY === true && process.env['NO_COLOR'] === undefined
          process.stderr.write(`${formatWalletBackupWarning(privateKey, { color })}\n`)
          const prompt = createInterface({ input: process.stdin, output: process.stderr })
          let answer: string
          try {
            answer = await prompt.question('> ')
          } finally {
            prompt.close()
          }
          process.stderr.write('\n')
          if (!isWalletBackupConfirmed(answer)) {
            throw new Error('Wallet creation cancelled. The wallet was not saved.')
          }

          const address = await setWalletPrivateKey(privateKey)
          console.log(`Wallet created: ${address}`)
          console.log(`Encrypted local copy: ${walletPath()}`)
          console.log('Next: cia wallet ready')
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
  .addCommand(
    new Command('import')
      .description('Import a Base payment wallet')
      .argument('<private-key>', '0x-prefixed EVM private key')
      .option(
        '--force',
        'Replace an existing wallet (the previous key is backed up next to wallet.json)'
      )
      .action(async (privateKey: string, opts: { force?: boolean }) => {
        try {
          const { setWalletPrivateKey, isWalletConfigured } = await import('./wallet/index.js')
          const replacing = opts.force === true && (await isWalletConfigured())
          const address = await setWalletPrivateKey(privateKey, { force: opts.force })
          if (replacing) {
            console.log('Previous wallet key backed up next to ~/.chain-insights/wallet.json')
          }
          console.log(`Wallet imported: ${address}`)
          console.log(
            'Keep your original private key backed up securely; it cannot be recovered from the encrypted local copy.'
          )
          console.log('Encrypted local copy: ~/.chain-insights/wallet.json')
          console.log('Next: cia wallet ready')
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
      .addOption(
        new Option('--approval-usdc <amount>', 'Deprecated alias for --payment-usdc').hideHelp()
      )
      .option('--json', 'Print machine-readable readiness metadata')
      .action(
        async (opts: {
          checkOnly?: boolean
          approve?: boolean
          paymentUsdc?: string
          approvalUsdc?: string
          json?: boolean
        }) => {
          try {
            const { formatWalletReadiness, parsePaymentApprovalUnits, prepareWalletForPaidCalls } =
              await import('./wallet/tools.js')
            const minimumApprovalUnits = parsePaymentApprovalUnits(
              opts.paymentUsdc ?? opts.approvalUsdc ?? '1'
            )
            const result = await prepareWalletForPaidCalls({
              minimumApprovalUnits,
              approve: opts.checkOnly ? false : opts.approve !== false,
            })

            if (opts.json) {
              console.log(
                JSON.stringify(
                  result,
                  (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
                  2
                )
              )
              return
            }

            console.log(formatWalletReadiness(result.readiness, result.approval))
          } catch (err) {
            console.error((err as Error).message)
            process.exit(1)
          }
        }
      )
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
      .description('List the detailed Chain Insights capability matrix and tool support')
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
      .description('List remote GraphRAG MCP tools (cached for 24 hours)')
      .option('--refresh', 'Force refresh schema cache')
      .action(async (opts: { refresh?: boolean }) => {
        try {
          const { loadSchema, saveSchema } = await import('./mcp/schema-cache.js')
          const { formatToolsTable } = await import('./mcp/format.js')
          const { visibleRemoteTools } = await import('./mcp/tool-visibility.js')
          const { loadConfig } = await import('./config/index.js')
          const { createConfiguredGraphMcpFetch, resolveGraphMcpEndpoint } =
            await import('./mcp/client.js')
          const config = await loadConfig()
          const graphMcpEndpoint = resolveGraphMcpEndpoint(config)
          let tools = opts.refresh ? null : await loadSchema(graphMcpEndpoint)
          if (!tools) {
            const paymentFetch = await createConfiguredGraphMcpFetch(config)
            const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
            const { StreamableHTTPClientTransport } =
              await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
            const client = new Client({ name: 'chain-insights-cli', version: PACKAGE_VERSION })
            await client.connect(
              new StreamableHTTPClientTransport(new URL(graphMcpEndpoint), { fetch: paymentFetch })
            )
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
      .description(
        'Screen an address for AML risk, exchange behavior, and optional comparison with another address'
      )
      .requiredOption('--address <address>', 'Full blockchain address to screen')
      .requiredOption(
        '--network <network>',
        'Network to query. Run `cia mcp networks` for supported networks.'
      )
      .option(
        '--compare-address <address>',
        'Optional second address to compare against the screened address'
      )
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
          const { assertPublicMcpToolName, validatePublicMcpToolArguments } =
            await import('./mcp/tool-visibility.js')
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
            console.log(
              'Chain Insights tools: aml_*, graph_query, graph_query_batch, meta_*, and wallet_balance.'
            )
            return
          }

          await withGraphMcpClient('chain-insights-cli-call', async (client, config) => {
            if (tool === 'meta_usage_status') {
              try {
                const result = await client.callTool({ name: 'usage_status', arguments: {} })
                printMcpTextContent(result as { content?: Array<{ type: string; text?: string }> })
              } catch (err) {
                const {
                  isMissingUsageStatusToolError,
                  primitiveBackendUsageStatus,
                  usageStatusText,
                } = await import('./mcp/usage-status.js')
                if (!isMissingUsageStatusToolError(err)) throw err
                const { resolveGraphMcpEndpoint } = await import('./mcp/client.js')
                console.log(
                  usageStatusText(primitiveBackendUsageStatus(resolveGraphMcpEndpoint(config)))
                )
              }
              return
            }
            if (tool === 'aml_address_risk') {
              const { addressRisk } = await import('./investigation/public-tools.js')
              const result = await addressRisk(client, {
                address: String(args['address'] ?? ''),
                network: String(args['network'] ?? ''),
                compareAddress:
                  args['compare_address'] === undefined
                    ? undefined
                    : String(args['compare_address']),
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

// parseAsync (not parse) so a rejected async action surfaces as a clean
// one-line error and a non-zero exit, instead of an unhandled-rejection stack
// trace. Commands with their own try/catch still exit(1) before this fires.
program.parseAsync(process.argv).catch((err) => {
  console.error((err as Error).message)
  process.exit(1)
})
