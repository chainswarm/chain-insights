import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// ESM-safe package.json read — use import.meta.url, not __dirname.
const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { version: string; name: string }

// Resolve bin/install.cjs relative to this file's location in dist/
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const installerPath = path.resolve(__dirname, '..', 'bin', 'install.cjs')

const program = new Command()

program
  .name('chain-insights')
  .description('AML investigation toolkit for blockchain analysis')
  .version(pkg.version)
  .option('--claude', 'Install Claude Code skills globally to ~/.claude/skills/')

// Handle --claude when invoked with no subcommand (bare `chain-insights --claude`)
const rawArgs = process.argv.slice(2)
if (rawArgs.includes('--claude') && !rawArgs.some(a => !a.startsWith('-'))) {
  try {
    execFileSync(process.execPath, [installerPath, '--claude'], { stdio: 'inherit' })
  } catch (err) {
    console.error('Installation failed:', (err as Error).message)
    process.exit(1)
  }
  process.exit(0)
}

program
  .command('serve')
  .description('Start local visualization server')
  .option('-p, --port <number>', 'Port to bind (default: 4321)', '4321')
  .action(async (opts: { port: string }) => {
    const { startServer } = await import('./server/index.js')
    startServer(parseInt(opts.port, 10))
  })

program
  .command('status')
  .description('Show toolkit status and database health')
  .action(async () => {
    const { healthCheck } = await import('./db/index.js')
    const { loadConfig } = await import('./config/index.js')
    const [db, config] = await Promise.all([healthCheck(), loadConfig()])
    console.log('DB:     ', db.ok ? 'healthy' : `error — ${db.error ?? 'unknown'}`)
    console.log('Config: ', config.dataDir)
    console.log('Server: ', `http://127.0.0.1:${config.serverPort}`)
  })

program
  .command('config')
  .description('Read or write configuration values')
  .addCommand(
    new Command('get')
      .argument('<key>', 'Config key to read')
      .action(async (key: string) => {
        const { loadConfig } = await import('./config/index.js')
        const config = await loadConfig()
        const value = (config as Record<string, unknown>)[key]
        if (value === undefined) {
          console.error(`Unknown config key: ${key}`)
          process.exit(1)
        }
        console.log(value)
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
            const { encryptKey } = await import('./wallet/index.js')
            await encryptKey(value)
            console.log('Wallet private key encrypted and stored in ~/.chain-insights/wallet.json')
          } catch (err) {
            console.error((err as Error).message)
            process.exit(1)
          }
          return // MUST return — walletPrivateKey must never reach saveConfig or config.json
        }
        const { loadConfig, saveConfig } = await import('./config/index.js')
        const current = await loadConfig()
        const existing = (current as Record<string, unknown>)[key]
        if (existing === undefined) {
          console.error(`Unknown config key: ${key}`)
          process.exit(1)
        }
        const coerced = typeof existing === 'number' ? Number(value) : value
        await saveConfig({ [key]: coerced } as Parameters<typeof saveConfig>[0])
        console.log(`Set ${key} = ${coerced}`)
      })
  )

program
  .command('mcp')
  .description('Interact with the Chain Insights MCP endpoint')
  .addCommand(
    new Command('tools')
      .description('List available MCP tools (cached 24h)')
      .option('--refresh', 'Force refresh schema cache')
      .action(async (opts: { refresh?: boolean }) => {
        try {
          const { loadSchema, saveSchema } = await import('./mcp/schema-cache.js')
          const { formatToolsTable } = await import('./mcp/format.js')
          const { loadConfig } = await import('./config/index.js')
          let tools = opts.refresh ? null : await loadSchema()
          if (!tools) {
            const { isWalletConfigured, decryptKey } = await import('./wallet/index.js')
            if (!(await isWalletConfigured())) {
              console.error('Wallet not configured. Run `chain-insights config set walletPrivateKey <key>` to enable paid MCP calls')
              process.exit(1)
            }
            const config = await loadConfig()
            const { createMcpFetchClient } = await import('./mcp/client.js')
            const privateKey = await decryptKey()
            const paymentFetch = createMcpFetchClient(privateKey as `0x${string}`)
            const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
            const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
            const client = new Client({ name: 'chain-insights-cli', version: '0.1.0' })
            await client.connect(new StreamableHTTPClientTransport(new URL(config.mcpEndpoint), { fetch: paymentFetch }))
            const result = await client.listTools()
            tools = result.tools as Array<{ name: string; description?: string }>
            await saveSchema(tools)
            await client.close()
          }
          console.log(formatToolsTable(tools))
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
          const args: Record<string, string> = {}
          for (const pair of rawArgs) {
            const eqIdx = pair.indexOf('=')
            if (eqIdx === -1) {
              console.error(`Invalid arg format: ${pair} (expected key=value)`)
              process.exit(1)
            }
            args[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1)
          }
          const { isWalletConfigured, decryptKey } = await import('./wallet/index.js')
          if (!(await isWalletConfigured())) {
            console.error('Wallet not configured. Run `chain-insights config set walletPrivateKey <key>` to enable paid MCP calls')
            process.exit(1)
          }
          const { loadConfig } = await import('./config/index.js')
          const config = await loadConfig()
          const { createMcpFetchClient } = await import('./mcp/client.js')
          const privateKey = await decryptKey()
          const paymentFetch = createMcpFetchClient(privateKey as `0x${string}`)
          const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
          const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
          const client = new Client({ name: 'chain-insights-cli-call', version: '0.1.0' })
          await client.connect(new StreamableHTTPClientTransport(new URL(config.mcpEndpoint), { fetch: paymentFetch }))
          const result = await client.callTool({ name: tool, arguments: args })
          const content = result.content as Array<{ type: string; text?: string }>
          for (const item of content) {
            if (item.type === 'text') console.log(item.text)
          }
          await client.close()
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )

program.parse(process.argv)
