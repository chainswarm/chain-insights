import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

interface WorkspaceConfig {
  schema?: string
  workspace_root?: string
  cases_dir?: string
}

export interface ActiveWorkspace {
  root: string
  metadataDir: string
  casesRoot: string
}

function workspaceFromRoot(rootCandidate: string): ActiveWorkspace | null {
  const root = path.resolve(rootCandidate)
  const metadataDir = path.join(root, '.chain-insights')
  const markerPath = path.join(metadataDir, 'workspace.json')
  if (!fs.existsSync(markerPath)) return null

  const parsed = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as WorkspaceConfig
  if (parsed.schema !== 'chain-insights.workspace.v1') return null

  const workspaceRoot = path.resolve(parsed.workspace_root ?? root)
  const casesDir = parsed.cases_dir ?? 'cases'
  return {
    root: workspaceRoot,
    metadataDir: path.join(workspaceRoot, '.chain-insights'),
    casesRoot: path.resolve(workspaceRoot, casesDir),
  }
}

export function findActiveWorkspace(startDir = process.cwd()): ActiveWorkspace | null {
  const envWorkspace = process.env['CHAIN_INSIGHTS_WORKSPACE']?.trim()
  if (envWorkspace) {
    const active = workspaceFromRoot(envWorkspace)
    if (active) return active
  }

  let current = path.resolve(startDir)
  while (true) {
    const active = workspaceFromRoot(current)
    if (active) return active

    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

export function activeMetadataDir(): string {
  return findActiveWorkspace()?.metadataDir ?? path.join(os.homedir(), '.chain-insights')
}

export function activeCasesRoot(): string {
  return findActiveWorkspace()?.casesRoot ?? path.join(os.homedir(), '.chain-insights', 'cases')
}

export function activeDataDir(fallbackDataDir?: string): string {
  return findActiveWorkspace()?.root ?? fallbackDataDir ?? path.join(os.homedir(), '.chain-insights')
}
