import { createHash } from 'node:crypto'

import type { InvestigatorConfig } from '../config/schema.js'

/** Task 1 language-neutral proposal schema. Pin path, digest, and commit. */
export const GOVERNED_TRUTH_PROPOSAL_PAYLOAD_V2_PIN = {
  path: 'schemas/contracts/governed-truth-proposal-payload-v2.schema.json',
  digest: '8eb07f187536862bc0cbb2810bc82a511b3c0b00b3476d65e7cfa1ecea494049',
  commit: '0127ff995556b9110f485ba30ae2ba5802899773',
} as const

export type TruthProposalEvidenceKind = 'investigation' | 'model' | 'attribution'

export type TruthProposalFinding = {
  networkId: string
  authorityDomain: string
  canonicalSubject: string
  factRefs: readonly string[]
  reviewDecisionRefs: readonly string[]
  producerId: string
  reviewerId: string
  evidenceKind: TruthProposalEvidenceKind
}

export type TruthProposalCommand = {
  networkId: string
  authorityDomain: string
  canonicalSubject: string
  factRefs: readonly string[]
  reviewDecisionRefs: readonly string[]
  evidenceDigest: string
}

export type TruthIngressTlsPaths = {
  certPath?: string
  keyPath?: string
  caPath?: string
}

export function resolveTruthIngressTlsPaths(config: InvestigatorConfig): TruthIngressTlsPaths {
  return {
    certPath: config.truthIngressCertPath,
    keyPath: config.truthIngressKeyPath,
    caPath: config.truthIngressCaPath,
  }
}

export async function buildTruthProposal(
  finding: TruthProposalFinding
): Promise<TruthProposalCommand> {
  if (!finding.producerId || !finding.reviewerId || finding.producerId === finding.reviewerId) {
    throw new Error('independent review required')
  }
  if (finding.reviewDecisionRefs.length === 0) {
    throw new Error('independent review required')
  }
  if (finding.evidenceKind !== 'investigation') {
    throw new Error('investigation evidence only')
  }

  const evidenceDigest = createHash('sha256')
    .update(
      JSON.stringify({
        factRefs: finding.factRefs,
        reviewDecisionRefs: finding.reviewDecisionRefs,
        schema: GOVERNED_TRUTH_PROPOSAL_PAYLOAD_V2_PIN,
      })
    )
    .digest('hex')

  return {
    networkId: finding.networkId,
    authorityDomain: finding.authorityDomain,
    canonicalSubject: finding.canonicalSubject,
    factRefs: finding.factRefs,
    reviewDecisionRefs: finding.reviewDecisionRefs,
    evidenceDigest,
  }
}
