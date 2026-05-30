import type { CaseExportMode } from './schema.js'

export type MarkdownCase = {
  id: string
  name: string
  status: string
  tags: string[]
  description?: string
}

export function frontmatter(values: Record<string, unknown>): string {
  const lines = ['---']
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`)
      for (const item of value) lines.push(`  - ${JSON.stringify(String(item))}`)
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`)
    }
  }
  lines.push('---', '')
  return lines.join('\n')
}

export function renderReadme(caseName: string): string {
  return [
    `# ${caseName} Export`,
    '',
    'Open this directory as an Obsidian vault or give it to an LLMWiki-style knowledge workflow.',
    '',
    'Start with:',
    '',
    '- `Case.md`',
    '- `Agent Console.md`',
    '- `LLMWIKI.md`',
    '- `graph.chain-insights.json` when present',
    '',
  ].join('\n')
}

export function renderCaseMarkdown(input: {
  caseInfo: MarkdownCase
  mode: CaseExportMode
  evidenceVerified: boolean
  evidenceCount: number
  entityCount: number
}): string {
  return frontmatter({
    type: 'chain-insights-case',
    case_id: input.caseInfo.id,
    status: input.caseInfo.status,
    tags: input.caseInfo.tags,
    contains_sensitive_data: input.mode !== 'public',
  }) + [
    `# ${input.caseInfo.name}`,
    '',
    `Case ID: \`${input.caseInfo.id}\``,
    `Status: ${input.caseInfo.status}`,
    `Evidence manifest: ${input.evidenceVerified ? 'verified' : 'failed'}`,
    `Evidence files: ${input.evidenceCount}`,
    `Entities: ${input.entityCount}`,
    '',
    '## Summary',
    '',
    input.caseInfo.description || 'No description recorded.',
    '',
    '## Start Here',
    '',
    '- [[Agent Console]]',
    '- [[LLMWIKI]]',
    '- [[Sources/evidence-manifest]]',
    '',
  ].join('\n')
}

export function renderAgentConsole(caseName: string): string {
  return [
    '# Agent Console',
    '',
    `Case: [[Case|${caseName}]]`,
    '',
    '## Reading Order',
    '',
    '1. [[Case]]',
    '2. [[LLMWIKI]]',
    '3. `graph.chain-insights.json`',
    '4. [[Sources/evidence-manifest]]',
    '5. Entity and evidence notes linked from the case.',
    '',
    '## Agent Prompts',
    '',
    '- [[Prompts/Codex]]',
    '- [[Prompts/Claude-Code]]',
    '- [[Prompts/ChatGPT]]',
    '',
    '## Rules',
    '',
    '- Treat Chain Insights case evidence and manifests as canonical.',
    '- Use Chain Insights tools for fresh graph facts.',
    '- Preserve full blockchain addresses exactly unless this is a public redacted export.',
    '',
  ].join('\n')
}

export function renderLlmWiki(): string {
  return [
    '# LLMWiki Entry',
    '',
    'This directory is a Chain Insights case export.',
    '',
    'Canonical machine files:',
    '',
    '- `manifest.chain-insights.json`',
    '- `graph.chain-insights.json`',
    '- `Graph.canvas`',
    '',
    'Human and agent notes:',
    '',
    '- `Case.md`',
    '- `Agent Console.md`',
    '- `Entities/`',
    '- `Evidence/`',
    '- `Prompts/`',
    '',
  ].join('\n')
}

export function renderLlmsTxt(): string {
  return [
    '# Chain Insights Case Export',
    '',
    'Read these files first:',
    '- Case.md',
    '- Agent Console.md',
    '- graph.chain-insights.json',
    '- Entities/',
    '- Evidence/',
    '',
    'Source of truth:',
    '- manifest.chain-insights.json',
    '- Sources/evidence-manifest.md',
    '',
  ].join('\n')
}

export function renderPrompt(agentName: string): string {
  return [
    `# ${agentName} Case Prompt`,
    '',
    'You are reading a Chain Insights case export.',
    '',
    'Treat `manifest.chain-insights.json`, `Sources/evidence-manifest.md`, and original case evidence as canonical.',
    'Use generated prose for orientation, not as a replacement for evidence.',
    'Use Chain Insights MCP tools for fresh graph facts when available.',
    '',
  ].join('\n')
}
