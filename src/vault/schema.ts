export type VaultScaffoldOptions = {
  workspaceRoot: string
  force?: boolean
}

export type VaultScaffoldResult = {
  workspaceRoot: string
  filesWritten: string[]
}

export type CaseVaultRefreshOptions = {
  caseId: string
  force?: boolean
}

export type CaseVaultRefreshResult = {
  caseId: string
  filesWritten: string[]
  nextFile: string
}

export const VAULT_DIRS = ['.obsidian', 'Canvases', 'Entities', 'Evidence', 'published'] as const
