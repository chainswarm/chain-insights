import { access, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import type { VaultScaffoldOptions, VaultScaffoldResult } from './schema.js'
import { VAULT_DIRS } from './schema.js'
import {
  renderObsidianAppConfig,
  renderObsidianGraphConfig,
  renderObsidianTemplatesConfig,
  renderRootAgentConsole,
  renderRootIndex,
  renderVaultGitignore,
  renderVaultHome,
} from './markdown.js'

type VaultFile = {
  path: string
  content: string
}

const VAULT_FILES: VaultFile[] = [
  { path: '.obsidian/app.json', content: renderObsidianAppConfig() },
  { path: '.obsidian/graph.json', content: renderObsidianGraphConfig() },
  { path: '.obsidian/templates.json', content: renderObsidianTemplatesConfig() },
  { path: '.gitignore', content: renderVaultGitignore() },
  { path: 'Home.md', content: renderVaultHome() },
  {
    path: 'Cases.md',
    content: renderRootIndex('Cases', 'chain-insights-vault-cases-index', ['Home', 'Agent Console']),
  },
  {
    path: 'Entities.md',
    content: renderRootIndex('Entities', 'chain-insights-vault-entities-index', ['Home', 'Cases', 'Evidence']),
  },
  {
    path: 'Evidence.md',
    content: renderRootIndex('Evidence', 'chain-insights-vault-evidence-index', ['Home', 'Cases', 'Entities']),
  },
  {
    path: 'Graphs.md',
    content: renderRootIndex('Graphs', 'chain-insights-vault-graphs-index', ['Home', 'Cases', 'Entities', 'Evidence']),
  },
  { path: 'Agent Console.md', content: renderRootAgentConsole() },
  {
    path: 'Canvases/README.md',
    content: renderRootIndex('Canvases', 'chain-insights-vault-canvases-readme', ['Home', 'Graphs']),
  },
  {
    path: 'Entities/README.md',
    content: renderRootIndex('Entities Folder', 'chain-insights-vault-entities-readme', ['Entities', 'Cases']),
  },
  {
    path: 'Evidence/README.md',
    content: renderRootIndex('Evidence Folder', 'chain-insights-vault-evidence-readme', ['Evidence', 'Cases']),
  },
]

export type {
  CaseVaultRefreshOptions,
  CaseVaultRefreshResult,
  VaultScaffoldOptions,
  VaultScaffoldResult,
} from './schema.js'
export { VAULT_DIRS } from './schema.js'

export async function scaffoldVault(options: VaultScaffoldOptions): Promise<VaultScaffoldResult> {
  const workspaceRoot = resolve(options.workspaceRoot)
  const force = options.force === true

  if (!force) {
    await assertNoVaultFileCollisions(workspaceRoot)
  }

  for (const dir of VAULT_DIRS) {
    await mkdir(join(workspaceRoot, dir), { recursive: true })
  }

  const filesWritten: string[] = []
  for (const file of VAULT_FILES) {
    await writeVaultFile(workspaceRoot, file, force)
    filesWritten.push(file.path)
  }

  return { workspaceRoot, filesWritten }
}

async function assertNoVaultFileCollisions(workspaceRoot: string): Promise<void> {
  for (const file of VAULT_FILES) {
    try {
      await access(join(workspaceRoot, file.path))
      throw new Error(`Refusing to overwrite existing vault file: ${file.path}`)
    } catch (error) {
      if (isNotFoundError(error)) continue
      throw error
    }
  }
}

async function writeVaultFile(workspaceRoot: string, file: VaultFile, force: boolean): Promise<void> {
  try {
    await writeFile(join(workspaceRoot, file.path), file.content, { encoding: 'utf8', flag: force ? 'w' : 'wx' })
  } catch (error) {
    if (!force && isFileExistsError(error)) {
      throw new Error(`Refusing to overwrite existing vault file: ${file.path}`)
    }
    throw error
  }
}

function isFileExistsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
