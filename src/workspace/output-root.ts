import path from 'node:path'
import { findActiveWorkspace } from './active.js'

export const NO_WORKSPACE_ERROR = 'No Chain Insights workspace found. Run: cia init .'

export interface WorkspaceOutputPaths {
  root: string
  metadataDir: string
  schemaDir: string
  runtimeDir: string
  casesRoot: string
  reportsRoot: string
  reportGraphsRoot: string
  reportTablesRoot: string
  logsRoot: string
}

export function requireWorkspaceRoot(startDir = process.cwd()): string {
  const workspace = findActiveWorkspace(startDir)
  if (!workspace) throw new Error(NO_WORKSPACE_ERROR)
  return workspace.root
}

export function workspaceOutputPaths(workspaceRoot = requireWorkspaceRoot()): WorkspaceOutputPaths {
  const root = path.resolve(workspaceRoot)
  return {
    root,
    metadataDir: path.join(root, '.chain-insights'),
    schemaDir: path.join(root, '.chain-insights', 'schema'),
    runtimeDir: path.join(root, '.chain-insights', 'runtime'),
    casesRoot: path.join(root, 'cases'),
    reportsRoot: path.join(root, 'reports'),
    reportGraphsRoot: path.join(root, 'reports', 'graphs'),
    reportTablesRoot: path.join(root, 'reports', 'tables'),
    logsRoot: path.join(root, '.chain-insights', 'runtime', 'logs'),
  }
}
