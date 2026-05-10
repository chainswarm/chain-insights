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

program.parse(process.argv)
