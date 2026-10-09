import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  FLOWS_RECIPE_COLUMNS,
  GRAPH_OPTIONAL_COLUMNS,
  GRAPH_REQUIRED_COLUMNS,
  isFlowsGraphQuery,
  returnedColumns,
} from '../src/mcp/graph-row-columns.js'
import { PICTURE_RULES } from '../src/mcp/proxy.js'
import { read } from './support/schema-text.js'

// The view draws a link from the columns of a row. Three things must agree on
// those columns: the bundled view that reads them, the picture hint that names
// them to the model, and every FLOWS_TO recipe the model copies. 0.54.2 found
// them apart: the recipes returned no first_seen_timestamp, so every drawn
// link panel read "First seen (UTC): Unavailable".

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const view = readFileSync(join(repoRoot, 'src/mcp/apps/claude-view.html'), 'utf8')
const routing = JSON.parse(read('tests/fixtures/layer-routing.json')) as {
  entries: { id: string; query: string; source: string }[]
}
const skill = read('skills/chain-insights-cypher/SKILL.md')

describe('the graph row columns', () => {
  it('are every one read by the bundled view', () => {
    for (const column of [...GRAPH_REQUIRED_COLUMNS, ...GRAPH_OPTIONAL_COLUMNS]) {
      expect(new RegExp(`[.'"]${column}\\b`).test(view), `${column} is not read by the view`).toBe(true)
    }
  })

  it('are named by the picture hint, in order', () => {
    expect(PICTURE_RULES).toContain(`Optional columns: ${GRAPH_OPTIONAL_COLUMNS.join(', ')}.`)
  })

  it('are named by the skill where it explains the graph picture', () => {
    const flatSkill = skill.replace(/\s+/g, ' ')
    for (const column of GRAPH_OPTIONAL_COLUMNS) {
      expect(flatSkill, `${column} missing from the skill's optional columns`).toContain(`\`${column}\``)
    }
  })
})

describe('every FLOWS_TO recipe that draws a graph', () => {
  // What the model copies: the fenced queries of the skill, and the example
  // of the picture hint. The legacy corpus recipes of docs/graph-tools.md are
  // not taught and stay out.
  const hintExample = /Example: (USE topology [^`']*?LIMIT \d+)/.exec(PICTURE_RULES)?.[1] ?? ''
  const recipes = [
    ...routing.entries.filter(
      (entry) => entry.source === 'skills/chain-insights-cypher/SKILL.md' && isFlowsGraphQuery(entry.query),
    ),
    { id: 'picture-hint-example', query: hintExample, source: 'src/mcp/proxy.ts picture rules' },
  ]

  it('is taught by the skill and shown by the picture hint', () => {
    expect(recipes.filter((entry) => entry.source.startsWith('skills/')).length).toBeGreaterThanOrEqual(3)
    expect(isFlowsGraphQuery(hintExample), hintExample).toBe(true)
  })

  it('returns every link and node column the view draws', () => {
    for (const entry of recipes) {
      const columns = new Set(returnedColumns(entry.query))
      const missing = FLOWS_RECIPE_COLUMNS.filter((column) => !columns.has(column))
      expect(missing, `${entry.id} (${entry.source}) returns no ${missing.join(', ')}`).toEqual([])
    }
  })
})
