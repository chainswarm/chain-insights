import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { initWorkspace } from '../src/workspace/init.js'

describe('workspace initialization', () => {
  it('writes a parseable schema batch command with a quoted label literal', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'chain-insights-workspace-init-'))

    try {
      await initWorkspace({ targetDir: workspace })
      const runtimeSkill = await readFile(
        join(workspace, '.chain-insights', 'runtime-skill', 'SKILL.md'),
        'utf8'
      )
      const command = runtimeSkill.split('\n').find((line) => line.includes('node_labels'))
      const match = command?.match(/'queries=(\[.*\])'$/)

      expect(match).not.toBeNull()
      if (!match) throw new Error('schema batch command is missing its queries argument')

      const queries = JSON.parse(match[1]) as Array<{ query: string }>
      expect(queries[0]?.query).toContain('RETURN "Address" AS node_label')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
