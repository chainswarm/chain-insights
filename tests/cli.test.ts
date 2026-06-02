import { describe, it, expect } from 'vitest'
import { execFileSync, execSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const srcCli = join(process.cwd(), 'src', 'cli.ts')
const tsxLoader = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'loader.mjs')
const cliBin = join(process.cwd(), 'bin', 'cli.js')
const cli = `node ${JSON.stringify(cliBin)}`

describe('CLI scaffold (FOUND-02)', () => {
  it('--help prints chain-insights name', () => {
    const out = execSync('node bin/cli.js --help', { encoding: 'utf8' })
    expect(out).toContain('chain-insights')
  })

  it('--help lists serve subcommand', () => {
    const out = execSync('node bin/cli.js --help', { encoding: 'utf8' })
    expect(out).toContain('serve')
  })

  it('--help lists status subcommand', () => {
    const out = execSync('node bin/cli.js --help', { encoding: 'utf8' })
    expect(out).toContain('status')
  })

  it('--help lists update subcommand', () => {
    const out = execSync('node bin/cli.js --help', { encoding: 'utf8' })
    expect(out).toContain('update')
  })

  it('update --help exposes check and dry-run flags', () => {
    const out = execFileSync('node', ['--import', tsxLoader, srcCli, 'update', '--help'], { encoding: 'utf8' })
    expect(out).toContain('--check')
    expect(out).toContain('--dry-run')
  })

  it('--help lists setup subcommand', () => {
    const out = execSync('node bin/cli.js --help', { encoding: 'utf8' })
    expect(out).toContain('setup')
  })

  it('setup --help lists claude-desktop subcommand', () => {
    const out = execSync('node bin/cli.js setup --help', { encoding: 'utf8' })
    expect(out).toContain('claude-desktop')
  })

  it('--help lists init subcommand', () => {
    const out = execSync('node bin/cli.js --help', { encoding: 'utf8' })
    expect(out).toContain('init')
  })

  it('--help lists wallet subcommand', () => {
    const out = execSync('node bin/cli.js --help', { encoding: 'utf8' })
    expect(out).toContain('wallet')
  })

  it('--help lists debug subcommand', () => {
    const out = execSync('node bin/cli.js --help', { encoding: 'utf8' })
    expect(out).toContain('debug')
  })

  it('--help lists access-key subcommand', () => {
    const out = execSync('node bin/cli.js --help', { encoding: 'utf8' })
    expect(out).toContain('access-key')
  })

  it('--help lists networks top-level alias command', () => {
    const out = execSync('node bin/cli.js --help', { encoding: 'utf8' })
    expect(out).toContain('networks')
  })

  it('--help lists obsidian subcommand', () => {
    const out = execFileSync('node', ['--import', tsxLoader, srcCli, '--help'], { encoding: 'utf8' })
    expect(out).toContain('obsidian')
  })

  it('network --help works as a top-level alias for network capabilities', () => {
    const out = execSync('node bin/cli.js network --help', { encoding: 'utf8' })
    expect(out).toContain('List supported graph networks')
  })

  it('--help lists Hermes installer flag', () => {
    const out = execSync('node bin/cli.js --help', { encoding: 'utf8' })
    expect(out).toContain('--hermes')
  })

  it('wallet --help lists balance, ready, and topup subcommands', () => {
    const out = execSync('node bin/cli.js wallet --help', { encoding: 'utf8' })
    expect(out).toContain('balance')
    expect(out).toContain('ready')
    expect(out).toContain('topup')
  })

  it('wallet --help exposes a user-facing wallet import command', () => {
    const out = execFileSync('node', ['--import', 'tsx', srcCli, 'wallet', '--help'], { encoding: 'utf8' })
    expect(out).toContain('import')
    expect(out).toContain('Import a Base payment wallet')
    expect(out).not.toContain('walletPrivateKey')
  })

  it('wallet ready help uses user-facing payment setup language', () => {
    const out = execFileSync('node', ['--import', 'tsx', srcCli, 'wallet', 'ready', '--help'], { encoding: 'utf8' })

    expect(out).toContain('--check-only')
    expect(out).toContain('--payment-usdc <amount>')
    expect(out).toMatch(/one-time\s+payment setup/)
    expect(out).not.toContain('--no-approve')
    expect(out).not.toContain('--approval-usdc')
    expect(out).not.toContain('approval')
    expect(out).not.toContain('Permit2')
  })

  it('mcp --help lists role-specific trace commands and hides legacy trace commands', () => {
    const out = execSync('node bin/cli.js mcp --help', { encoding: 'utf8' })
    expect(out).toContain('trace-victim-funds')
    expect(out).toContain('trace-suspect-funds')
    expect(out).toContain('trace-deposit-sources')
    expect(out).toContain('stake-insights')
    expect(out).not.toContain('track-funds')
    expect(out).not.toContain('scam-topology')
    expect(out).not.toContain('trace-funds')
  })

  it('mcp stake-insights help exposes staking controls', () => {
    const out = execFileSync('node', ['--import', 'tsx', srcCli, 'mcp', 'stake-insights', '--help'], { encoding: 'utf8' })
    expect(out).toContain('--address <address>')
    expect(out).toContain('--coldkey <address>')
    expect(out).toContain('--hotkey <address>')
    expect(out).toContain('--netuid <number>')
    expect(out).toContain('--start-timestamp-ms <milliseconds>')
    expect(out).toContain('--end-timestamp-ms <milliseconds>')
    expect(out).toContain('--depth <number>')
  })

  it('mcp trace-suspect-funds help exposes suspect controls without requiring an incident timestamp', () => {
    const out = execFileSync('node', ['--import', 'tsx', srcCli, 'mcp', 'trace-suspect-funds', '--help'], { encoding: 'utf8' })
    expect(out).toContain('--suspect-addresses <addresses>')
    expect(out).toContain('--incident-timestamp-ms <milliseconds>')
    expect(out).toContain('--max-hops <number>')
    expect(out).toContain('--case <id>')
    expect(out).not.toContain('--victim-address <address>')
    expect(out).not.toContain('--activity-policy <mode>')
  })

  it('fund-flow CLI help exposes only role-specific trace commands', () => {
    const out = execSync('node bin/cli.js mcp --help', { encoding: 'utf8' })
    expect(out).toContain('trace-victim-funds')
    expect(out).toContain('trace-suspect-funds')
    expect(out).toContain('trace-deposit-sources')
    expect(out).not.toContain('track-funds')
    expect(out).not.toContain('scam-topology')
    expect(out).not.toContain('trace-funds')
  })

  it.each(['track-funds', 'scam-topology', 'trace-funds'])('mcp %s is not registered', (command) => {
    expect(() => execSync(`node bin/cli.js mcp ${command} --help`, {
      encoding: 'utf8',
      stdio: 'pipe',
    })).toThrow()
  })

  it('--version prints version from package.json', () => {
    const out = execSync('node bin/cli.js --version', { encoding: 'utf8' })
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('package exposes cia as a short CLI alias', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { bin: Record<string, string> }
    expect(pkg.bin['cia']).toBe('./bin/cli.js')
  })

  it('init creates an investigation workspace in the target directory', () => {
    const parent = mkdtempSync(join(tmpdir(), 'chain-insights-cli-'))
    const target = join(parent, 'investigations')
    try {
      const out = execFileSync('node', ['--import', tsxLoader, srcCli, 'init', target], { encoding: 'utf8' })
      expect(out).toContain(`Workspace initialized: ${target}`)
      expect(readFileSync(join(target, '.chain-insights', 'workspace.json'), 'utf8')).toContain(
        `"workspace_root": "${target}"`
      )
      expect(readFileSync(join(target, '.chain-insights', 'workspace.json'), 'utf8')).toContain(
        '"graph_mcp_endpoint": "http://127.0.0.1:8012/mcp"'
      )
      const readme = readFileSync(join(target, 'README.md'), 'utf8')
      expect(readme).toContain('Chain Insights Investigation Vault')
      expect(readme).toContain('Obsidian-compatible vault')
      expect(readme).toContain('reports/graphs/    Graph JSON for visualization')
      expect(readme).not.toContain('logs/              Workspace-local investigation and preview logs')
      expect(readme).toContain('.chain-insights/runtime/        Workspace-local runtime process state and debug logs')
      expect(readme).toContain('published/         Obsidian-ready case exports and published bundles')
      expect(readFileSync(join(target, 'imports', 'README.md'), 'utf8')).toContain('External Investigation Inputs')
      expect(readFileSync(join(target, 'templates', 'README.md'), 'utf8')).toContain('Reusable Workspace Templates')
      const agents = readFileSync(join(target, 'AGENTS.md'), 'utf8')
      const claude = readFileSync(join(target, 'CLAUDE.md'), 'utf8')
      for (const body of [agents, claude]) {
        expect(body).toContain('If this directory is not initialized, run `cia init .` before investigation-producing commands.')
        expect(body).toContain('Do not rerun init in an existing workspace unless replacing scaffolding with `--force`.')
        expect(body).toContain('Investigation output must stay in this initialized workspace.')
        expect(body).toContain('Never write cases, evidence, reports, graph JSON, HTML, schema captures, or logs to ~/.chain-insights.')
      }
      expect(readFileSync(join(target, 'templates', 'case-brief.md'), 'utf8')).toContain('# Case Brief')
      const runtimeSkill = readFileSync(join(target, '.chain-insights', 'runtime-skill', 'SKILL.md'), 'utf8')
      expect(runtimeSkill).toContain('Runtime Graph Schema')
      expect(runtimeSkill).toContain('exchange hot wallets as terminal endpoints only')
      expect(readFileSync(join(target, '.chain-insights', 'schema', 'README.md'), 'utf8')).toContain('Runtime Schema Captures')
      expect(existsSync(join(target, 'artifacts'))).toBe(false)
      expect(existsSync(join(target, 'logs'))).toBe(false)
      expect(existsSync(join(target, '.chain-insights', 'runtime', 'logs', '.keep'))).toBe(true)
      expect(existsSync(join(target, '.chain-insights', 'runtime', '.keep'))).toBe(true)
      expect(existsSync(join(target, '.obsidian', 'app.json'))).toBe(true)
      expect(existsSync(join(target, 'Home.md'))).toBe(true)
      expect(existsSync(join(target, 'Cases.md'))).toBe(true)
      expect(existsSync(join(target, 'Entities.md'))).toBe(true)
      expect(existsSync(join(target, 'Evidence.md'))).toBe(true)
      expect(existsSync(join(target, 'Graphs.md'))).toBe(true)
      expect(existsSync(join(target, 'Agent Console.md'))).toBe(true)
      expect(existsSync(join(target, 'Canvases'))).toBe(true)
      expect(existsSync(join(target, 'Entities'))).toBe(true)
      expect(existsSync(join(target, 'Evidence'))).toBe(true)
      expect(existsSync(join(target, 'published'))).toBe(true)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('bin/cli.js init creates an Obsidian-compatible investigation vault', () => {
    const parent = mkdtempSync(join(tmpdir(), 'chain-insights-cli-'))
    const target = join(parent, 'packaged-investigations')
    const packageFixturesRoot = join(process.cwd(), 'workspace')
    mkdirSync(packageFixturesRoot, { recursive: true })
    const packageRoot = mkdtempSync(join(packageFixturesRoot, 'packaged-cli-'))
    try {
      mkdirSync(join(packageRoot, 'bin'), { recursive: true })
      copyFileSync(join(process.cwd(), 'bin', 'cli.js'), join(packageRoot, 'bin', 'cli.js'))
      copyFileSync(join(process.cwd(), 'package.json'), join(packageRoot, 'package.json'))
      execFileSync('npx', [
        'tsdown',
        'src/cli.ts',
        '--no-config',
        '--format',
        'esm',
        '--platform',
        'node',
        '--out-dir',
        join(packageRoot, 'dist'),
        '--shims',
        '--logLevel',
        'error',
      ], { encoding: 'utf8' })

      const out = execFileSync('node', ['bin/cli.js', 'init', target], { cwd: packageRoot, encoding: 'utf8' })
      const help = execFileSync('node', ['bin/cli.js', '--help'], { cwd: packageRoot, encoding: 'utf8' })
      const caseVaultHelp = execFileSync('node', ['bin/cli.js', 'case', 'vault', 'refresh', '--help'], {
        cwd: packageRoot,
        encoding: 'utf8',
      })

      expect(out).toContain('Workspace initialized:')
      expect(help).toContain('obsidian')
      expect(caseVaultHelp).toContain('Refresh Obsidian vault notes for a case')
      expect(existsSync(join(target, '.chain-insights', 'workspace.json'))).toBe(true)
      expect(readFileSync(join(target, 'README.md'), 'utf8')).toContain('Chain Insights Investigation Vault')
      expect(existsSync(join(target, '.obsidian', 'app.json'))).toBe(true)
      expect(existsSync(join(target, 'Home.md'))).toBe(true)
    } finally {
      rmSync(packageRoot, { recursive: true, force: true })
      rmSync(parent, { recursive: true, force: true })
    }
  }, 20_000)

  it('init creates an Obsidian-compatible investigation vault', () => {
    const parent = mkdtempSync(join(tmpdir(), 'chain-insights-cli-'))
    const target = join(parent, 'investigations')
    try {
      execFileSync('node', ['--import', tsxLoader, srcCli, 'init', target], { encoding: 'utf8' })

      const appConfig = JSON.parse(readFileSync(join(target, '.obsidian', 'app.json'), 'utf8'))
      expect(appConfig).toMatchObject({
        useMarkdownLinks: false,
        newLinkFormat: 'shortest',
        alwaysUpdateLinks: true,
      })
      expect(readFileSync(join(target, 'Home.md'), 'utf8')).toContain('[[Cases]]')
      expect(readFileSync(join(target, 'Agent Console.md'), 'utf8')).toContain('type: "chain-insights-agent-console"')
      expect(existsSync(join(target, 'Canvases'))).toBe(true)
      expect(existsSync(join(target, 'Entities'))).toBe(true)
      expect(existsSync(join(target, 'Evidence'))).toBe(true)
      expect(existsSync(join(target, 'published'))).toBe(true)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('init returns vault files in filesWritten', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'chain-insights-cli-'))
    const target = join(parent, 'investigations')
    try {
      const { initWorkspace } = await import('../src/workspace/init.js')
      const result = await initWorkspace({ targetDir: target })

      expect(result.filesWritten).toContain('.chain-insights/workspace.json')
      expect(result.filesWritten).toContain('.obsidian/app.json')
      expect(result.filesWritten).toContain('Home.md')
      expect(result.filesWritten).toContain('Agent Console.md')
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('init refuses to overwrite existing workspace files without --force', () => {
    const parent = mkdtempSync(join(tmpdir(), 'chain-insights-cli-'))
    const target = join(parent, 'investigations')
    try {
      execFileSync('node', ['--import', tsxLoader, srcCli, 'init', target], { encoding: 'utf8' })
      writeFileSync(join(target, 'README.md'), 'custom notes\n')
      expect(() => execFileSync('node', ['--import', tsxLoader, srcCli, 'init', target], { encoding: 'utf8', stdio: 'pipe' })).toThrow()
      expect(readFileSync(join(target, 'README.md'), 'utf8')).toBe('custom notes\n')
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('init preflights existing files before creating a partial workspace', () => {
    const parent = mkdtempSync(join(tmpdir(), 'chain-insights-cli-'))
    const target = join(parent, 'investigations')
    try {
      mkdirSync(target, { recursive: true })
      writeFileSync(join(target, 'README.md'), 'existing notes\n')
      expect(() => execFileSync('node', ['--import', tsxLoader, srcCli, 'init', target], { encoding: 'utf8', stdio: 'pipe' })).toThrow()
      expect(readFileSync(join(target, 'README.md'), 'utf8')).toBe('existing notes\n')
      expect(existsSync(join(target, '.chain-insights', 'workspace.json'))).toBe(false)
      expect(existsSync(join(target, 'templates'))).toBe(false)
      expect(existsSync(join(target, 'imports'))).toBe(false)
      expect(existsSync(join(target, '.obsidian', 'app.json'))).toBe(false)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('init refuses existing vault files before creating a partial workspace', () => {
    const parent = mkdtempSync(join(tmpdir(), 'chain-insights-cli-'))
    const target = join(parent, 'investigations')
    try {
      mkdirSync(target, { recursive: true })
      writeFileSync(join(target, 'Home.md'), '# Existing Home\n')
      expect(() => execFileSync('node', ['--import', tsxLoader, srcCli, 'init', target], { encoding: 'utf8', stdio: 'pipe' })).toThrow()
      expect(readFileSync(join(target, 'Home.md'), 'utf8')).toBe('# Existing Home\n')
      expect(existsSync(join(target, '.chain-insights', 'workspace.json'))).toBe(false)
      expect(existsSync(join(target, 'templates'))).toBe(false)
      expect(existsSync(join(target, '.obsidian', 'app.json'))).toBe(false)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('serve reports an occupied port without an unhandled Node error', () => {
    const script = `
      const http = require('node:http');
      const { spawnSync } = require('node:child_process');
      const { mkdtempSync } = require('node:fs');
      const { tmpdir } = require('node:os');
      const { join } = require('node:path');
      const srcCli = ${JSON.stringify(srcCli)};
      const tsxLoader = ${JSON.stringify(tsxLoader)};
      const server = http.createServer((_req, res) => res.end('busy'));
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const parent = mkdtempSync(join(tmpdir(), 'chain-insights-serve-'));
        const workspace = join(parent, 'workspace');
        spawnSync(process.execPath, ['--import', tsxLoader, srcCli, 'init', workspace], {
          cwd: process.cwd(),
          encoding: 'utf8',
        });
        const result = spawnSync(process.execPath, ['--import', tsxLoader, srcCli, 'serve', '--port', String(port)], {
          cwd: workspace,
          encoding: 'utf8',
          timeout: 2000,
        });
        server.close(() => {
          process.stdout.write(JSON.stringify({
            status: result.status,
            stderr: result.stderr,
            stdout: result.stdout,
          }));
        });
      });
    `
    const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' })
    const result = JSON.parse(out) as { status: number; stderr: string; stdout: string }
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Port already in use: 127.0.0.1:')
    expect(result.stderr).not.toContain("Unhandled 'error' event")
    expect(result.stdout).not.toContain('Chain Insights server running')
  })

  it('serve requires an initialized workspace', () => {
    const parent = mkdtempSync(join(tmpdir(), 'chain-insights-cli-'))
    const fakeHome = mkdtempSync(join(tmpdir(), 'chain-insights-home-'))
    const env = { ...process.env, HOME: fakeHome, CHAIN_INSIGHTS_WORKSPACE: '' }
    try {
      expect(() => execFileSync(process.execPath, ['--import', tsxLoader, srcCli, 'serve', '--port', '14501'], {
        cwd: parent,
        encoding: 'utf8',
        env,
        stdio: 'pipe',
        timeout: 2000,
      })).toThrow(/No Chain Insights workspace found\. Run: cia init \./)
    } finally {
      rmSync(parent, { recursive: true, force: true })
      rmSync(fakeHome, { recursive: true, force: true })
    }
  })

  it('mcp trace-victim-funds fails before workspace init and writes nothing', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'chain-insights-home-'))
    const parent = mkdtempSync(join(tmpdir(), 'chain-insights-cli-'))
    const target = join(parent, 'stolen')
    const env = { ...process.env, HOME: fakeHome, CHAIN_INSIGHTS_WORKSPACE: '' }
    try {
      mkdirSync(target, { recursive: true })
      expect(() => execFileSync(process.execPath, [
        '--import',
        tsxLoader,
        srcCli,
        'mcp',
        'trace-victim-funds',
        '--victim-addresses',
        '5GT',
        '--network',
        'bittensor',
      ], {
        cwd: target,
        encoding: 'utf8',
        env,
        stdio: 'pipe',
      })).toThrow(/No Chain Insights workspace found\. Run: cia init \./)
      expect(existsSync(join(target, 'reports'))).toBe(false)
      expect(existsSync(join(fakeHome, '.chain-insights', 'reports'))).toBe(false)
      expect(existsSync(join(fakeHome, '.chain-insights', 'artifacts'))).toBe(false)
      expect(existsSync(join(fakeHome, '.chain-insights', 'cases'))).toBe(false)
    } finally {
      rmSync(fakeHome, { recursive: true, force: true })
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('case list inside a workspace does not show global cases', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'chain-insights-home-'))
    const parent = mkdtempSync(join(tmpdir(), 'chain-insights-cli-'))
    const sourceWorkspace = join(parent, 'source')
    const target = join(parent, 'investigations')
    const env = { ...process.env, HOME: fakeHome }
    try {
      execSync(`node bin/cli.js init ${sourceWorkspace}`, { encoding: 'utf8', env })
      execSync(`${cli} case open "Global Case"`, { cwd: sourceWorkspace, encoding: 'utf8', env })
      execSync(`node bin/cli.js init ${target}`, { encoding: 'utf8', env })
      const out = execSync(`${cli} case list`, {
        cwd: target,
        encoding: 'utf8',
        env,
      })
      expect(out).toContain('No cases found.')
      expect(out).not.toContain('Global Case')
    } finally {
      rmSync(fakeHome, { recursive: true, force: true })
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('case open inside a workspace writes the case into that workspace', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'chain-insights-home-'))
    const parent = mkdtempSync(join(tmpdir(), 'chain-insights-cli-'))
    const target = join(parent, 'investigations')
    const env = { ...process.env, HOME: fakeHome }
    try {
      execSync(`node bin/cli.js init ${target}`, { encoding: 'utf8', env })
      const out = execSync(`${cli} case open "Workspace Case"`, {
        cwd: target,
        encoding: 'utf8',
        env,
      })
      const caseId = out.match(/Case opened: (.+)/)?.[1]?.trim()
      expect(caseId).toBeTruthy()
      expect(readFileSync(join(target, 'cases', caseId!, 'case.md'), 'utf8')).toContain('name: Workspace Case')
      expect(() => readFileSync(join(fakeHome, '.chain-insights', 'cases', caseId!, 'case.md'), 'utf8')).toThrow()
    } finally {
      rmSync(fakeHome, { recursive: true, force: true })
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('case open writes live Obsidian case notes', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'chain-insights-home-'))
    const parent = mkdtempSync(join(tmpdir(), 'chain-insights-case-vault-'))
    const target = join(parent, 'investigations')
    const env = { ...process.env, HOME: fakeHome }
    try {
      execFileSync('node', ['--import', tsxLoader, srcCli, 'init', target], { encoding: 'utf8', env })
      const out = execFileSync('node', ['--import', tsxLoader, srcCli, 'case', 'open', 'Live Vault Case'], {
        cwd: target,
        encoding: 'utf8',
        env,
      })
      const caseId = out.match(/Case opened: (.+)/)?.[1]?.trim()
      expect(caseId).toBeTruthy()
      expect(existsSync(join(target, 'cases', caseId!, 'Case.md'))).toBe(true)
      expect(readFileSync(join(target, 'cases', caseId!, 'Case.md'), 'utf8')).toContain('[[Agent Console]]')
      expect(existsSync(join(target, 'cases', caseId!, 'Graph.canvas'))).toBe(true)
    } finally {
      rmSync(fakeHome, { recursive: true, force: true })
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('case open still reports canonical case when live vault refresh fails', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'chain-insights-home-'))
    const parent = mkdtempSync(join(tmpdir(), 'chain-insights-case-vault-fail-'))
    const target = join(parent, 'investigations')
    const env = { ...process.env, HOME: fakeHome }
    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const expectedCaseId = `${datePrefix}_001_refresh-failure-case`
    const loaderPath = join(parent, 'mock-vault-loader.mjs')
    const registerPath = join(parent, 'mock-vault-register.mjs')
    const mockSource = [
      'export async function refreshCaseVault() {',
      "  throw new Error('mock vault refresh failure')",
      '}',
      '',
    ].join('\n')
    try {
      execFileSync('node', ['--import', tsxLoader, srcCli, 'init', target], { encoding: 'utf8', env })
      writeFileSync(loaderPath, [
        `const mockUrl = ${JSON.stringify(`data:text/javascript,${encodeURIComponent(mockSource)}`)}`,
        'export async function resolve(specifier, context, nextResolve) {',
        "  if (specifier === './vault/index.js' || specifier === './vault/index.ts') {",
        '    return { url: mockUrl, shortCircuit: true }',
        '  }',
        '  return nextResolve(specifier, context)',
        '}',
        '',
      ].join('\n'))
      writeFileSync(registerPath, [
        "import { register } from 'node:module'",
        `register(${JSON.stringify(loaderPath)}, import.meta.url)`,
        '',
      ].join('\n'))

      const result = spawnSync('node', ['--import', registerPath, '--import', tsxLoader, srcCli, 'case', 'open', 'Refresh Failure Case'], {
        cwd: target,
        encoding: 'utf8',
        env,
      })

      expect(result.status).toBe(0)
      expect(result.stdout).toContain(`Case opened: ${expectedCaseId}`)
      expect(result.stdout).toContain(`Directory:   ${join(target, 'cases', expectedCaseId)}/`)
      expect(result.stdout).toContain('Status:      open')
      expect(result.stderr).toContain('Warning: live vault refresh failed: mock vault refresh failure')
      expect(result.stderr).toContain(`Run: cia case vault refresh ${expectedCaseId} --force`)
      expect(readFileSync(join(target, 'cases', expectedCaseId, 'case.md'), 'utf8')).toContain('name: Refresh Failure Case')
    } finally {
      rmSync(fakeHome, { recursive: true, force: true })
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('case list prints one-based selectors for easier follow-up commands', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'chain-insights-home-'))
    const parent = mkdtempSync(join(tmpdir(), 'chain-insights-cli-'))
    const target = join(parent, 'investigations')
    const env = { ...process.env, HOME: fakeHome }
    try {
      execSync(`node bin/cli.js init ${target}`, { encoding: 'utf8', env })
      execSync(`${cli} case open "Selectable Case"`, {
        cwd: target,
        encoding: 'utf8',
        env,
      })
      const out = execSync(`${cli} case list`, {
        cwd: target,
        encoding: 'utf8',
        env,
      })
      expect(out).toMatch(/^1\. \d{8}_001_selectable-case  \[open\]  Selectable Case/m)
    } finally {
      rmSync(fakeHome, { recursive: true, force: true })
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('case show accepts a one-based selector from case list', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'chain-insights-home-'))
    const parent = mkdtempSync(join(tmpdir(), 'chain-insights-cli-'))
    const target = join(parent, 'investigations')
    const env = { ...process.env, HOME: fakeHome }
    try {
      execSync(`node bin/cli.js init ${target}`, { encoding: 'utf8', env })
      execSync(`${cli} case open "Selectable Case"`, {
        cwd: target,
        encoding: 'utf8',
        env,
      })
      const out = execSync(`${cli} case show 1`, {
        cwd: target,
        encoding: 'utf8',
        env,
      })
      expect(out).toContain('Name:   Selectable Case')
    } finally {
      rmSync(fakeHome, { recursive: true, force: true })
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('case export help exposes target, mode, and output options', () => {
    const out = execFileSync('node', ['--import', tsxLoader, srcCli, 'case', 'export', '--help'], { encoding: 'utf8' })
    expect(out).toContain('Export a case for Obsidian, LLM Wiki, and agents')
    expect(out).toContain('--target <target>')
    expect(out).toContain('--mode <mode>')
    expect(out).toContain('--out <directory>')
    expect(out).toContain('obsidian-llmwiki')
  })

  it('case export writes a local knowledge bundle from a selector', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'chain-insights-home-'))
    const parent = mkdtempSync(join(tmpdir(), 'chain-insights-cli-'))
    const target = join(parent, 'investigations')
    const env = { ...process.env, HOME: fakeHome }
    try {
      execFileSync('node', ['--import', tsxLoader, srcCli, 'init', target], { encoding: 'utf8', env })
      execFileSync('node', ['--import', tsxLoader, srcCli, 'case', 'open', 'Exportable Case'], {
        cwd: target,
        encoding: 'utf8',
        env,
      })
      execFileSync('node', [
        '--import',
        tsxLoader,
        srcCli,
        'case',
        'evidence',
        'add',
        '1',
        '--source',
        'manual',
        '--query-params',
        'network=bittensor',
        '--content',
        'Export evidence.',
      ], {
        cwd: target,
        encoding: 'utf8',
        env,
      })
      const out = execFileSync('node', ['--import', tsxLoader, srcCli, 'case', 'export', '1'], {
        cwd: target,
        encoding: 'utf8',
        env,
      })
      expect(out).toContain('Case exported:')
      expect(out).toContain('Open first:    Agent Console.md')
      expect(existsSync(join(target, 'published', 'exportable-case', 'manifest.chain-insights.json'))).toBe(true)
      expect(existsSync(join(target, 'published', 'exportable-case', 'Graph.canvas'))).toBe(true)
    } finally {
      rmSync(fakeHome, { recursive: true, force: true })
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('case vault refresh help is available', () => {
    const out = execFileSync('node', ['--import', tsxLoader, srcCli, 'case', 'vault', 'refresh', '--help'], { encoding: 'utf8' })
    expect(out).toContain('Refresh Obsidian vault notes for a case')
    expect(out).toContain('--force')
  })

  it('obsidian open help is available', () => {
    const out = execFileSync('node', ['--import', tsxLoader, srcCli, 'obsidian', 'open', '--help'], { encoding: 'utf8' })
    expect(out).toContain('Open the current Chain Insights vault in Obsidian')
  })

  it('case vault refresh refreshes live notes from a selector', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'chain-insights-home-'))
    const parent = mkdtempSync(join(tmpdir(), 'chain-insights-case-vault-'))
    const target = join(parent, 'investigations')
    const env = { ...process.env, HOME: fakeHome }
    try {
      execFileSync('node', ['--import', tsxLoader, srcCli, 'init', target], { encoding: 'utf8', env })
      execFileSync('node', ['--import', tsxLoader, srcCli, 'case', 'open', 'Refresh Vault Case'], {
        cwd: target,
        encoding: 'utf8',
        env,
      })
      execFileSync('node', [
        '--import',
        tsxLoader,
        srcCli,
        'case',
        'dossier',
        'update',
        '1',
        '5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5',
        '--finding',
        'Appears in explicit refresh.',
      ], {
        cwd: target,
        encoding: 'utf8',
        env,
      })
      const out = execFileSync('node', ['--import', tsxLoader, srcCli, 'case', 'vault', 'refresh', '1', '--force'], {
        cwd: target,
        encoding: 'utf8',
        env,
      })
      expect(out).toContain('Case vault refreshed:')
      expect(out).toContain('Open first: cases/')
      expect(existsSync(join(target, 'Entities', '5gtjfjalpbnrgybhy24nqhdnkw9r94z72rsylxeodxjfskj5.md'))).toBe(true)
    } finally {
      rmSync(fakeHome, { recursive: true, force: true })
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('obsidian open reports missing workspace when no path is provided', () => {
    const parent = mkdtempSync(join(tmpdir(), 'chain-insights-no-workspace-'))
    try {
      const result = spawnSync('node', ['--import', tsxLoader, srcCli, 'obsidian', 'open'], { cwd: parent, encoding: 'utf8' })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('No Chain Insights workspace found. Run: cia init .')
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('case resume is not registered', () => {
    expect(() => execSync('node bin/cli.js case resume 1', { encoding: 'utf8', stdio: 'pipe' })).toThrow()
  })

  it('case open rejects numeric names that look like selectors', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'chain-insights-home-'))
    const parent = mkdtempSync(join(tmpdir(), 'chain-insights-cli-'))
    const target = join(parent, 'investigations')
    const env = { ...process.env, HOME: fakeHome }
    try {
      execSync(`node bin/cli.js init ${target}`, { encoding: 'utf8', env })
      expect(() => execSync(`${cli} case open 1`, {
        cwd: target,
        encoding: 'utf8',
        env,
        stdio: 'pipe',
      })).toThrow()
    } finally {
      rmSync(fakeHome, { recursive: true, force: true })
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('case list is driven by case folders rather than stale database rows', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'chain-insights-home-'))
    const parent = mkdtempSync(join(tmpdir(), 'chain-insights-cli-'))
    const target = join(parent, 'investigations')
    const env = { ...process.env, HOME: fakeHome }
    try {
      execSync(`node bin/cli.js init ${target}`, { encoding: 'utf8', env })
      const opened = execSync(`${cli} case open "Cleanup Case"`, {
        cwd: target,
        encoding: 'utf8',
        env,
      })
      const caseId = opened.match(/Case opened: (.+)/)?.[1]?.trim()
      expect(caseId).toBeTruthy()
      rmSync(join(target, 'cases', caseId!), { recursive: true, force: true })
      const out = execSync(`${cli} case list`, {
        cwd: target,
        encoding: 'utf8',
        env,
      })
      expect(out).toContain('No cases found.')
      expect(out).not.toContain('Cleanup Case')
    } finally {
      rmSync(fakeHome, { recursive: true, force: true })
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('case session start accepts a case selector and optional title without creating duplicates', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'chain-insights-home-'))
    const parent = mkdtempSync(join(tmpdir(), 'chain-insights-cli-'))
    const target = join(parent, 'investigations')
    const env = { ...process.env, HOME: fakeHome }
    try {
      execSync(`node bin/cli.js init ${target}`, { encoding: 'utf8', env })
      const opened = execSync(`${cli} case open "Session CLI Case"`, {
        cwd: target,
        encoding: 'utf8',
        env,
      })
      const caseId = opened.match(/Case opened: (.+)/)?.[1]?.trim()
      expect(caseId).toBeTruthy()
      const first = execSync(`${cli} case session start 1 "some desc"`, {
        cwd: target,
        encoding: 'utf8',
        env,
      })
      const second = execSync(`${cli} case session start 1`, {
        cwd: target,
        encoding: 'utf8',
        env,
      })
      expect(first).toContain('_s001')
      expect(second).toContain('_s001')
      expect(readFileSync(join(target, 'cases', caseId!, 'session_001.md'), 'utf8')).toContain('title: some desc')
      expect(() => readFileSync(join(target, 'cases', caseId!, 'session_002.md'), 'utf8')).toThrow()
    } finally {
      rmSync(fakeHome, { recursive: true, force: true })
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('debug on/off/status configures graph MCP debug mode without exposing token', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'chain-insights-home-'))
    const env = { ...process.env, HOME: fakeHome }
    try {
      const on = execSync('node bin/cli.js debug on --token test-debug-token --endpoint http://localhost:8012/mcp', {
        encoding: 'utf8',
        env,
      })
      expect(on).toContain('Graph MCP debug mode enabled')
      expect(on).not.toContain('test-debug-token')
      const status = execSync('node bin/cli.js debug status', { encoding: 'utf8', env })
      expect(status).toContain('Graph MCP mode: debug')
      expect(status).toContain('Debug token:    configured')
      expect(status).not.toContain('test-debug-token')
      const off = execSync('node bin/cli.js debug off', { encoding: 'utf8', env })
      expect(off).toContain('Graph MCP debug mode disabled')
      const statusAfter = execSync('node bin/cli.js debug status', { encoding: 'utf8', env })
      expect(statusAfter).toContain('Graph MCP mode: paid')
      expect(statusAfter).toContain('Debug token:    not configured')
    } finally {
      rmSync(fakeHome, { recursive: true, force: true })
    }
  })

  it('debug on rejects remote http endpoints', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'chain-insights-home-'))
    const env = { ...process.env, HOME: fakeHome }
    try {
      const result = spawnSync('node', ['bin/cli.js', 'debug', 'on', '--token', 'test-debug-token', '--endpoint', 'http://staging-mcp.chain-insights.ai/mcp'], {
        encoding: 'utf8',
        env,
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('graphMcpEndpoint must use https:// for remote hosts')
    } finally {
      rmSync(fakeHome, { recursive: true, force: true })
    }
  })

  it('access-key set/clear/status configures Graph MCP test access without exposing key', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'chain-insights-home-'))
    const env = { ...process.env, HOME: fakeHome }
    try {
      const set = execSync('node bin/cli.js access-key set ci_test_secret_123456789012345678 --endpoint https://staging-mcp.chain-insights.ai/mcp', {
        encoding: 'utf8',
        env,
      })
      expect(set).toContain('Graph MCP test access key configured')
      expect(set).toContain('Graph endpoint: https://staging-mcp.chain-insights.ai/mcp')
      expect(set).not.toContain('ci_test_secret')

      const status = execSync('node bin/cli.js access-key status', { encoding: 'utf8', env })
      expect(status).toContain('Graph endpoint: https://staging-mcp.chain-insights.ai/mcp')
      expect(status).toContain('Access key:     configured')
      expect(status).not.toContain('ci_test_secret')

      const clear = execSync('node bin/cli.js access-key clear', { encoding: 'utf8', env })
      expect(clear).toContain('Graph MCP test access key cleared')
      const statusAfter = execSync('node bin/cli.js access-key status', { encoding: 'utf8', env })
      expect(statusAfter).toContain('Payments:       enabled')
      expect(statusAfter).toContain('Access key:     not configured')
    } finally {
      rmSync(fakeHome, { recursive: true, force: true })
    }
  })
})
