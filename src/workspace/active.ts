import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

interface WorkspaceConfig {
  schema?: string
  workspace_root?: string
  artifacts_dir?: string
  domain_hints?: unknown
}

export interface ActiveWorkspace {
  root: string
  metadataDir: string
  artifactsRoot: string
  domainHints: string[]
}

function workspaceFromRoot(rootCandidate: string): ActiveWorkspace | null {
  const root = path.resolve(rootCandidate)
  const metadataDir = path.join(root, '.chain-insights')
  const markerPath = path.join(metadataDir, 'workspace.json')
  if (!fs.existsSync(markerPath)) return null

  const parsed = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as WorkspaceConfig
  if (parsed.schema !== 'chain-insights.workspace.v1') return null

  const workspaceRoot = path.resolve(parsed.workspace_root ?? root)
  const artifactsDir = parsed.artifacts_dir ?? 'artifacts'
  const domainHints = Array.isArray(parsed.domain_hints)
    ? parsed.domain_hints.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []
  return {
    root: workspaceRoot,
    metadataDir: path.join(workspaceRoot, '.chain-insights'),
    artifactsRoot: path.resolve(workspaceRoot, artifactsDir),
    domainHints,
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

export function activeArtifactsRoot(): string {
  return findActiveWorkspace()?.artifactsRoot ?? path.join(os.homedir(), '.chain-insights', 'artifacts')
}

export function activeDataDir(fallbackDataDir?: string): string {
  return findActiveWorkspace()?.root ?? fallbackDataDir ?? path.join(os.homedir(), '.chain-insights')
}
