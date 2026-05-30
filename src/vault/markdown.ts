export function yamlString(value: string): string {
  return JSON.stringify(value)
}

export function frontmatter(values: Record<string, string | boolean | string[]>): string {
  const lines = ['---']
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`)
      for (const item of value) lines.push(`  - ${yamlString(item)}`)
    } else {
      lines.push(`${key}: ${typeof value === 'boolean' ? String(value) : yamlString(value)}`)
    }
  }
  lines.push('---', '')
  return lines.join('\n')
}

export type VaultCaseSummary = {
  id: string
  name: string
  status: string
  tags: string[]
  description: string
  evidenceCount: number
  evidenceVerified: boolean
  entityCount: number
}

export type VaultEvidenceSummary = {
  id: string
  filename: string
  source: string
  timestamp: string
  queryParams: string
  notePath: string
  body: string
}

export type VaultEntitySummary = {
  label: string
  notePath: string
  entityType: string
}

export function renderLiveCaseNote(input: VaultCaseSummary): string {
  return frontmatter({
    type: 'chain-insights-case',
    case_id: input.id,
    status: input.status,
    tags: input.tags,
    contains_sensitive_data: true,
    source_of_truth: `cases/${input.id}/`,
  }) + [
    `# ${input.name}`,
    '',
    input.description,
    '',
    '## Live Workspace',
    '',
    `Status: ${input.status}`,
    `Evidence files: ${input.evidenceCount}`,
    `Evidence manifest verified: ${input.evidenceVerified ? 'yes' : 'no'}`,
    `Entities: ${input.entityCount}`,
    '',
    '## Navigation',
    '',
    '- [[Agent Console]]',
    '- [[Graph.canvas]]',
    '- [[Cases]]',
    `- [[cases/${input.id}/Evidence|Evidence]]`,
    `- [[cases/${input.id}/Entities|Entities]]`,
    '- [[Graphs]]',
    '',
  ].join('\n')
}

export function renderCaseAgentConsole(input: VaultCaseSummary): string {
  return frontmatter({
    type: 'chain-insights-case-agent-console',
    case_id: input.id,
    contains_sensitive_data: true,
  }) + [
    `# Agent Console: ${input.name}`,
    '',
    `Canonical case state: \`cases/${input.id}/\``,
    '',
    '## Case Files',
    '',
    '- [[Case]]',
    '- [[Graph.canvas]]',
    `- [[cases/${input.id}/Evidence|Evidence]]`,
    `- [[cases/${input.id}/Entities|Entities]]`,
    '',
    '## Current Counts',
    '',
    `- Evidence files: ${input.evidenceCount}`,
    `- Entities: ${input.entityCount}`,
    `- Manifest verified: ${input.evidenceVerified ? 'yes' : 'no'}`,
    '',
  ].join('\n')
}

export function renderCaseEvidenceIndex(input: VaultCaseSummary, evidence: VaultEvidenceSummary[]): string {
  return frontmatter({
    type: 'chain-insights-case-evidence-index',
    case_id: input.id,
    contains_sensitive_data: true,
  }) + [
    `# Evidence: ${input.name}`,
    '',
    `Canonical evidence directory: \`cases/${input.id}/evidence/\``,
    `Evidence files: ${input.evidenceCount}`,
    `Manifest verified: ${input.evidenceVerified ? 'yes' : 'no'}`,
    '',
    '## Evidence Notes',
    '',
    ...(evidence.length > 0
      ? evidence.map(item => `- [[${item.notePath.replace(/\.md$/, '')}|${item.id}]] (${item.source})`)
      : ['No evidence files recorded yet.']),
    '',
  ].join('\n')
}

export function renderEvidenceNote(input: VaultEvidenceSummary, caseId: string): string {
  return frontmatter({
    type: 'chain-insights-evidence',
    case_id: caseId,
    evidence_id: input.id,
    source: input.source,
    source_file: `cases/${caseId}/evidence/${input.filename}`,
    contains_sensitive_data: true,
  }) + [
    `# Evidence: ${input.source}`,
    '',
    `Evidence ID: \`${input.id}\``,
    `Source file: \`cases/${caseId}/evidence/${input.filename}\``,
    `Captured: ${input.timestamp || 'unknown'}`,
    `Query params: ${input.queryParams || 'none'}`,
    '',
    '## Case',
    '',
    `- [[cases/${caseId}/Case|${caseId}]]`,
    '',
    '## Body',
    '',
    input.body.trim() || 'No evidence body recorded.',
    '',
  ].join('\n')
}

export function renderCaseEntityIndex(input: VaultCaseSummary, entities: VaultEntitySummary[]): string {
  return frontmatter({
    type: 'chain-insights-case-entity-index',
    case_id: input.id,
    contains_sensitive_data: true,
  }) + [
    `# Entities: ${input.name}`,
    '',
    `Canonical dossier directory: \`cases/${input.id}/dossiers/\``,
    `Entities: ${entities.length}`,
    '',
    '## Entity Notes',
    '',
    ...(entities.length > 0
      ? entities.map(item => `- [[${item.notePath.replace(/\.md$/, '')}|${item.label}]] (${item.entityType})`)
      : ['No entities recorded yet.']),
    '',
  ].join('\n')
}

export function renderEntityNote(address: string, caseId: string, entityType: string): string {
  return frontmatter({
    type: 'chain-insights-entity',
    case_id: caseId,
    address,
    entity_type: entityType,
    contains_sensitive_data: true,
  }) + [
    `# Entity: ${address}`,
    '',
    `Address: ${address}`,
    `Type: ${entityType}`,
    '',
    '## Cases',
    '',
    `- [[cases/${caseId}/Case|${caseId}]]`,
    '',
  ].join('\n')
}

export function renderVaultHome(): string {
  return frontmatter({
    type: 'chain-insights-vault-home',
    product: 'Chain Insights',
    contains_sensitive_data: true,
  }) + [
    '# Chain Insights Vault',
    '',
    'Chain Insights is an AML investigation CLI and MCP proxy layered on GraphRAG MCP.',
    '',
    '## Start Here',
    '',
    '- [[Cases]]',
    '- [[Entities]]',
    '- [[Evidence]]',
    '- [[Graphs]]',
    '- [[Agent Console]]',
    '',
  ].join('\n')
}

export function renderRootIndex(title: string, type: string, links: string[]): string {
  return frontmatter({
    type,
    product: 'Chain Insights',
    contains_sensitive_data: true,
  }) + [
    `# ${title}`,
    '',
    ...links.map((link) => `- [[${link}]]`),
    '',
  ].join('\n')
}

export function renderRootAgentConsole(): string {
  return frontmatter({
    type: 'chain-insights-agent-console',
    product: 'Chain Insights',
    contains_sensitive_data: true,
  }) + [
    '# Agent Console',
    '',
    'Use Chain Insights case evidence as canonical local state and GraphRAG MCP for fresh graph facts.',
    '',
    '## Reading Order',
    '',
    '1. [[Home]]',
    '2. [[Cases]]',
    '3. [[Entities]]',
    '4. [[Evidence]]',
    '5. [[Graphs]]',
    '',
  ].join('\n')
}

export function renderObsidianAppConfig(): string {
  return JSON.stringify(
    {
      useMarkdownLinks: false,
      newLinkFormat: 'shortest',
      alwaysUpdateLinks: true,
    },
    null,
    2,
  ) + '\n'
}

export function renderObsidianGraphConfig(): string {
  return JSON.stringify(
    {
      'collapse-filter': true,
      search: '',
      showTags: true,
      showAttachments: true,
      hideUnresolved: false,
      showOrphans: true,
    },
    null,
    2,
  ) + '\n'
}

export function renderObsidianTemplatesConfig(): string {
  return JSON.stringify(
    {
      folder: '',
      dateFormat: 'YYYY-MM-DD',
      timeFormat: 'HH:mm',
    },
    null,
    2,
  ) + '\n'
}

export function renderVaultGitignore(): string {
  return [
    '# Chain Insights local runtime state',
    '.chain-insights/runtime/',
    '',
    '# Obsidian local UI state',
    '.obsidian/workspace.json',
    '.obsidian/workspace-mobile.json',
    '.obsidian/workspaces.json',
    '',
    '# Private export bundles are local by default',
    'published/',
    '',
  ].join('\n')
}
