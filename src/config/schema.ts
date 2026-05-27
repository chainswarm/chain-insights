import * as z from 'zod'
import os from 'node:os'
import path from 'node:path'
import { LOCAL_GRAPH_MCP_ENDPOINT, LOCAL_LEGACY_MCP_ENDPOINT, validateMcpEndpoint } from './mcp-endpoint.js'

function endpointSchema(key: 'mcpEndpoint' | 'graphMcpEndpoint') {
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
  mcpEndpoint:       endpointSchema('mcpEndpoint').default(LOCAL_LEGACY_MCP_ENDPOINT),
  mcpAuthToken:      z.string().optional(),
  graphMcpEndpoint:  endpointSchema('graphMcpEndpoint').default(LOCAL_GRAPH_MCP_ENDPOINT),
  graphMcpAuthToken: z.string().optional(),
  graphMcpMode:      z.enum(['paid', 'debug']).default('paid'),
  walletAddress:     z.string().optional(),
  serverPort:        z.number().int().min(1024).max(65535).default(4321),
  dataDir:           z.string().default(path.join(os.homedir(), '.chain-insights')),
  version:           z.string().default('1'),
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
  'mcpEndpoint',
  'mcpAuthToken',
  'graphMcpEndpoint',
  'graphMcpAuthToken',
  'graphMcpMode',
  'walletAddress',
  'serverPort',
  'dataDir',
  'version',
] as const

export type ConfigKey = typeof CONFIG_KEYS[number]
