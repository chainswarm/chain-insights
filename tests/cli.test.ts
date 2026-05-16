import { describe, it, expect } from 'vitest'
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const srcCli = join(process.cwd(), 'src', 'cli.ts')
const tsxLoader = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'loader.mjs')

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

  it('wallet --help lists balance and topup subcommands', () => {
    const out = execSync('node bin/cli.js wallet --help', { encoding: 'utf8' })
    expect(out).toContain('balance')
    expect(out).toContain('topup')
  })

  it('mcp --help lists track-funds and hides trace-funds', () => {
    const out = execSync('node bin/cli.js mcp --help', { encoding: 'utf8' })
    expect(out).toContain('track-funds')
    expect(out).not.toContain('trace-funds')
  })

  it('mcp trace-funds is not registered', () => {
    expect(() => execSync('node bin/cli.js mcp trace-funds --help', {
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
      const out = execSync(`node bin/cli.js init ${target}`, { encoding: 'utf8' })
      expect(out).toContain(`Workspace initialized: ${target}`)
      expect(readFileSync(join(target, '.chain-insights', 'workspace.json'), 'utf8')).toContain(
        `"workspace_root": "${target}"`
      )
      const readme = readFileSync(join(target, 'README.md'), 'utf8')
      expect(readme).toContain('Chain Insights Investigations')
      expect(readme).toContain('artifacts/         Workspace-local graph app artifacts')
      expect(readme).toContain('logs/              Workspace-local investigation and preview logs')
      expect(readme).toContain('.chain-insights/runtime/        Workspace-local runtime process state')
      const agents = readFileSync(join(target, 'AGENTS.md'), 'utf8')
      const claude = readFileSync(join(target, 'CLAUDE.md'), 'utf8')
      for (const body of [agents, claude]) {
        expect(body).toContain('If this directory is not initialized, run `cia init .` before investigation-producing commands.')
        expect(body).toContain('Do not rerun init in an existing workspace unless replacing scaffolding with `--force`.')
        expect(body).toContain('Investigation output must stay in this initialized workspace.')
        expect(body).toContain('Never write cases, evidence, reports, graph JSON, HTML, artifacts, schema captures, or logs to ~/.chain-insights.')
      }
      expect(readFileSync(join(target, 'templates', 'case-brief.md'), 'utf8')).toContain('# Case Brief')
      expect(readFileSync(join(target, '.chain-insights', 'runtime-skill', 'SKILL.md'), 'utf8')).toContain('Runtime Graph Schema')
      expect(readFileSync(join(target, '.chain-insights', 'schema', 'README.md'), 'utf8')).toContain('Runtime Schema Captures')
      expect(existsSync(join(target, 'artifacts', '.keep'))).toBe(true)
      expect(existsSync(join(target, 'logs', '.keep'))).toBe(true)
      expect(existsSync(join(target, '.chain-insights', 'runtime', '.keep'))).toBe(true)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('init refuses to overwrite existing workspace files without --force', () => {
    const parent = mkdtempSync(join(tmpdir(), 'chain-insights-cli-'))
    const target = join(parent, 'investigations')
    try {
      execSync(`node bin/cli.js init ${target}`, { encoding: 'utf8' })
      writeFileSync(join(target, 'README.md'), 'custom notes\n')
      expect(() => execSync(`node bin/cli.js init ${target}`, { encoding: 'utf8', stdio: 'pipe' })).toThrow()
      expect(readFileSync(join(target, 'README.md'), 'utf8')).toBe('custom notes\n')
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

  it('case list inside a workspace does not show global cases', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'chain-insights-home-'))
    const parent = mkdtempSync(join(tmpdir(), 'chain-insights-cli-'))
    const target = join(parent, 'investigations')
    const env = { ...process.env, HOME: fakeHome }
    try {
      execSync('node bin/cli.js case open "Global Case"', { encoding: 'utf8', env })
      execSync(`node bin/cli.js init ${target}`, { encoding: 'utf8', env })
      const out = execSync('node /home/aphex5/work/chain-insights/bin/cli.js case list', {
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
      const out = execSync('node /home/aphex5/work/chain-insights/bin/cli.js case open "Workspace Case"', {
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

  it('case list prints one-based selectors for easier follow-up commands', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'chain-insights-home-'))
    const parent = mkdtempSync(join(tmpdir(), 'chain-insights-cli-'))
    const target = join(parent, 'investigations')
    const env = { ...process.env, HOME: fakeHome }
    try {
      execSync(`node bin/cli.js init ${target}`, { encoding: 'utf8', env })
      execSync('node /home/aphex5/work/chain-insights/bin/cli.js case open "Selectable Case"', {
        cwd: target,
        encoding: 'utf8',
        env,
      })
      const out = execSync('node /home/aphex5/work/chain-insights/bin/cli.js case list', {
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
      execSync('node /home/aphex5/work/chain-insights/bin/cli.js case open "Selectable Case"', {
        cwd: target,
        encoding: 'utf8',
        env,
      })
      const out = execSync('node /home/aphex5/work/chain-insights/bin/cli.js case show 1', {
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
      expect(() => execSync('node /home/aphex5/work/chain-insights/bin/cli.js case open 1', {
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
      const opened = execSync('node /home/aphex5/work/chain-insights/bin/cli.js case open "Cleanup Case"', {
        cwd: target,
        encoding: 'utf8',
        env,
      })
      const caseId = opened.match(/Case opened: (.+)/)?.[1]?.trim()
      expect(caseId).toBeTruthy()
      rmSync(join(target, 'cases', caseId!), { recursive: true, force: true })
      const out = execSync('node /home/aphex5/work/chain-insights/bin/cli.js case list', {
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
      const opened = execSync('node /home/aphex5/work/chain-insights/bin/cli.js case open "Session CLI Case"', {
        cwd: target,
        encoding: 'utf8',
        env,
      })
      const caseId = opened.match(/Case opened: (.+)/)?.[1]?.trim()
      expect(caseId).toBeTruthy()
      const first = execSync('node /home/aphex5/work/chain-insights/bin/cli.js case session start 1 "some desc"', {
        cwd: target,
        encoding: 'utf8',
        env,
      })
      const second = execSync('node /home/aphex5/work/chain-insights/bin/cli.js case session start 1', {
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
})
