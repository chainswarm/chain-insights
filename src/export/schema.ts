import * as z from 'zod'

export const CaseExportTargetSchema = z.enum(['obsidian-llmwiki'])
export type CaseExportTarget = z.infer<typeof CaseExportTargetSchema>

export const CaseExportModeSchema = z.enum(['private', 'partner', 'public'])
export type CaseExportMode = z.infer<typeof CaseExportModeSchema>

const caseIdRegex = /^\d{8}_\d{3}_[a-z0-9][a-z0-9-]*$/

export const CaseExportOptionsSchema = z.object({
  caseId:    z.string().regex(caseIdRegex),
  target:    CaseExportTargetSchema.default('obsidian-llmwiki'),
  mode:      CaseExportModeSchema.default('private'),
  outputDir: z.string().optional(),
})
export type CaseExportOptions = z.infer<typeof CaseExportOptionsSchema>

export const ExportedFileSchema = z.object({
  path:   z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes:  z.number().int().nonnegative(),
})
export type ExportedFile = z.infer<typeof ExportedFileSchema>

export const CaseExportManifestSchema = z.object({
  schema:           z.literal('chain-insights.case_export.v1'),
  case_id:          z.string().regex(caseIdRegex),
  case_name:        z.string().min(1),
  exported_at:      z.string().datetime(),
  mode:             CaseExportModeSchema,
  target:           CaseExportTargetSchema,
  source_workspace: z.string().min(1),
  verification:     z.object({
    evidence_manifest_verified: z.boolean(),
    verified_at:                z.string().datetime(),
    evidence_count:             z.number().int().nonnegative(),
  }),
  files:      z.array(ExportedFileSchema),
  redactions: z.array(z.string()),
  warnings:   z.array(z.string()),
})
export type CaseExportManifest = z.infer<typeof CaseExportManifestSchema>

export const JsonCanvasNodeSchema = z.object({
  id:     z.string().min(1),
  type:   z.enum(['text', 'file', 'link', 'group']),
  x:      z.number(),
  y:      z.number(),
  width:  z.number().positive(),
  height: z.number().positive(),
  text:   z.string().optional(),
  file:   z.string().optional(),
  url:    z.string().optional(),
  label:  z.string().optional(),
  color:  z.string().optional(),
})

export const JsonCanvasEdgeSchema = z.object({
  id:       z.string().min(1),
  fromNode: z.string().min(1),
  toNode:   z.string().min(1),
  fromSide: z.enum(['top', 'right', 'bottom', 'left']).optional(),
  toSide:   z.enum(['top', 'right', 'bottom', 'left']).optional(),
  toEnd:    z.enum(['none', 'arrow']).optional(),
  label:    z.string().optional(),
  color:    z.string().optional(),
})

export const JsonCanvasSchema = z.object({
  nodes: z.array(JsonCanvasNodeSchema),
  edges: z.array(JsonCanvasEdgeSchema),
})
export type JsonCanvas = z.infer<typeof JsonCanvasSchema>

export type CaseExportResult = {
  manifestPath: string
  outputDir: string
  fileCount: number
  warnings: string[]
  nextFile: string
}
