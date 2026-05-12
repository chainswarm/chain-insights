import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

export type ClaudeDesktopSetupOptions = {
  configPath?: string
  dryRun?: boolean
}

export type ClaudeDesktopSetupResult = {
  configPath: string
  command: string
  args: string[]
  backupPath?: string
  changed: boolean
  dryRun: boolean
}

type ClaudeDesktopConfig = {
  mcpServers?: Record<string, unknown>
  [key: string]: unknown
}

export function defaultClaudeDesktopConfigPath(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  }

  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'] ?? path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(appData, 'Claude', 'claude_desktop_config.json')
  }

  return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json')
}

export function defaultProxyCommand(): { command: string; args: string[] } {
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  const packageRoot = [
    path.resolve(currentDir, '..'),
    path.resolve(currentDir, '..', '..'),
  ].find((candidate) => existsSync(path.join(candidate, 'bin', 'mcp-proxy.cjs')))

  if (!packageRoot) {
    throw new Error(`Could not locate Chain Insights package root from ${currentDir}`)
  }

  return {
    command: process.execPath,
    args: [path.join(packageRoot, 'bin', 'mcp-proxy.cjs')],
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function parseClaudeConfig(raw: string, filePath: string): ClaudeDesktopConfig {
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Claude Desktop config must be a JSON object: ${filePath}`)
  }
  return parsed as ClaudeDesktopConfig
}

function backupPathFor(filePath: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `${filePath}.bak-${stamp}`
}

export async function setupClaudeDesktop(
  options: ClaudeDesktopSetupOptions = {},
): Promise<ClaudeDesktopSetupResult> {
  const configPath = options.configPath ?? defaultClaudeDesktopConfigPath()
  const { command, args } = defaultProxyCommand()
  const exists = await fileExists(configPath)
  const current = exists ? parseClaudeConfig(await readFile(configPath, 'utf8'), configPath) : {}
  const next: ClaudeDesktopConfig = {
    ...current,
    mcpServers: {
      ...(current.mcpServers ?? {}),
      'chain-insights': {
        command,
        args,
      },
    },
  }
  const currentText = exists ? JSON.stringify(current, null, 2) + '\n' : ''
  const nextText = JSON.stringify(next, null, 2) + '\n'
  const changed = currentText !== nextText
  const dryRun = options.dryRun ?? false
  let backupPath: string | undefined

  if (!dryRun && changed) {
    await mkdir(path.dirname(configPath), { recursive: true })
    if (exists) {
      backupPath = backupPathFor(configPath)
      await copyFile(configPath, backupPath)
    }
    await writeFile(configPath, nextText, { mode: 0o600 })
  }

  return {
    configPath,
    command,
    args,
    backupPath,
    changed,
    dryRun,
  }
}
