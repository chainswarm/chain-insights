import { existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('Robinhood Dozer client contract', () => {
  it('removes client-side shard merge', () => {
    for (const path of [
      'src/federation/merge.ts',
      'src/federation/apply-merge.ts',
      'scripts/merge-shards.mjs',
      'tests/federation/merge.test.ts',
    ]) {
      expect(existsSync(join(root, path)), `${path} must be deleted`).toBe(false)
    }

    const publicTools = readFileSync(join(root, 'src/investigation/public-tools.ts'), 'utf8')
    expect(publicTools).not.toContain('federation')
    expect(publicTools).not.toContain('applyShardMergeToBatchEntries')

    const index = readFileSync(join(root, 'src/index.ts'), 'utf8')
    expect(index).not.toContain('mergeShardRows')
  })

  it('uses ISO GQL and forbids Memgraph-only path syntax', () => {
    const skill = readFileSync(join(root, 'skills/chain-insights-cypher/SKILL.md'), 'utf8')
    const publicTools = readFileSync(join(root, 'src/investigation/public-tools.ts'), 'utf8')
    const combined = `${skill}\n${publicTools}`

    expect(skill).toContain('ISO GQL')
    expect(skill).toContain('MATCH SHORTEST 1')
    expect(skill).toContain('-[:FLOWS_TO]-{1,5}')
    expect(skill).not.toMatch(/\*\s*(BFS|DFS|WSHORTEST|ALLSHORTEST|KSHORTEST)/i)
    expect(skill).not.toMatch(/shortestPath|allShortestPaths/i)
    expect(skill).not.toMatch(/Memgraph/i)
    expect(publicTools).toContain('MATCH p = SHORTEST 1')
    expect(publicTools).not.toMatch(/\*\s*(BFS|DFS|WSHORTEST|ALLSHORTEST|KSHORTEST)/i)
    expect(combined).not.toMatch(/shortestPath|allShortestPaths/i)
  })
})
