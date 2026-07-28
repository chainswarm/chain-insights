// tests/detection-findings-role.test.ts
import { describe, expect, it } from 'vitest'
import { CASE_CLUSTER_ROLES, parseFindingsDocument } from '../src/investigation/detection-findings.js'

const base = {
  schema: 'chain-insights.detection-findings.v1',
  tool: 'aml_scam_corridor_trace',
  network: 'bittensor',
  status: 'complete',
  generated_at_timestamp: 1_700_000_000_000,
}

describe('case cluster role on detection findings (label-lifecycle spec req 1)', () => {
  it('names exactly the three case roles', () => {
    expect(CASE_CLUSTER_ROLES).toEqual(['seed', 'candidate_intermediate', 'candidate_deposit'])
  })

  it('parseFindingsDocument preserves a finding role', () => {
    const doc = parseFindingsDocument({
      ...base,
      findings: [{ address: '5Seed', role: 'seed', evidence: {}, truncated: false, inconclusive: false }],
    })
    expect(doc.findings[0].role).toBe('seed')
  })

  it('role stays optional (lane-A detector docs carry none)', () => {
    const doc = parseFindingsDocument({
      ...base,
      tool: 'aml_mixer_likeness',
      findings: [{ address: '5Mix', classification: 'mixer_hourglass', evidence: {}, truncated: false, inconclusive: false }],
    })
    expect(doc.findings[0].role).toBeUndefined()
  })

  it('an unknown role value is tolerated at parse time (the export skips it with a warning; store ingest must not quarantine the doc)', () => {
    const doc = parseFindingsDocument({
      ...base,
      findings: [{ address: '5X', role: 'made_up_role', evidence: {}, truncated: false, inconclusive: false }],
    })
    expect(doc.findings[0].role).toBe('made_up_role')
  })
})
