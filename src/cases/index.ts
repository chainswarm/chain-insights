// Stable public surface for the cases module.
export { CaseStore, generateCaseId } from './store.js'
export { parseFrontmatter, serializeFrontmatter } from './frontmatter.js'
export { CaseSchema, EvidenceSchema, DossierSchema, SessionSchema, CaseStatusEnum } from './schema.js'
export type { Case, Evidence, Dossier, Session, CaseStatus } from './schema.js'
