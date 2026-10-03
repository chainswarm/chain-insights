import { readFileSync, readdirSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect } from 'vitest'

import { initWorkspace } from '../../src/workspace/init.js'

// Readers for the text a user or an agent sees: the shipped skills, the docs,
// the graph hints the MCP server serves and the notes workspace init writes.

const root = process.cwd()

export function read(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

// The text with every run of whitespace folded to one space, so a sentence
// that a Markdown line break splits still matches.
export function flat(text: string): string {
  return text.replace(/\s+/g, ' ')
}

// One `## ` section of a Markdown file whose heading holds every given word.
export function sectionWith(markdown: string, ...words: string[]): string {
  const sections = markdown.split(/\n(?=## )/)
  const found = sections.find((section) => {
    const heading = section.split('\n', 1)[0] ?? ''
    return words.every((word) => heading.includes(word))
  })
  expect(found, `no section with ${words.join(' + ')} in its heading`).toBeDefined()
  return found ?? ''
}

// The graph hints the MCP server serves, as the running server joins them.
export function servedGraphHints(): string {
  const source = read('src/mcp/proxy.ts')
  const start = source.indexOf('const GRAPH_SCHEMA_HINTS = [')
  const end = source.indexOf("].join('\\n')", start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const literal = source.slice(source.indexOf('[', start), end + 1)
  return (new Function(`return ${literal}`)() as string[]).join('\n')
}

// The runtime skill that workspace init writes into a new workspace.
export async function runtimeSkill(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'chain-insights-schema-text-'))
  try {
    await initWorkspace({ targetDir: workspace })
    return await readFile(join(workspace, '.chain-insights', 'runtime-skill', 'SKILL.md'), 'utf8')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

// Every Markdown page under dir, recursively.
export function markdownFiles(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) return markdownFiles(path)
    return entry.name.endsWith('.md') ? [path] : []
  })
}
