/**
 * The README and the docs move with the code (aphex5 ruling, 2026-10-13, after
 * `cia buy` sold a USDC subscription that no longer existed). This file fails a
 * push when they drift:
 *   - every `cia <command>` the README or docs/*.md name exists (its --help opens
 *     with "Usage: cia <command>"), and every top-level public command is named
 *     at least once in the README or docs;
 *   - the README tool table is exactly the public tool surface the proxy serves;
 *   - the README names exactly the `cia setup` targets the CLI has;
 *   - every relative link in README.md and docs/*.md resolves to a file;
 *   - the README names the default endpoint the CLI uses.
 * Judgement (tone, missing explanations, stale pricing prose) stays with the
 * docs audit prompt in the AP1000 skill chain-insights-developer-experience.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_ONLY_LOCAL_TOOL_NAMES, LOCAL_TOOL_NAMES } from '../src/mcp/proxy.js'
import { HIDDEN_REMOTE_TOOL_NAMES, PUBLIC_MCP_TOOL_REQUIRED_ARGS } from '../src/mcp/tool-visibility.js'
import { DEFAULT_GRAPH_MCP_ENDPOINT } from '../src/config/mcp-endpoint.js'

const root = process.cwd()
const srcCli = join(root, 'src', 'cli.ts')
const tsxLoader = join(root, 'node_modules', 'tsx', 'dist', 'loader.mjs')
const readme = readFileSync(join(root, 'README.md'), 'utf8')
const docFiles = ['README.md', ...readdirSync(join(root, 'docs')).filter((f) => f.endsWith('.md')).map((f) => join('docs', f))]
const docs = docFiles.map((f) => ({ file: f, text: readFileSync(join(root, f), 'utf8') }))

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

describe('README and docs match the CLI and the proxy', () => {
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
  })

  it('every public top-level command is named in the README or the docs', () => {
    // workspace commands are not public (CLAUDE.md); they may stay unnamed
    const notPublic = new Set(['workflow', 'workflows', 'status'])
    const all = readme + docs.map((d) => d.text).join('\n')
    const missing = [...commandTree()].filter((c) => !c.includes(' ') && !notPublic.has(c) && !new RegExp(`\\bcia ${c}\\b`).test(all))
    expect(missing, `commands the CLI ships but no doc names: ${missing.join(', ')}`).toEqual([])
  })

  it('the README tool table is exactly the public tool surface', () => {
    const table = readme.split('### What You Can Do Today')[1]?.split('\n## ')[0] ?? ''
    const inReadme = new Set([...table.matchAll(/^\| `([a-z_]+)`/gm)].map((m) => m[1]))
    const served = new Set([
      ...[...LOCAL_TOOL_NAMES].filter((t) => !APP_ONLY_LOCAL_TOOL_NAMES.has(t)),
      ...Object.keys(PUBLIC_MCP_TOOL_REQUIRED_ARGS),
    ])
    expect([...inReadme].sort()).toEqual([...served].sort())
    for (const t of inReadme) expect(HIDDEN_REMOTE_TOOL_NAMES.has(t), `${t} is hidden`).toBe(false)
  })

  it('the README names exactly the cia setup targets', () => {
    const setupHelp = help(['setup']).split(/\nCommands:\n/)[1] ?? ''
    const targets = [...setupHelp.matchAll(/^\s{2}([a-z][a-z-]*)(?:\|[a-z-]+)?\b/gm)].map((m) => m[1]).filter((t) => t !== 'help').sort()
    const line = readme.match(/`cia setup ([a-z-]+)` \(or ([^)]+)\)/)
    expect(line, 'README quickstart names the setup targets as `cia setup X` (or `a` / `b`)').not.toBeNull()
    const named = [line![1], ...[...line![2].matchAll(/`([a-z-]+)`/g)].map((m) => m[1])].sort()
    expect(named).toEqual(targets)
  })

  it('every relative link in README.md and docs/*.md resolves', () => {
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

  it('the README names the default endpoint the CLI uses', () => {
    expect(readme).toContain(DEFAULT_GRAPH_MCP_ENDPOINT)
  })
})
