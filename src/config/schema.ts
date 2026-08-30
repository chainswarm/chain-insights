import * as z from 'zod'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_GRAPH_MCP_ENDPOINT, validateMcpEndpoint } from './mcp-endpoint.js'
import { LIMIT_SPECS, isLimitKey, limitCeiling, type LimitKey } from './limits.js'

// Config-file layer for the tunable search bounds (see config/limits.ts).
// `limits` applies to every network; `networkLimits.<network>` is more
// specific and wins over it. Both are validated here so a bad value fails at
// config load rather than mid-investigation, and an unknown key is rejected
// outright — a silently ignored knob is indistinguishable from one that had
// no effect.
function limitBagSchema(network?: string) {
  return z.record(z.string(), z.number()).superRefine((bag, ctx) => {
    for (const [key, value] of Object.entries(bag)) {
      const where = network ? `networkLimits.${network}.${key}` : `limits.${key}`
      if (!isLimitKey(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${where}: unknown limit key` })
        continue
      }
      const spec = LIMIT_SPECS[key as LimitKey]
      const ceiling = limitCeiling(key as LimitKey, network)
      if (!Number.isInteger(value) || value < spec.min || value > ceiling) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${where}: must be an integer between ${spec.min} and ${ceiling} (got ${value})`,
        })
      }
    }
  })
}

export const LimitsSchema = limitBagSchema()

export const NetworkLimitsSchema = z
  .record(z.string(), z.record(z.string(), z.number()))
  .superRefine((byNetwork, ctx) => {
    for (const [network, bag] of Object.entries(byNetwork)) {
      const parsed = limitBagSchema(network).safeParse(bag)
      if (parsed.success) continue
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue.message })
      }
    }
  })

function endpointSchema(key: 'graphMcpEndpoint') {
  return z.string().transform((value, ctx) => {
    try {
      return validateMcpEndpoint(value, key)
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: (err as Error).message,
      })
      return z.NEVER
    }
  })
}

export const ConfigSchema = z.object({
  graphMcpEndpoint: endpointSchema('graphMcpEndpoint').default(DEFAULT_GRAPH_MCP_ENDPOINT),
  graphMcpAuthToken: z.string().optional(),
  graphMcpMode: z.enum(['paid', 'debug']).default('paid'),
  walletAddress: z.string().optional(),
  serverPort: z.number().int().min(1024).max(65535).default(4321),
  dataDir: z.string().default(path.join(os.homedir(), '.chain-insights')),
  version: z.string().default('1'),
  limits: LimitsSchema.optional(),
  networkLimits: NetworkLimitsSchema.optional(),
  // Paths only. Never store or log certificate or key bytes.
  truthIngressCertPath: z.string().min(1).optional(),
  truthIngressKeyPath: z.string().min(1).optional(),
  truthIngressCaPath: z.string().min(1).optional(),
})

export type InvestigatorConfig = z.infer<typeof ConfigSchema>

function formatConfigValidationError(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join('\n')
}

export function parseInvestigatorConfig(input: unknown): InvestigatorConfig {
  const parsed = ConfigSchema.safeParse(input)
  if (parsed.success) return parsed.data
  throw new Error(formatConfigValidationError(parsed.error))
}

export const DEFAULT_CONFIG: InvestigatorConfig = parseInvestigatorConfig({})

export const CONFIG_KEYS = [
  'graphMcpEndpoint',
  'graphMcpAuthToken',
  'graphMcpMode',
  'walletAddress',
  'serverPort',
  'dataDir',
  'version',
  // `limits` / `networkLimits` are nested objects, not scalar `cia config set`
  // targets, so they are deliberately absent from CONFIG_KEYS. Edit them in
  // ~/.chain-insights/config.json; they are validated on load.
] as const

export type ConfigKey = (typeof CONFIG_KEYS)[number]
