import type { Command } from 'commander'
import { PACKAGE_VERSION } from '../version.js'
import type { SubscriptionStatusFacts } from '../mcp/subscription-status.js'

// `cia subscription topup | buy --days N | status`. Registered by src/cli.ts.
// buy is a terminal command only: no MCP tool can buy.

type CommandFactory = (name: string) => Command

interface StatusReader {
  /** The status of the proven wallet, or null when it cannot be read. */
  read(): Promise<SubscriptionStatusFacts | null>
  /** The server's own words when the last read failed. */
  lastError(): string | null
}

/** One MCP session to the configured graph endpoint, for the status reads. */
async function withStatusReader<T>(fn: (reader: StatusReader) => Promise<T>): Promise<T> {
  const { loadConfig } = await import('../config/index.js')
  const config = await loadConfig()
  const { createConfiguredGraphMcpFetch, resolveGraphMcpEndpoint } = await import('../mcp/client.js')
  const { toGraphMcpEndpointError } = await import('../mcp/transport-error.js')
  const endpoint = resolveGraphMcpEndpoint(config)
  const fetchImpl = await createConfiguredGraphMcpFetch(config)
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
  const client = new Client({ name: 'chain-insights-cli-subscription', version: PACKAGE_VERSION })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), { fetch: fetchImpl }))
  } catch (err) {
    throw toGraphMcpEndpointError(err, endpoint)
  }
  try {
    const { parseSubscriptionStatusToolResult, subscriptionStatusArguments, subscriptionStatusNeedsWallet } =
      await import('../mcp/subscription-status.js')
    const remote = (await client.listTools()).tools.find((tool) => tool.name === 'subscription_status')
    let wallet: string | null = null
    if (remote && subscriptionStatusNeedsWallet(remote)) {
      const { getWalletAccount } = await import('../wallet/tools.js')
      wallet = (await getWalletAccount()).address
    }
    let lastError: string | null = remote ? null : `${endpoint} serves no subscription_status tool.`
    return await fn({
      async read() {
        if (!remote) return null
        try {
          const result = await client.callTool({
            name: 'subscription_status',
            arguments: subscriptionStatusArguments(remote, wallet),
          })
          const facts = parseSubscriptionStatusToolResult(result)
          if (facts) {
            lastError = null
            return facts
          }
          const text = (result.content as Array<{ type: string; text?: string }> | undefined)?.find(
            (block) => block.type === 'text'
          )?.text
          lastError = text ?? 'The server sent a subscription status this version cannot read.'
          return null
        } catch (err) {
          lastError = (err as Error).message
          return null
        }
      },
      lastError: () => lastError,
    })
  } finally {
    await client.close()
  }
}

async function askYes(text: string): Promise<boolean> {
  const { createInterface } = await import('node:readline/promises')
  process.stderr.write(`${text}\n`)
  const prompt = createInterface({ input: process.stdin, output: process.stderr })
  try {
    return (await prompt.question('Type yes to continue: ')).trim().toLowerCase() === 'yes'
  } finally {
    prompt.close()
  }
}

function fail(err: unknown): never {
  console.error((err as Error).message)
  process.exit(1)
}

export function registerSubscriptionCommands(program: Command, command: CommandFactory): void {
  program
    .command('subscription')
    .description('Buy and check the Chain Insights subscription, paid in $CIA on Robinhood Chain')
    .addCommand(
      command('topup')
        .description('Show the wallet address and QR code to fund with $CIA and ETH on Robinhood Chain')
        .option('--no-open', 'Print the top-up page URL without opening a browser')
        .option('--json', 'Print machine-readable top-up facts')
        .action(async (opts: { open?: boolean; json?: boolean }) => {
          try {
            const { runSubscriptionTopup } = await import('./topup.js')
            await runSubscriptionTopup(opts)
          } catch (err) {
            fail(err)
          }
        })
    )
    .addCommand(
      command('buy')
        .description('Buy subscription days: approve and pay $CIA on Robinhood Chain, after your yes')
        .requiredOption('--days <n>', 'Days to buy, a whole number from 1 to 90')
        .option('--yes', 'Skip the typed yes (for a run with no terminal)')
        .option('--json', 'Print the outcome as JSON')
        .action(async (opts: { days: string; yes?: boolean; json?: boolean }) => {
          try {
            const { assertDays, fetchCiaUsdPrice } = await import('./quote.js')
            const { assertConfirmable, executeBuy, formatBuyResult } = await import('./buy.js')
            const days = Number(opts.days)
            assertDays(days)
            assertConfirmable({ stdinIsTTY: process.stdin.isTTY === true, yes: opts.yes === true })
            const { assertWalletKeyNotPublic, getWalletAccount } = await import('../wallet/tools.js')
            const account = await getWalletAccount()
            assertWalletKeyNotPublic(account)
            const result = await withStatusReader((reader) =>
              executeBuy({
                account,
                days,
                readStatus: () => reader.read(),
                fetchPrice: () => fetchCiaUsdPrice(),
                confirm: async (text) => {
                  if (opts.yes !== true) return askYes(text)
                  process.stderr.write(`${text}\nConfirmed by --yes.\n`)
                  return true
                },
                log: (line) => process.stderr.write(`${line}\n`),
              })
            )
            console.log(opts.json ? JSON.stringify(result, null, 2) : formatBuyResult(result))
          } catch (err) {
            fail(err)
          }
        })
    )
    .addCommand(
      command('status')
        .description("Show the subscription of this wallet, read by the wallet's proof")
        .option('--json', 'Print the status facts as JSON')
        .action(async (opts: { json?: boolean }) => {
          try {
            const { formatSubscriptionStatus } = await import('../mcp/subscription-status.js')
            await withStatusReader(async (reader) => {
              const facts = await reader.read()
              if (!facts) throw new Error(`Subscription status unavailable: ${reader.lastError() ?? 'no answer'}`)
              console.log(opts.json ? JSON.stringify(facts, null, 2) : formatSubscriptionStatus(facts))
            })
          } catch (err) {
            fail(err)
          }
        })
    )
}
