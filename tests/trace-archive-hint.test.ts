import { describe, expect, it, vi } from 'vitest'
import { traceVictimFunds } from '../src/investigation/public-tools.js'

type BatchQuery = { id: string; query: string }

const config = { dataDir: '/tmp/ci-test', serverPort: 4321 }

// AC12: when a live_topology trace resolves the seed but finds zero flows, and
// archive_topology is enabled for the network, the response echoes the
// topology_scope used and includes a hint to retry with archive_topology.
function clientWithCapabilities(archiveEnabled: boolean) {
  return {
    callTool: vi.fn(async (req: { name: string; arguments: { queries?: BatchQuery[] } }) => {
      if (req.name === 'network_capabilities') {
        // Mirrors the real graphrag-mcp network_capabilities response shape:
        // facts.capabilities.networks[].layers.topology.archive.enabled.
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              schema: 'chain-insights.result.v1',
              tool: 'network_capabilities',
              facts: {
                capabilities: {
                  schema: 'chain-insights.network-capabilities.v1',
                  networks: [{ network: 'bittensor', layers: { topology: { archive: { enabled: archiveEnabled } } } }],
                },
              },
            }),
          }],
          isError: false,
        }
      }
      const queries = (req.arguments.queries ?? []).map((q) => (
        q.id.startsWith('seed_address_exists_')
          ? { id: q.id, ok: true, results: [{ address: q.query.match(/address:\s*"([^"]+)"/)?.[1] ?? '' }] }
          : { id: q.id, ok: true, results: [] }
      ))
      return { content: [{ type: 'text', text: JSON.stringify({ facts: { queries } }) }], isError: false }
    }),
  }
}

describe('AC12: topology_scope echo + archive-retry hint', () => {
  it('echoes topology_scope=live_topology (default) in structuredContent.input', async () => {
    const remote = clientWithCapabilities(false)
    const result = await traceVictimFunds(remote as never, config, {
      victimAddresses: '5Victim',
      network: 'bittensor',
      writeArtifacts: false,
    })
    const input = (result.structuredContent as { input: { topology_scope: string } }).input
    expect(input.topology_scope).toBe('live_topology')
  })

  it('echoes topology_scope=archive_topology when explicitly requested', async () => {
    const remote = clientWithCapabilities(false)
    const result = await traceVictimFunds(remote as never, config, {
      victimAddresses: '5Victim',
      network: 'bittensor',
      topologyScope: 'archive_topology',
      writeArtifacts: false,
    })
    const input = (result.structuredContent as { input: { topology_scope: string } }).input
    expect(input.topology_scope).toBe('archive_topology')
  })

  it('hints to retry with archive_topology when live finds nothing and archive is enabled', async () => {
    const remote = clientWithCapabilities(true)
    const result = await traceVictimFunds(remote as never, config, {
      victimAddresses: '5Victim',
      network: 'bittensor',
      writeArtifacts: false,
    })
    const warnings = (result.structuredContent as { warnings: string[] }).warnings
    expect(warnings.some((w) => w.includes('topology_scope=archive_topology'))).toBe(true)
  })

  it('does not hint when live finds nothing but archive is not enabled', async () => {
    const remote = clientWithCapabilities(false)
    const result = await traceVictimFunds(remote as never, config, {
      victimAddresses: '5Victim',
      network: 'bittensor',
      writeArtifacts: false,
    })
    const warnings = (result.structuredContent as { warnings: string[] }).warnings
    expect(warnings.some((w) => w.includes('archive_topology'))).toBe(false)
  })

  it('does not hint when already querying archive_topology', async () => {
    const remote = clientWithCapabilities(true)
    const result = await traceVictimFunds(remote as never, config, {
      victimAddresses: '5Victim',
      network: 'bittensor',
      topologyScope: 'archive_topology',
      writeArtifacts: false,
    })
    const warnings = (result.structuredContent as { warnings: string[] }).warnings
    expect(warnings.some((w) => w.includes('retry with topology_scope=archive_topology'))).toBe(false)
  })
})
