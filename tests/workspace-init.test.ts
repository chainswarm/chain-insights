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
  it('names the three label_risk lists, the role flags and UNSCORED in the runtime schema notes', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'chain-insights-workspace-init-'))

    try {
      await initWorkspace({ targetDir: workspace })
      const runtimeSkill = await readFile(
        join(workspace, '.chain-insights', 'runtime-skill', 'SKILL.md'),
        'utf8'
      )

      for (const name of [
        'label_risk_labels',
        'label_risk_levels',
        'label_risk_updated_timestamps',
        'is_exchange',
        'is_malicious',
        'is_victim',
        'is_issuer_frozen',
        ':Exchange',
        ':Malicious',
        ':Victim',
        ':IssuerFrozen',
        'UNSCORED',
      ]) {
        expect(runtimeSkill, `missing ${name}`).toContain(name)
      }
      expect(runtimeSkill.replace(/\s+/g, ' ')).toContain(
        'present only when true and absent otherwise'
      )
      expect(runtimeSkill).not.toMatch(/`label_risk`/)
      // The claims lists beside the judgement marks are named, so a risk
      // question is answered; the answer it shows is plain words, no code.
      for (const name of ['malicious_claims', 'victim_claims', 'suspect_labels', 'categories', 'case_judgements', 'malicious|sanctioned|', 'FAKE_TOKEN', 'VICTIM']) {
        expect(runtimeSkill, `missing ${name}`).toContain(name)
      }
      // The notes ask by the marks the served graph holds; an older mark is
      // only named after them, in the fallback note, never in a read.
      for (const older of [':Scam', ':Poisoned', ':Sanctioned', ':Targeted', ':OnMoneyTrail']) {
        expect(runtimeSkill.indexOf(older), older).toBeGreaterThan(runtimeSkill.indexOf(':Malicious'))
      }
      expect(runtimeSkill).not.toMatch(/\(\w*:(Scam|Poisoned|Sanctioned|Targeted|OnMoneyTrail)\b|\.(risk|protection|traced)_claims\b/)
      const flatSkill = runtimeSkill.replace(/\s+/g, ' ')
      const examples = /in plain words, such as (.+?), never the list name or the code/.exec(flatSkill)?.[1] ?? ''
      expect(examples).toContain('"a fake-token scam"')
      expect(examples).not.toMatch(/[A-Z]{2,}_[A-Z_]+|_claims|suspect_labels/)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('lists the four served FLOWED_TO fields and names the sync bookkeeping as internal', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'chain-insights-workspace-init-'))

    try {
      await initWorkspace({ targetDir: workspace })
      const runtimeSkill = await readFile(
        join(workspace, '.chain-insights', 'runtime-skill', 'SKILL.md'),
        'utf8'
      )
      const flat = runtimeSkill.replace(/\s+/g, ' ')

      for (const name of ['tx_count', 'amount_usd_sum', 'first_seen_timestamp', 'last_seen_timestamp']) {
        expect(flat, `missing ${name}`).toContain(name)
      }
      expect(flat).toContain(
        '`pair_key` and `synced_through_height` are internal sync bookkeeping, not to be queried'
      )
      expect(flat).not.toContain('carry exactly')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
