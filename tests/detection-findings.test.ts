import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DETECTION_FINDINGS_SCHEMA,
  DETECTION_FINDINGS_SCHEMA_VERSION,
  parseFindings,
  parseFindingsDocument,
  serializeFindings,
  type DetectionFindingsDocument,
} from '../src/investigation/detection-findings.js'

const FIXTURE: DetectionFindingsDocument = {
  schema: DETECTION_FINDINGS_SCHEMA_VERSION,
  tool: 'aml_scam_corridor_trace',
  network: 'bittensor',
  status: 'complete',
  generated_at_timestamp: 1_720_000_000_000,
  findings: [
    {
      address: '5Seed...',
      classification: 'propagated_scam',
      gate: 'propagated_scam',
      evidence: { hop: 1, degree_in: 3, is_exchange: false, labels: [], tx_count: 1, amount_usd_sum: 10 },
      truncated: false,
      inconclusive: false,
    },
    {
      address: '5Exchange...',
      classification: 'exchange_terminal',
      gate: 'exchange_terminal',
      evidence: { hop: 1, degree_in: 3000, is_exchange: true, labels: ['Exchange'], tx_count: 5, amount_usd_sum: 12_000 },
      truncated: false,
      inconclusive: false,
    },
  ],
  query_count: 1,
  wall_clock_ms: 42,
}

const tempDirs: string[] = []

async function makeWorkspaceRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chain-insights-findings-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('detection findings schema round-trip (AC5)', () => {
  it('serializes and parses a fixture document unchanged', async () => {
    const workspaceRoot = await makeWorkspaceRoot()
    const { filePath, document } = await serializeFindings(FIXTURE, { workspaceRoot })
    expect(filePath).toContain(workspaceRoot)
    expect(document).toEqual(FIXTURE)

    const parsed = await parseFindings(filePath)
    expect(parsed).toEqual(FIXTURE)
  })

  it('round-trips an aml_exchange_likeness document with a null (inconclusive) exchange_like', async () => {
    const workspaceRoot = await makeWorkspaceRoot()
    const document: DetectionFindingsDocument = {
      schema: DETECTION_FINDINGS_SCHEMA_VERSION,
      tool: 'aml_exchange_likeness',
      network: 'bittensor',
      status: 'inconclusive',
      generated_at_timestamp: 1_720_000_000_001,
      findings: [
        {
          address: '5Candidate...',
          exchange_like: null,
          evidence: { degree_in: 1200, reciprocity: null, total_in_usd: 60_000_000 },
          truncated: false,
          inconclusive: true,
          inconclusive_reason: 'query_timeout',
        },
      ],
      threshold_provenance: { fanin_min: 1000, reciprocity_max: 0.06, lifetime_inbound_min_usd: 50_000_000 },
    }
    const { filePath } = await serializeFindings(document, { workspaceRoot })
    const parsed = await parseFindings(filePath)
    expect(parsed).toEqual(document)
  })

  it('rejects a document with the wrong schema version', () => {
    const badDocument = { ...FIXTURE, schema: 'chain-insights.detection-findings.v2' }
    expect(() => parseFindingsDocument(badDocument)).toThrow(/Invalid detection findings document/)
  })

  it('rejects a document missing the schema field entirely', () => {
    const { schema: _schema, ...withoutSchema } = FIXTURE
    expect(() => parseFindingsDocument(withoutSchema)).toThrow()
  })

  it('rejects an unknown tool discriminator value', () => {
    const badDocument = { ...FIXTURE, tool: 'aml_something_else' }
    expect(() => parseFindingsDocument(badDocument)).toThrow()
  })

  it('DETECTION_FINDINGS_SCHEMA is directly usable for safeParse', () => {
    expect(DETECTION_FINDINGS_SCHEMA.safeParse(FIXTURE).success).toBe(true)
    expect(DETECTION_FINDINGS_SCHEMA.safeParse({ ...FIXTURE, status: 'unknown' }).success).toBe(false)
  })
})
