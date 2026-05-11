import { readFileSync } from 'node:fs'
import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { buildCssVariables, buildLayoutCss } from './theme.js'
import { buildVizLogic } from './templates/viz-logic.js'
import type { GraphData } from './graph-model.js'

// Resolve d3 bundle path relative to this module's location.
// We compute it via the d3 package.json location to avoid "exports" field restrictions.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const d3BundlePath = path.resolve(__dirname, '..', '..', 'node_modules', 'd3', 'dist', 'd3.min.js')
const d3Script = readFileSync(d3BundlePath, 'utf-8')

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function generateHtml(data: GraphData, title: string): string {
  const cssVars = buildCssVariables()
  const layoutCss = buildLayoutCss()
  const graphJson = JSON.stringify(data)
  const vizLogic = buildVizLogic()

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>${cssVars}\n${layoutCss}</style>
</head>
<body>
  <div id="viz-root">
    <div id="truncation-banner"></div>
    <div id="control-bar">
      <button class="layout-btn active" data-layout="force" aria-label="Switch graph layout">Force</button>
      <button class="layout-btn" data-layout="tree" aria-label="Switch graph layout">Tree</button>
      <button id="zoom-reset" aria-label="Fit to view"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 3h7V1H1v9h2V3zm11-2v2h7v7h2V1h-9zM3 14H1v9h9v-2H3v-7zm18 0h-2v7h-7v2h9v-9z"/></svg></button>
    </div>
    <svg id="graph" xmlns="http://www.w3.org/2000/svg"></svg>
    <div id="legend-panel" class="collapsed">
      <button id="legend-toggle" aria-label="Toggle legend panel">?</button>
      <div id="legend-content"></div>
    </div>
    <div id="tooltip"></div>
  </div>
  <script>${d3Script}</script>
  <script>const GRAPH_DATA = ${graphJson};</script>
  <script>${vizLogic}</script>
</body>
</html>`
}

export async function writeVizHtml(vizId: string, html: string, caseId?: string): Promise<string> {
  let vizDir: string
  if (caseId) {
    // Case-based: store alongside case data per CONTEXT.md locked decision
    vizDir = path.join(os.homedir(), '.chain-insights', 'cases', caseId, 'viz')
  } else {
    // Standalone/ad-hoc: store in central directory
    vizDir = path.join(os.homedir(), '.chain-insights', 'viz')
  }
  await mkdir(vizDir, { recursive: true })
  const filePath = path.join(vizDir, `${vizId}.html`)
  await writeFile(filePath, html, { mode: 0o600 })
  return filePath
}
