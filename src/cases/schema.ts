import * as z from 'zod'

// Case ID format: YYYYMMDD_NNN_slug (e.g. 20260511_001_tornado-mixer)
// Regex rejects path traversal chars (../, shell chars) per T-03-01 threat model.
const caseIdRegex = /^\d{8}_\d{3}_[a-z0-9][a-z0-9-]*$/

export const CaseStatusEnum = z.enum(['open', 'active', 'suspended', 'closed'])
export type CaseStatus = z.infer<typeof CaseStatusEnum>

export const CaseSchema = z.object({
  id:          z.string().regex(caseIdRegex, 'Invalid case ID format'),
  name:        z.string().min(1).max(200),
  status:      CaseStatusEnum.default('open'),
  created:     z.string().datetime(),
  updated:     z.string().datetime(),
  tags:        z.array(z.string()).default([]),
  description: z.string().default(''),
  slug:        z.string().optional(),
})
export type Case = z.infer<typeof CaseSchema>

export const EvidenceSchema = z.object({
  id:          z.string().min(1),
  caseId:      z.string().regex(caseIdRegex),
  source:      z.string().min(1),
  timestamp:   z.string().datetime(),
  queryParams: z.string().default(''),
})
export type Evidence = z.infer<typeof EvidenceSchema>

export const DossierSchema = z.object({
  address:   z.string().min(1).max(100),
  type:      z.enum(['eoa', 'contract', 'exchange', 'mixer', 'unknown']).default('unknown'),
  firstSeen: z.string().datetime(),
  lastSeen:  z.string().datetime(),
  riskTags:  z.string().default(''),
})
export type Dossier = z.infer<typeof DossierSchema>

export const SessionSchema = z.object({
  sessionId: z.string().min(1),
  caseId:    z.string().regex(caseIdRegex),
  startTime: z.string().datetime(),
  endTime:   z.string().optional(),
  status:    z.enum(['active', 'ended']).default('active'),
})
export type Session = z.infer<typeof SessionSchema>
