import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { CaseStore, DossierStore, EvidenceStore, parseFrontmatter } from '../cases/index.js'
import { graphToCanvas } from '../export/canvas.js'
import { safeFilename } from '../export/paths.js'
import type { JsonCanvas } from '../export/schema.js'
import { extractGraphFromCase } from '../viz/data-extractor.js'
import { normalizeGraphPayload } from '../viz/graph-normalizer.js'
import { workspaceOutputPaths } from '../workspace/output-root.js'
import type { CaseVaultRefreshOptions, CaseVaultRefreshResult, VaultScaffoldOptions, VaultScaffoldResult } from './schema.js'
import { VAULT_DIRS } from './schema.js'
import {
  renderCaseEntityIndex,
  renderCaseEvidenceIndex,
  renderCaseAgentConsole,
  renderEntityNote,
  renderEvidenceNote,
  renderLiveCaseNote,
  renderObsidianAppConfig,
  renderObsidianGraphConfig,
  renderObsidianTemplatesConfig,
  renderRootAgentConsole,
  renderRootIndex,
  renderVaultGitignore,
  renderVaultHome,
  type VaultEntitySummary,
  type VaultEvidenceSummary,
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

export async function refreshCaseVault(options: CaseVaultRefreshOptions): Promise<CaseVaultRefreshResult> {
  const workspace = workspaceOutputPaths()
  const force = options.force === true
  const [caseInfo, evidenceVerification, evidence, dossiers, graph] = await Promise.all([
    CaseStore.get(options.caseId),
    EvidenceStore.verifyManifest(options.caseId),
    readCaseEvidence(options.caseId),
    DossierStore.listSummaries(options.caseId),
    loadLiveCaseGraph(options.caseId),
  ])

  const caseSummary = {
    id: caseInfo.id,
    name: caseInfo.name,
    status: caseInfo.status,
    tags: caseInfo.tags,
    description: caseInfo.description,
    evidenceCount: evidenceVerification.count,
    evidenceVerified: evidenceVerification.ok,
    entityCount: dossiers.length,
  }
  const canvasGraph = {
    ...graph,
    nodes: mergeDossierNodes(graph.nodes, dossiers),
  }
  const canvas = graphToCaseVaultCanvas(graphToCanvas(canvasGraph), caseInfo.id, canvasGraph.nodes)
  const evidenceSummaries = evidence.map(evidenceDoc => ({
    ...evidenceDoc,
    notePath: `Evidence/${safeFilename(`${evidenceDoc.filename.replace(/\.md$/, '')}-${caseInfo.id}`)}`,
  }))
  const entityFiles = entityFilesForCase(caseInfo.id, canvasGraph.nodes, dossiers)
  const entitySummaries = [...entityFiles.values()]
    .map(entry => entry.summary)
    .sort((left, right) => left.label.localeCompare(right.label))

  const files: VaultFile[] = [
    { path: `cases/${caseInfo.id}/Case.md`, content: renderLiveCaseNote(caseSummary) },
    { path: `cases/${caseInfo.id}/Agent Console.md`, content: renderCaseAgentConsole(caseSummary) },
    { path: `cases/${caseInfo.id}/Evidence.md`, content: renderCaseEvidenceIndex(caseSummary, evidenceSummaries) },
    { path: `cases/${caseInfo.id}/Entities.md`, content: renderCaseEntityIndex(caseSummary, entitySummaries) },
    { path: `cases/${caseInfo.id}/Graph.canvas`, content: JSON.stringify(canvas, null, 2) + '\n' },
    ...evidenceSummaries.map(evidenceDoc => ({
      path: evidenceDoc.notePath,
      content: renderEvidenceNote(evidenceDoc, caseInfo.id),
    })),
    ...[...entityFiles.values()].map(entry => ({
      path: entry.summary.notePath,
      content: entry.content,
    })),
  ]

  if (!force) {
    await assertNoFileCollisions(workspace.root, files)
  }

  const filesWritten: string[] = []
  for (const file of files) {
    await writeVaultFile(workspace.root, file, force)
    filesWritten.push(file.path)
  }

  return {
    caseId: caseInfo.id,
    filesWritten,
    nextFile: `cases/${caseInfo.id}/Case.md`,
  }
}

export async function assertNoVaultFileCollisions(workspaceRoot: string): Promise<void> {
  await assertNoFileCollisions(workspaceRoot, VAULT_FILES)
}

async function assertNoFileCollisions(workspaceRoot: string, files: VaultFile[]): Promise<void> {
  for (const file of files) {
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
    const filePath = join(workspaceRoot, file.path)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, file.content, { encoding: 'utf8', flag: force ? 'w' : 'wx' })
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

function mergeDossierNodes(
  graphNodes: Record<string, unknown>[],
  dossiers: Array<{ address: string; type: string }>,
): Record<string, unknown>[] {
  const nodesById = new Map<string, Record<string, unknown>>()
  const aliases = new Map<string, string>()
  graphNodes.forEach((node, index) => {
    const id = String(node['id'] ?? node['address'] ?? `node-${index + 1}`)
    nodesById.set(id, node)
    aliases.set(id, id)
    if (typeof node['address'] === 'string') aliases.set(node['address'], id)
  })

  for (const dossier of dossiers) {
    const existingId = aliases.get(dossier.address)
    if (existingId) {
      const existing = nodesById.get(existingId)
      if (existing) {
        nodesById.set(existingId, enrichDossierNode(existing, dossier.type))
      }
    } else {
      nodesById.set(dossier.address, {
        id: dossier.address,
        address: dossier.address,
        node_type: dossier.type,
        roles: [dossier.type],
      })
    }
  }
  return [...nodesById.values()]
}

type EvidenceDoc = Omit<VaultEvidenceSummary, 'notePath'>

async function readCaseEvidence(caseId: string): Promise<EvidenceDoc[]> {
  const workspace = workspaceOutputPaths()
  const evidenceDir = join(workspace.casesRoot, caseId, 'evidence')
  const files = await readdir(evidenceDir).catch(() => [])
  const docs: EvidenceDoc[] = []
  for (const filename of files.filter(file => file.endsWith('.md')).sort()) {
    const raw = await readFile(join(evidenceDir, filename), 'utf8')
    const { frontmatter, body } = parseFrontmatter(raw)
    docs.push({
      id: frontmatter['id'] || filename.replace(/\.md$/, ''),
      filename,
      source: frontmatter['source'] || 'unknown',
      timestamp: frontmatter['timestamp'] || '',
      queryParams: frontmatter['queryParams'] || '',
      body,
    })
  }
  return docs
}

function entityFilesForCase(
  caseId: string,
  graphNodes: Record<string, unknown>[],
  dossiers: Array<{ address: string; type: string }>,
): Map<string, { summary: VaultEntitySummary; content: string }> {
  const files = new Map<string, { summary: VaultEntitySummary; content: string }>()

  for (const [index, node] of graphNodes.entries()) {
    const label = entityLabelForGraphNode(node, index)
    const entityType = String(node['entityType'] ?? node['node_type'] ?? node['nodeType'] ?? 'unknown')
    const notePath = `Entities/${safeFilename(label)}`
    files.set(notePath, {
      summary: { label, notePath, entityType },
      content: renderEntityNote(label, caseId, entityType),
    })
  }

  for (const dossier of dossiers) {
    const notePath = `Entities/${safeFilename(dossier.address)}`
    files.set(notePath, {
      summary: { label: dossier.address, notePath, entityType: dossier.type },
      content: renderEntityNote(dossier.address, caseId, dossier.type),
    })
  }

  return files
}

function entityLabelForGraphNode(node: Record<string, unknown>, index: number): string {
  return String(node['address'] ?? node['id'] ?? `node-${index + 1}`)
}

function graphToCaseVaultCanvas(canvas: JsonCanvas, caseId: string, graphNodes: Record<string, unknown>[]): JsonCanvas {
  return {
    nodes: canvas.nodes.map(node => {
      if (node.id === 'case' && node.type === 'file') {
        return { ...node, file: `cases/${caseId}/Case.md` }
      }
      const entityIndex = /^entity-(\d+)$/.exec(node.id)?.[1]
      if (node.type === 'file' && entityIndex) {
        const graphNode = graphNodes[Number(entityIndex) - 1]
        if (graphNode) return { ...node, file: `Entities/${safeFilename(entityLabelForGraphNode(graphNode, Number(entityIndex) - 1))}` }
      }
      return node
    }),
    edges: canvas.edges,
  }
}

async function loadLiveCaseGraph(caseId: string): Promise<{ nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }> {
  const graph = await extractGraphFromCase(caseId)
  return normalizeGraphPayload({
    schema: 'chain-insights.graph.v1',
    nodes: graph.nodes,
    edges: graph.edges,
    flows: [],
    edge_anchors: [],
    metadata: graph.metadata,
  })
}

function enrichDossierNode(node: Record<string, unknown>, dossierType: string): Record<string, unknown> {
  const enriched = { ...node }
  if (typeof enriched['node_type'] !== 'string' || enriched['node_type'] === 'unknown') {
    enriched['node_type'] = dossierType
  }
  if (!Array.isArray(enriched['roles']) || enriched['roles'].length === 0) {
    enriched['roles'] = [dossierType]
  }
  return enriched
}
