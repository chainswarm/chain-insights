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

export function findActiveWorkspace(startDir = process.cwd()): ActiveWorkspace | null {
  let current = path.resolve(startDir)
  while (true) {
    const metadataDir = path.join(current, '.chain-insights')
    const markerPath = path.join(metadataDir, 'workspace.json')
    if (fs.existsSync(markerPath)) {
      const parsed = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as WorkspaceConfig
      if (parsed.schema === 'chain-insights.workspace.v1') {
        const root = path.resolve(parsed.workspace_root ?? current)
        const casesDir = parsed.cases_dir ?? 'cases'
        return {
          root,
          metadataDir: path.join(root, '.chain-insights'),
          casesRoot: path.resolve(root, casesDir),
        }
      }
    }

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
