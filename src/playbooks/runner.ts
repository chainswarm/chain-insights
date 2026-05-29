import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CaseStore } from '../cases/store.js'
import { EvidenceStore } from '../cases/evidence.js'
import { loadConfig } from '../config/index.js'
import { createConfiguredMcpFetch } from '../mcp/client.js'
import { generateVisualization } from '../viz/index.js'
import { PACKAGE_VERSION } from '../version.js'
import type { PlaybookDefinition } from './schema.js'

export interface RunnerOptions {
  caseId?:   string            // attach to existing case; omit for quick-case auto-creation
  from?:     number            // 1-based step to resume from (default: 1)
  dryRun?:   boolean           // print steps, no MCP calls
  params?:   Record<string, string>
}

/** Sleep for ms milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Check if an error is a timeout/abort error. */
function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return err.name === 'AbortError' || (err as NodeJS.ErrnoException).code === 'ECONNRESET'
}

/** Check if an error is a payment failure. */
function isPaymentError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  // Match HTTP 402 status more precisely, or x402-specific error signals
  return msg.includes('http 402') ||
         msg.includes('status 402') ||
         msg.includes('payment required') ||
         msg.includes('x402')
}

/**
 * Call an MCP tool with retry logic on timeout (up to 3 total attempts).
 * Returns the text result or throws on non-retryable error.
 */
async function callWithRetry(
  client: Client,
  toolName: string,
  params: Record<string, string>
): Promise<string> {
  const MAX_ATTEMPTS = 3
  let lastErr: unknown

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await client.callTool({ name: toolName, arguments: params })
      const content = result.content as Array<{ type: string; text?: string }>
      return content.filter(c => c.type === 'text').map(c => c.text ?? '').join('\n')
    } catch (err) {
      if (isTimeoutError(err) && attempt < MAX_ATTEMPTS) {
        lastErr = err
        await sleep(1000)
        continue
      }
      throw err
    }
  }

  throw lastErr
}

async function validateStepTools(client: Client, steps: PlaybookDefinition['steps']): Promise<void> {
  const result = await client.listTools()
  const available = new Set(result.tools.map(tool => tool.name))
  const missing = [...new Set(steps.map(step => step.tool).filter(tool => !available.has(tool)))]
  if (missing.length === 0) return

  const availableList = [...available].sort().join(', ') || 'none'
  throw new Error(
    `Unknown MCP tool(s) in playbook: ${missing.join(', ')}. ` +
    `Available tools: ${availableList}. Run \`chain-insights mcp tools --refresh\` to inspect the live MCP schema.`
  )
}

export const PlaybookRunner = {
  /**
   * Execute a playbook definition step-by-step against the live MCP.
   *
   * @param playbook - Parsed and validated PlaybookDefinition
   * @param opts     - Runner options (caseId, from, dryRun, params)
   */
  async run(playbook: PlaybookDefinition, opts: RunnerOptions): Promise<void> {
    const startIndex = (opts.from ?? 1) - 1  // convert 1-based to 0-based
    const stepsToRun = playbook.steps.slice(startIndex)
    const totalSteps = playbook.steps.length

    // --- DRY RUN ---
    if (opts.dryRun) {
      console.log(`Playbook: ${playbook.name} (dry run — no MCP calls)`)
      console.log(`Steps: ${totalSteps} total, starting from ${startIndex + 1}`)
      console.log('')
      for (const step of stepsToRun) {
        console.log(`Step ${step.index}/${totalSteps}: ${step.tool} (params: ${JSON.stringify(step.params)})`)
      }
      console.log('')
      console.log('Cost: unknown (MCP pricing not available without live connection)')
      return
    }

    // --- MCP AUTH CHECK (before case creation to avoid orphan cases) ---
    const config = await loadConfig()
    const mcpFetch = await createConfiguredMcpFetch(config)

    // --- CASE RESOLUTION ---
    let caseId: string
    if (opts.caseId) {
      const existingCase = await CaseStore.get(opts.caseId)
      caseId = existingCase.id
    } else {
      const newCase = await CaseStore.create({
        name: `quick-${playbook.name}-${Date.now()}`,
        tags: ['quick', 'playbook', playbook.name],
        description: `Auto-created for one-off playbook run: ${playbook.name}`,
      })
      caseId = newCase.id
      console.log(`Created quick case: ${caseId}`)
    }

    // --- MCP CONNECTION ---
    const client = new Client({ name: 'chain-insights-playbook', version: PACKAGE_VERSION })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(config.mcpEndpoint), { fetch: mcpFetch })
    )

    let evidenceCount = 0

    try {
      await validateStepTools(client, stepsToRun)

      // --- STEP LOOP ---
      for (const step of stepsToRun) {
        console.log(`Step ${step.index}/${totalSteps}: ${step.label}...`)

        let result: string
        try {
          result = await callWithRetry(client, step.tool, step.params)
        } catch (err) {
          if (isPaymentError(err)) {
            if (process.stdin.isTTY) {
              // Interactive: prompt user
              const { createInterface } = await import('node:readline')
              const rl = createInterface({ input: process.stdin, output: process.stdout })
              const answer = await new Promise<string>(resolve => {
                rl.question(`Payment required for step ${step.index}. (retry/skip/abort): `, resolve)
              })
              rl.close()

              if (answer.trim().toLowerCase() === 'retry') {
                result = await callWithRetry(client, step.tool, step.params)
              } else if (answer.trim().toLowerCase() === 'skip') {
                console.log(`Step ${step.index} skipped.`)
                continue
              } else {
                throw new Error(`Aborted at step ${step.index} due to payment failure.`)
              }
            } else {
              // Non-TTY: abort
              throw new Error(
                `Payment required for step ${step.index} but no interactive terminal available. ` +
                `Configure wallet with \`chain-insights wallet import <private-key>\`, then run \`chain-insights wallet ready\`. Aborting.`
              )
            }
          } else {
            // Non-payment, non-timeout MCP error — stop and report
            const completedSteps = step.index - 1 - startIndex
            const completedMsg = completedSteps > 0
              ? `Completed: steps ${startIndex + 1}..${step.index - 1}.`
              : 'No steps completed before failure.'
            console.error(
              `Step ${step.index} failed: ${(err as Error).message}. ` +
              `${completedMsg} Run with --from ${step.index} to resume.`
            )
            throw err
          }
        }

        // --- STORE EVIDENCE ---
        await EvidenceStore.append(caseId, {
          source: step.tool,
          content: result,
          queryParams: JSON.stringify(step.params),
        })
        evidenceCount++
        console.log(`  (${result.length} chars stored)`)
      }

      // --- AUTO-VIZ for trace-funds ---
      if (playbook.name === 'trace-funds') {
        try {
          const viz = await generateVisualization({ caseId })
          console.log(`Visualization generated: ${viz.htmlPath}`)
        } catch {
          console.log('No transaction data to visualize.')
        }
      }

      // --- FINAL SUMMARY ---
      console.log(`Playbook complete. Case: ${caseId}. Evidence: ${evidenceCount} entries.`)
    } finally {
      await client.close()
    }
  },
}
