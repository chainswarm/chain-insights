/**
 * The README and the docs move with the code (aphex5 ruling, 2026-10-13, after
 * `cia buy` sold a USDC subscription that no longer existed). This file fails a
 * push when they drift:
 *   - every `cia <command>` the README or any docs/** Markdown names exists (its
 *     --help opens with "Usage: cia <command>"), and every top-level public
 *     command is named at least once in the README or docs;
 *   - the README tool table, docs/stability.md and the docs/mcp-proxy.md local
 *     tool table are exactly the tool surface the proxy serves;
 *   - the docs/mcp-proxy.md prompt list is exactly the prompts the proxy registers;
 *   - the docs/architecture.md config key table is exactly CONFIG_KEYS;
 *   - the README names exactly the `cia setup` targets the CLI has;
 *   - every relative link in README.md and docs/** resolves to a file;
 *   - every `scripts/...` path a doc names exists;
 *   - every CHAIN_INSIGHTS_* environment variable a doc names is read by src/;
 *   - the README names the default endpoint the CLI uses;
 *   - no doc says "free demo" (the free door is the free tier, ruling 2026-10-13).
 * Judgement (tone, missing explanations, stale pricing prose) stays with the
 * docs audit prompt in the AP1000 skill chain-insights-developer-experience.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_ONLY_LOCAL_TOOL_NAMES, LOCAL_TOOL_NAMES } from '../src/mcp/proxy.js'
import { HIDDEN_REMOTE_TOOL_NAMES, PUBLIC_MCP_TOOL_REQUIRED_ARGS } from '../src/mcp/tool-visibility.js'
import { DEFAULT_GRAPH_MCP_ENDPOINT } from '../src/config/mcp-endpoint.js'
import { CONFIG_KEYS } from '../src/config/schema.js'

const root = process.cwd()
const srcCli = join(root, 'src', 'cli.ts')
const tsxLoader = join(root, 'node_modules', 'tsx', 'dist', 'loader.mjs')
const readme = readFileSync(join(root, 'README.md'), 'utf8')

function markdownFilesUnder(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...markdownFilesUnder(full))
    else if (name.endsWith('.md')) out.push(relative(root, full))
  }
  return out.sort()
}

const docFiles = ['README.md', ...markdownFilesUnder(join(root, 'docs'))]
const docs = docFiles.map((f) => ({ file: f, text: readFileSync(join(root, f), 'utf8') }))
const allText = docs.map((d) => d.text).join('\n')
const doc = (file: string) => docs.find((d) => d.file === file)!.text

/** The public tool surface: local tools the model may call plus the remote graph tools. */
const servedTools = [
  ...[...LOCAL_TOOL_NAMES].filter((t) => !APP_ONLY_LOCAL_TOOL_NAMES.has(t)),
  ...Object.keys(PUBLIC_MCP_TOOL_REQUIRED_ARGS),
].sort()

function help(args: string[]): string {
  return execFileSync('node', ['--import', tsxLoader, srcCli, ...args, '--help'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** Top-level commands and their subcommands from commander's help, as "a" and "a b". */
function commandTree(): Set<string> {
  const names = new Set<string>()
  const top = help([])
  const section = top.split(/\nCommands:\n/)[1] ?? ''
  for (const m of section.matchAll(/^\s{2}([a-z][a-z-]*)(?:\|[a-z-]+)?\b/gm)) {
    const cmd = m[1]
    if (cmd === 'help') continue
    names.add(cmd)
    const sub = help([cmd]).split(/\nCommands:\n/)[1] ?? ''
    for (const s of sub.matchAll(/^\s{2}([a-z][a-z-]*)(?:\|[a-z-]+)?\b/gm)) {
      if (s[1] !== 'help') names.add(`${cmd} ${s[1]}`)
    }
  }
  return names
}

/** The `- `name`` bullets of one section of a doc, up to the next heading. */
function bulletNames(text: string, heading: string): string[] {
  const section = text.split(heading)[1]?.split(/\n#{1,6} /)[0] ?? ''
  return [...section.matchAll(/^- `([a-z_-]+)`/gm)].map((m) => m[1]).sort()
}

/** The first column of a Markdown table that follows a heading, up to the next heading. */
function tableNames(text: string, heading: string): string[] {
  const section = text.split(heading)[1]?.split(/\n#{1,6} /)[0] ?? ''
  return [...section.matchAll(/^\| `([A-Za-z_]+)`/gm)].map((m) => m[1]).sort()
}

describe('README and docs match the CLI and the proxy', () => {
  it('reads the README and every Markdown file under docs/', () => {
    expect(docFiles).toContain('docs/architecture/components/config.md')
    expect(docFiles.length).toBeGreaterThan(15)
  })

  it('every cia command the docs name exists, with its own help text', () => {
    const named = new Set<string>()
    for (const { text } of docs) {
      for (const m of text.matchAll(/`cia ([a-z][a-z-]*(?: [a-z][a-z-]*)?)/g)) named.add(m[1])
    }
    expect(named.size).toBeGreaterThan(5)
    const failures: string[] = []
    for (const cmd of [...named].sort()) {
      const parts = cmd.split(' ')
      let out = ''
      try {
        out = help(parts)
      } catch (err) {
        failures.push(`${cmd}: ${(err as Error).message.split('\n')[0]}`)
        continue
      }
      // a two-word name whose second word is an argument (e.g. `cia network robinhood`) opens the parent's usage
      const ok = out.startsWith(`Usage: cia ${cmd}`) || (parts.length === 2 && out.startsWith(`Usage: cia ${parts[0]}`) && /<|\[/.test(out.split('\n')[0]))
      if (!ok) failures.push(`${cmd}: help opens with "${out.split('\n')[0]}"`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 60_000) // one CLI spawn per command; a loaded runner needs more than 5 s

  it('every public top-level command is named in the README or the docs', () => {
    // workspace commands are not public (CLAUDE.md); they may stay unnamed
    const notPublic = new Set(['workflow', 'workflows', 'status'])
    const missing = [...commandTree()].filter((c) => !c.includes(' ') && !notPublic.has(c) && !new RegExp(`\\bcia ${c}\\b`).test(allText))
    expect(missing, `commands the CLI ships but no doc names: ${missing.join(', ')}`).toEqual([])
  }, 60_000) // one CLI spawn per command; a loaded runner needs more than 5 s

  it('the README tool table is exactly the public tool surface', () => {
    const table = readme.split('### What You Can Do Today')[1]?.split('\n## ')[0] ?? ''
    const inReadme = [...table.matchAll(/^\| `([a-z_]+)`/gm)].map((m) => m[1]).sort()
    expect(inReadme).toEqual(servedTools)
    for (const t of inReadme) expect(HIDDEN_REMOTE_TOOL_NAMES.has(t), `${t} is hidden`).toBe(false)
  })

  it('docs/stability.md promises exactly the public tool surface', () => {
    expect(bulletNames(doc('docs/stability.md'), '### MCP tool names')).toEqual(servedTools)
  })

  it('the docs/mcp-proxy.md local tool table is exactly the local tools the proxy registers', () => {
    expect(tableNames(doc('docs/mcp-proxy.md'), '## Local Tools')).toEqual([...LOCAL_TOOL_NAMES].sort())
  })

  it('the docs/mcp-proxy.md prompt list is exactly the prompts the proxy registers', () => {
    const proxySource = readFileSync(join(root, 'src', 'mcp', 'proxy.ts'), 'utf8')
    const registered = [...proxySource.matchAll(/registerPrompt\(\s*'([a-z-]+)'/g)].map((m) => m[1]).sort()
    expect(registered.length).toBeGreaterThan(3)
    const section = doc('docs/mcp-proxy.md').split('Current MCP prompts exposed by the local proxy:')[1]?.split(/\n\n[A-Z]/)[0] ?? ''
    const listed = [...section.matchAll(/^- `([a-z-]+)`/gm)].map((m) => m[1]).sort()
    expect(listed).toEqual(registered)
  })

  it('the docs/architecture.md config key table is exactly CONFIG_KEYS', () => {
    expect(tableNames(doc('docs/architecture.md'), 'Supported config keys:')).toEqual([...CONFIG_KEYS].sort())
  })

  it('the README names exactly the cia setup targets', () => {
    const setupHelp = help(['setup']).split(/\nCommands:\n/)[1] ?? ''
    const targets = [...setupHelp.matchAll(/^\s{2}([a-z][a-z-]*)(?:\|[a-z-]+)?\b/gm)].map((m) => m[1]).filter((t) => t !== 'help').sort()
    const line = readme.match(/`cia setup ([a-z-]+)` \(or ([^)]+)\)/)
    expect(line, 'README quickstart names the setup targets as `cia setup X` (or `a` / `b`)').not.toBeNull()
    const named = [line![1], ...[...line![2].matchAll(/`([a-z-]+)`/g)].map((m) => m[1])].sort()
    expect(named).toEqual(targets)
  })

  it('every relative link in README.md and docs/** resolves', () => {
    const broken: string[] = []
    for (const { file, text } of docs) {
      for (const m of text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
        const target = m[1]
        if (/^[a-z]+:/.test(target)) continue
        const path = resolve(root, dirname(file), target)
        if (!existsSync(path)) broken.push(`${file} -> ${target}`)
      }
    }
    expect(broken, broken.join('\n')).toEqual([])
  })

  it('every scripts/ path a doc names exists', () => {
    const missing: string[] = []
    for (const { file, text } of docs) {
      for (const m of text.matchAll(/\bscripts\/[A-Za-z0-9_./-]+\.(?:sh|mjs|js|py|ts)\b/g)) {
        if (!existsSync(join(root, m[0]))) missing.push(`${file}: ${m[0]}`)
      }
    }
    expect(missing, missing.join('\n')).toEqual([])
  })

  it('every CHAIN_INSIGHTS_* environment variable a doc names is read by the code', () => {
    const read = new Set<string>()
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.(ts|cjs|mjs|js)$/.test(name)) {
          for (const m of readFileSync(full, 'utf8').matchAll(/\bCHAIN_INSIGHTS_[A-Z0-9_]+\b/g)) read.add(m[0])
        }
      }
    }
    walk(join(root, 'src'))
    walk(join(root, 'bin'))
    expect(read.has('CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT')).toBe(true)
    const unknown: string[] = []
    for (const { file, text } of docs) {
      for (const m of text.matchAll(/\bCHAIN_INSIGHTS_[A-Z0-9_]+\b/g)) {
        if (!read.has(m[0])) unknown.push(`${file}: ${m[0]}`)
      }
    }
    expect([...new Set(unknown)], unknown.join('\n')).toEqual([])
  })

  it('the README names the default endpoint the CLI uses', () => {
    expect(readme).toContain(DEFAULT_GRAPH_MCP_ENDPOINT)
  })

  it('no doc calls the free tier a free demo', () => {
    const hits = docs.filter((d) => /free[- ]demo/i.test(d.text)).map((d) => d.file)
    expect(hits, 'the free door is the free tier (aphex5, 2026-10-13)').toEqual([])
  })
})
