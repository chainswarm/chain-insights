import { mkdir, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { CaseStore, DossierStore, EvidenceStore, parseFrontmatter } from '../cases/index.js'
import { workspaceOutputPaths } from '../workspace/output-root.js'
import { renderAgentConsole, renderCaseMarkdown, renderLlmsTxt, renderLlmWiki, renderPrompt, renderReadme } from './markdown.js'
import { safeFilename, safeSlug, writePrivateFile } from './paths.js'
import { createRedactor } from './redaction.js'
import { CaseExportManifestSchema, CaseExportOptionsSchema, type CaseExportOptions, type CaseExportResult, type ExportedFile } from './schema.js'

type EvidenceDoc = {
  id: string
  filename: string
  source: string
  timestamp: string
  body: string
}

async function readEvidence(caseId: string): Promise<EvidenceDoc[]> {
  const paths = workspaceOutputPaths()
  const dir = path.join(paths.casesRoot, caseId, 'evidence')
  const files = await readdir(dir).catch(() => [])
  const docs: EvidenceDoc[] = []
  for (const filename of files.filter(file => file.endsWith('.md')).sort()) {
    const raw = await readFile(path.join(dir, filename), 'utf8')
    const { frontmatter, body } = parseFrontmatter(raw)
    docs.push({
      id: frontmatter['id'] || filename.replace(/\.md$/, ''),
      filename,
      source: frontmatter['source'] || 'unknown',
      timestamp: frontmatter['timestamp'] || '',
      body,
    })
  }
  return docs
}

async function writeFiles(root: string, entries: Array<[string, string]>): Promise<ExportedFile[]> {
  const written: ExportedFile[] = []
  for (const [relativePath, content] of entries) {
    written.push(await writePrivateFile(root, relativePath, content))
  }
  return written
}

export async function exportCase(rawOptions: CaseExportOptions): Promise<CaseExportResult> {
  const options = CaseExportOptionsSchema.parse(rawOptions)
  const workspace = workspaceOutputPaths()
  const caseInfo = await CaseStore.get(options.caseId)
  const redactor = createRedactor(options.mode)
  const evidenceVerification = await EvidenceStore.verifyManifest(options.caseId)
  const evidenceDocs = await readEvidence(options.caseId)
  const dossiers = await DossierStore.listSummaries(options.caseId)
  const outputRoot = path.resolve(options.outputDir ?? path.join(workspace.root, 'published', safeSlug(caseInfo.name)))
  await mkdir(outputRoot, { recursive: true, mode: 0o700 })

  const entries: Array<[string, string]> = [
    ['README.md', renderReadme(redactor.text(caseInfo.name))],
    ['Case.md', renderCaseMarkdown({
      caseInfo: {
        id: caseInfo.id,
        name: redactor.text(caseInfo.name),
        status: caseInfo.status,
        tags: caseInfo.tags,
        description: redactor.text(caseInfo.description),
      },
      mode: options.mode,
      evidenceVerified: evidenceVerification.ok,
      evidenceCount: evidenceVerification.count,
      entityCount: dossiers.length,
    })],
    ['LLMWIKI.md', renderLlmWiki()],
    ['llms.txt', renderLlmsTxt()],
    ['Agent Console.md', renderAgentConsole(redactor.text(caseInfo.name))],
    ['Prompts/Codex.md', renderPrompt('Codex')],
    ['Prompts/Claude-Code.md', renderPrompt('Claude Code')],
    ['Prompts/ChatGPT.md', renderPrompt('ChatGPT')],
    ['Sources/evidence-manifest.md', `# Evidence Manifest\n\nVerified: ${evidenceVerification.ok ? 'yes' : 'no'}\nEvidence files: ${evidenceVerification.count}\n`],
    ['Sources/reports-index.md', '# Reports Index\n\nGraph and report artifacts are exported when present.\n'],
  ]

  for (const evidence of evidenceDocs) {
    entries.push([
      path.join('Evidence', safeFilename(evidence.id)),
      redactor.text([
        `# Evidence: ${evidence.source}`,
        '',
        `Source file: \`${evidence.filename}\``,
        `Captured: ${evidence.timestamp || 'unknown'}`,
        '',
        evidence.body,
        '',
      ].join('\n')),
    ])
  }

  for (const dossier of dossiers) {
    const entityId = options.mode === 'public' ? redactor.aliasFor(dossier.address) : dossier.address
    entries.push([
      path.join('Entities', safeFilename(entityId)),
      redactor.text([
        `# Entity: ${entityId}`,
        '',
        `Type: ${dossier.type}`,
        `First seen: ${dossier.firstSeen || 'unknown'}`,
        `Last seen: ${dossier.lastSeen || 'unknown'}`,
        `Risk tags: ${dossier.riskTags || 'none'}`,
        '',
      ].join('\n')),
    ])
  }

  const files = await writeFiles(outputRoot, entries)
  const exportedAt = new Date().toISOString()
  const manifest = CaseExportManifestSchema.parse({
    schema: 'chain-insights.case_export.v1',
    case_id: caseInfo.id,
    case_name: redactor.text(caseInfo.name),
    exported_at: exportedAt,
    mode: options.mode,
    target: options.target,
    source_workspace: workspace.root,
    verification: {
      evidence_manifest_verified: evidenceVerification.ok,
      verified_at: exportedAt,
      evidence_count: evidenceVerification.count,
    },
    files,
    redactions: redactor.redactions(),
    warnings: evidenceVerification.ok ? [] : [`Evidence manifest failed: ${(evidenceVerification.tampered ?? []).join(', ')}`],
  })
  const manifestFile = await writePrivateFile(outputRoot, 'manifest.chain-insights.json', JSON.stringify(manifest, null, 2) + '\n')

  return {
    manifestPath: path.join(outputRoot, manifestFile.path),
    outputDir: outputRoot,
    fileCount: files.length + 1,
    warnings: manifest.warnings,
    nextFile: 'Agent Console.md',
  }
}
