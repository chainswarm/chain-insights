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
            try {
              const result = await client.listTools()
              tools = result.tools as Array<{ name: string; description?: string }>
              await saveSchema(tools)
            } finally {
              await client.close()
            }
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
          try {
            const result = await client.callTool({ name: tool, arguments: args })
            const content = result.content as Array<{ type: string; text?: string }>
            for (const item of content) {
              if (item.type === 'text') console.log(item.text)
            }
          } finally {
            await client.close()
          }
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )

program
  .command('case')
  .description('Manage investigation cases')
  .addCommand(
    new Command('open')
      .description('Open a new investigation case')
      .argument('<name>', 'Case name (e.g. "Tornado Mixer Investigation")')
      .option('--tags <tags>', 'Comma-separated tags (e.g. aml,mixer,defi)', '')
      .option('--description <desc>', 'Brief description of the investigation', '')
      .action(async (name: string, opts: { tags: string; description: string }) => {
        try {
          const { getDb, initSchema } = await import('./db/init.js')
          const { CaseStore } = await import('./cases/index.js')
          const conn = await getDb()
          await initSchema(conn)
          conn.closeSync()
          const tags = opts.tags ? opts.tags.split(',').map(t => t.trim()).filter(Boolean) : []
          const c = await CaseStore.create({ name, tags, description: opts.description })
          console.log(`Case opened: ${c.id}`)
          console.log(`Directory:   ~/.chain-insights/cases/${c.id}/`)
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
      .action(async (caseId: string) => {
        try {
          const { getDb, initSchema } = await import('./db/init.js')
          const { CaseStore } = await import('./cases/index.js')
          const conn = await getDb()
          await initSchema(conn)
          conn.closeSync()
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
      .action(async (caseId: string) => {
        try {
          const { getDb, initSchema } = await import('./db/init.js')
          const { CaseStore } = await import('./cases/index.js')
          const conn = await getDb()
          await initSchema(conn)
          conn.closeSync()
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
      .action(async (caseId: string) => {
        try {
          const { getDb, initSchema } = await import('./db/init.js')
          const { CaseStore } = await import('./cases/index.js')
          const conn = await getDb()
          await initSchema(conn)
          conn.closeSync()
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
          const { getDb, initSchema } = await import('./db/init.js')
          const { CaseStore } = await import('./cases/index.js')
          const conn = await getDb()
          await initSchema(conn)
          conn.closeSync()
          const cases = await CaseStore.list()
          const filtered = opts.status ? cases.filter(c => c.status === opts.status) : cases
          if (filtered.length === 0) {
            console.log('No cases found.')
            return
          }
          for (const c of filtered) {
            console.log(`${c.id}  [${c.status}]  ${c.name}`)
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
          .action(async (caseId: string, opts: { source: string; content: string; queryParams: string }) => {
            try {
              const { EvidenceStore } = await import('./cases/index.js')
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
          .action(async (caseId: string) => {
            try {
              const { EvidenceStore } = await import('./cases/index.js')
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
          .action(async (caseId: string, address: string, opts: { finding: string; type: string }) => {
            try {
              const { DossierStore } = await import('./cases/index.js')
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
          .action(async (caseId: string) => {
            try {
              const { SessionStore } = await import('./cases/index.js')
              const s = await SessionStore.start(caseId)
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
          .action(async (caseId: string, opts: { findings: string; nextSteps: string }) => {
            try {
              const { SessionStore } = await import('./cases/index.js')
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
    new Command('resume')
      .description('Resume a case — restore investigation context for agent injection')
      .argument('<case-id>', 'Case ID to resume')
      .action(async (caseId: string) => {
        try {
          const { getDb, initSchema } = await import('./db/init.js')
          const { CaseStore } = await import('./cases/index.js')
          const conn = await getDb()
          await initSchema(conn)
          conn.closeSync()
          const ctx = await CaseStore.loadContext(caseId)
          console.log(`\n=== Case Resume: ${ctx.case.id} ===`)
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
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )

program.parse(process.argv)
