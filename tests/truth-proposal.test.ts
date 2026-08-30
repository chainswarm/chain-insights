import { describe, expect, it } from 'vitest'

import { buildTruthProposal } from '../src/investigation/truth-proposal.js'

const reviewedFinding = {
  networkId: 'robinhood',
  authorityDomain: 'global',
  canonicalSubject: '0x1111111111111111111111111111111111111111',
  factRefs: ['fact:investigation:1'],
  reviewDecisionRefs: ['review:independent:1'],
  producerId: 'cia-investigation',
  reviewerId: 'cia-reviewer',
  evidenceKind: 'investigation' as const,
}

describe('buildTruthProposal', () => {
  it('rejects self-review and model-only evidence', async () => {
    const selfReviewedFinding = {
      ...reviewedFinding,
      reviewerId: reviewedFinding.producerId,
    }
    const modelOnlyFinding = {
      ...reviewedFinding,
      evidenceKind: 'model' as const,
    }

    await expect(buildTruthProposal(selfReviewedFinding)).rejects.toThrow(
      'independent review required'
    )
    await expect(buildTruthProposal(modelOnlyFinding)).rejects.toThrow(
      'investigation evidence only'
    )
  })
})
