import * as z from 'zod'

export const ParamSpecSchema = z.object({
  name:     z.string(),
  type:     z.enum(['string', 'number', 'boolean']).default('string'),
  required: z.boolean().default(true),
  default:  z.string().optional(),
})

export const StepSchema = z.object({
  index:  z.number().int().positive(),
  label:  z.string(),
  tool:   z.string().min(1),
  params: z.record(z.string()),
})

export const PlaybookSchema = z.object({
  name:        z.string().min(1),
  description: z.string().default(''),
  version:     z.string().default('1.0.0'),
  params:      z.array(ParamSpecSchema).default([]),
  steps:       z.array(StepSchema),
})

export type PlaybookDefinition = z.infer<typeof PlaybookSchema>
export type StepDefinition     = z.infer<typeof StepSchema>
export type ParamSpec          = z.infer<typeof ParamSpecSchema>
