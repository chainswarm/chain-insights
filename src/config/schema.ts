import * as z from 'zod'
import os from 'node:os'
import path from 'node:path'

export const ConfigSchema = z.object({
  mcpEndpoint:       z.string().url().default('http://localhost:4000'),
  mcpAuthToken:      z.string().optional(),
  graphMcpEndpoint:  z.string().default(process.env.GRAPH_MCP_ENDPOINT ?? 'https://staging-mcp.chain-insights.ai/mcp'),
  graphMcpAuthToken: z.string().optional(),
  graphMcpMode:      z.enum(['paid', 'debug']).default('paid'),
  walletAddress:     z.string().optional(),
  serverPort:        z.number().int().min(1024).max(65535).default(4321),
  dataDir:           z.string().default(path.join(os.homedir(), '.chain-insights')),
  version:           z.string().default('1'),
})

export type InvestigatorConfig = z.infer<typeof ConfigSchema>
export const DEFAULT_CONFIG: InvestigatorConfig = ConfigSchema.parse({})

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
