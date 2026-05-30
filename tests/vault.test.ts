import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

describe('Obsidian vault scaffold', () => {
  let workspace: string

  beforeEach(async () => {
    vi.resetModules()
    workspace = join(tmpdir(), `ci-vault-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(workspace, { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
    vi.resetModules()
  })

  it('writes Obsidian-compatible vault files without replacing canonical case state', async () => {
    const { scaffoldVault } = await import('../src/vault/index.js')

    const result = await scaffoldVault({ workspaceRoot: workspace })

    expect(result.workspaceRoot).toBe(resolve(workspace))
    expect(result.filesWritten.every((file) => !isAbsolute(file))).toBe(true)
    expect(result.filesWritten).toContain('.obsidian/app.json')
    expect(result.filesWritten).toContain('.obsidian/graph.json')
    expect(result.filesWritten).toContain('.obsidian/templates.json')
    expect(result.filesWritten).toContain('.gitignore')
    expect(result.filesWritten).toContain('Home.md')
    expect(result.filesWritten).toContain('Cases.md')
    expect(result.filesWritten).toContain('Entities.md')
    expect(result.filesWritten).toContain('Evidence.md')
    expect(result.filesWritten).toContain('Graphs.md')
    expect(result.filesWritten).toContain('Agent Console.md')
    expect(result.filesWritten).toContain('Canvases/README.md')
    expect(result.filesWritten).toContain('Entities/README.md')
    expect(result.filesWritten).toContain('Evidence/README.md')
    expect(existsSync(join(workspace, '.obsidian'))).toBe(true)
    expect(existsSync(join(workspace, 'Canvases'))).toBe(true)
    expect(existsSync(join(workspace, 'Entities'))).toBe(true)
    expect(existsSync(join(workspace, 'Evidence'))).toBe(true)
    expect(existsSync(join(workspace, 'published'))).toBe(true)

    const home = await readFile(join(workspace, 'Home.md'), 'utf8')
    expect(home).toContain('type: "chain-insights-vault-home"')
    expect(home).toContain('contains_sensitive_data: true')
    expect(home).toContain('[[Cases]]')
    expect(home).toContain('[[Entities]]')
    expect(home).toContain('[[Evidence]]')
    expect(home).toContain('[[Graphs]]')

    const appConfig = JSON.parse(await readFile(join(workspace, '.obsidian/app.json'), 'utf8'))
    expect(appConfig).toMatchObject({
      useMarkdownLinks: false,
      newLinkFormat: 'shortest',
      alwaysUpdateLinks: true,
    })

    const graphConfig = JSON.parse(await readFile(join(workspace, '.obsidian/graph.json'), 'utf8'))
    expect(graphConfig['collapse-filter']).toBe(true)

    JSON.parse(await readFile(join(workspace, '.obsidian/templates.json'), 'utf8'))

    const gitignore = await readFile(join(workspace, '.gitignore'), 'utf8')
    expect(gitignore).not.toContain('cases/')
    expect(gitignore).not.toContain('reports/')
    expect(gitignore).not.toContain('artifacts/')
  })

  it('refuses to overwrite user-edited vault files unless forced', async () => {
    const { scaffoldVault } = await import('../src/vault/index.js')
    await writeFile(join(workspace, 'Home.md'), '# Existing Home\n', 'utf8')

    await expect(scaffoldVault({ workspaceRoot: workspace })).rejects.toThrow('Refusing to overwrite')

    const result = await scaffoldVault({ workspaceRoot: workspace, force: true })
    expect(result.filesWritten).toContain('Home.md')
    await expect(readFile(join(workspace, 'Home.md'), 'utf8')).resolves.toContain('# Chain Insights Vault')
  })

  it('preflights all vault files before writing any generated files', async () => {
    const { scaffoldVault } = await import('../src/vault/index.js')
    await mkdir(join(workspace, 'Evidence'), { recursive: true })
    await writeFile(join(workspace, 'Evidence/README.md'), '# Existing Evidence\n', 'utf8')

    await expect(scaffoldVault({ workspaceRoot: workspace })).rejects.toThrow('Refusing to overwrite')

    expect(existsSync(join(workspace, '.obsidian/app.json'))).toBe(false)
    expect(existsSync(join(workspace, 'Home.md'))).toBe(false)
    await expect(readFile(join(workspace, 'Evidence/README.md'), 'utf8')).resolves.toBe('# Existing Evidence\n')
  })
})
