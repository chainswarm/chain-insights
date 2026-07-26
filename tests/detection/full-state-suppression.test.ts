// Regression: three of four detectors ignored the scan window, so every
// scheduled run re-emitted a byte-identical finding set and flooded the review
// backlog. Full-state detectors now declare themselves, keep their full scan,
// stop advancing a checkpoint nothing reads, and emit only NEW findings.
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { attackAttributionDetector } from '../../src/detection/detectors/attack-attribution.js'
import { fakeTokenDetector } from '../../src/detection/detectors/fake-token.js'
import { mixerDetector } from '../../src/detection/detectors/mixer.js'
import { addressPoisoningDetector } from '../../src/detection/detectors/address-poisoning.js'
import { readCheckpoint } from '../../src/detection/checkpoint.js'
import { filterNewFindings, findingKey } from '../../src/detection/emitted-state.js'
import { runOneDetection } from '../../src/detection/run.js'
import { DETECTORS } from '../../src/detection/registry.js'
import type { DetectionFinding } from '../../src/investigation/detection-findings.js'
import type { DetectorScan } from '../../src/detection/runtime.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-fullstate-'))
}

// A detector standing in for the live defect: a full scan that re-derives the
// same 1,183-finding set every run regardless of the window it is handed.
function stableFullScanner(size: number, scanned: number[]): DetectorScan {
  return {
    tool: 'aml_attack_attribution',
    id: 'attack-attribution',
    windowMode: 'full-state',
    scan: async (window) => {
      scanned.push(window.fromMs)
      return Array.from({ length: size }, (_, i) => ({
        address: `0xattributed${i}`,
        classification: 'attributed_bad_actor' as const,
        gate: 'downstream_flow_attribution',
        // Evidence churns between runs; it must NOT count as a new finding.
        evidence: { seed: '0xseed', hop: 1 + (scanned.length % 3) },
        truncated: false,
        inconclusive: false,
      }))
    },
  }
}

async function runWith(scanner: DetectorScan, root: string, nowMs: number, full = false) {
  const original = DETECTORS[scanner.id]
  DETECTORS[scanner.id] = scanner
  try {
    return await runOneDetection({} as never, {
      detector: scanner.id,
      network: 'bittensor',
      full,
      workspaceRoot: root,
      nowMs,
    })
  } finally {
    DETECTORS[scanner.id] = original
  }
}

describe('full-state detectors do not re-flood the review backlog', () => {
  it('three consecutive runs over unchanged data emit findings ONCE', async () => {
    const root = await ws()
    const scanned: number[] = []
    const scanner = stableFullScanner(1183, scanned)

    const first = await runWith(scanner, root, 1_000)
    const second = await runWith(scanner, root, 2_000)
    const third = await runWith(scanner, root, 3_000)

    // The scan still runs in full every time (correctness preserved) ...
    expect(scanned).toEqual([0, 0, 0])
    // ... but only the first run puts anything in front of the reviewer.
    expect(first.findingsCount).toBe(1183)
    expect(second.findingsCount).toBe(0)
    expect(third.findingsCount).toBe(0)
  })

  it('genuinely new findings still surface on a later run', async () => {
    const root = await ws()
    const scanned: number[] = []
    await runWith(stableFullScanner(3, scanned), root, 1_000)
    const grown = await runWith(stableFullScanner(5, scanned), root, 2_000)
    expect(grown.findingsCount).toBe(2)
  })

  it('does not advance a checkpoint it never reads', async () => {
    const root = await ws()
    const scanned: number[] = []
    await runWith(stableFullScanner(2, scanned), root, 5_000)
    const cp = await readCheckpoint(root, 'attack-attribution', 'bittensor')
    expect(cp.last_block_timestamp_ms).toBe(0)
    expect(cp.last_scanned_at_ms).toBe(0)
  })

  it('records the suppression in the document instead of hiding it', async () => {
    const root = await ws()
    const scanned: number[] = []
    await runWith(stableFullScanner(4, scanned), root, 1_000)
    const second = await runWith(stableFullScanner(4, scanned), root, 2_000)
    const doc = JSON.parse(await readFile(second.findingsPath, 'utf8')) as {
      findings: unknown[]
      warnings?: string[]
    }
    expect(doc.findings).toHaveLength(0)
    expect(doc.warnings?.join(' ')).toContain('suppressed 4 finding(s)')
  })

  it('--full is the escape hatch that rebuilds the whole backlog', async () => {
    const root = await ws()
    const scanned: number[] = []
    await runWith(stableFullScanner(6, scanned), root, 1_000)
    const suppressed = await runWith(stableFullScanner(6, scanned), root, 2_000)
    expect(suppressed.findingsCount).toBe(0)
    const rebuilt = await runWith(stableFullScanner(6, scanned), root, 3_000, true)
    expect(rebuilt.findingsCount).toBe(6)
  })

  it('an incremental detector keeps advancing its checkpoint', async () => {
    const root = await ws()
    const incremental: DetectorScan = {
      tool: 'aml_address_poisoning',
      id: 'address-poisoning',
      windowMode: 'incremental',
      scan: async () => [],
    }
    await runWith(incremental, root, 7_000)
    const cp = await readCheckpoint(root, 'address-poisoning', 'bittensor')
    expect(cp.last_block_timestamp_ms).toBe(7_000)
  })
})

describe('detector window-mode declarations', () => {
  it('every shipped detector states whether it honors the window', () => {
    expect(addressPoisoningDetector.windowMode).toBe('incremental')
    expect(attackAttributionDetector.windowMode).toBe('full-state')
    expect(fakeTokenDetector.windowMode).toBe('full-state')
    expect(mixerDetector.windowMode).toBe('full-state')
  })
})

describe('finding novelty keys', () => {
  const base: DetectionFinding = {
    address: '0xabc',
    classification: 'mixer_hourglass',
    gate: 'hourglass_in_out',
    evidence: { degree_in: 50, degree_out: 50 },
    truncated: false,
    inconclusive: false,
  }

  it('is the reviewable identity, so drifting evidence is not a new finding', () => {
    const drifted = { ...base, evidence: { degree_in: 70, degree_out: 91 } }
    expect(findingKey(drifted)).toBe(findingKey(base))
    expect(filterNewFindings([drifted], [findingKey(base)]).fresh).toHaveLength(0)
  })

  it('a different address or classification is a new finding', () => {
    const other = { ...base, address: '0xdef' }
    expect(filterNewFindings([other], [findingKey(base)]).fresh).toHaveLength(1)
  })

  it('de-duplicates within a single run as well', () => {
    const res = filterNewFindings([base, { ...base }], [])
    expect(res.fresh).toHaveLength(1)
    expect(res.suppressed).toBe(1)
  })
})
