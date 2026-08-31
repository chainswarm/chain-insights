import { describe, expect, it, vi } from 'vitest'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

import {
  resolveAmlAddressRiskVersion,
  runAmlAddressRisk,
} from '../src/investigation/public-tools.js'

describe('AML address risk tool versions', () => {
  it('defaults to the latest version when no version is requested', () => {
    expect(resolveAmlAddressRiskVersion()).toBe('v1')
  })

  it('routes an explicit v1 request to v1', () => {
    expect(resolveAmlAddressRiskVersion('v1')).toBe('v1')
  })

  it('rejects unknown versions and lists supported versions', () => {
    expect(() => resolveAmlAddressRiskVersion('v2')).toThrow(
      'Unsupported aml_address_risk version "v2". Supported versions: v1.'
    )
  })

  it('records the routed version in the result envelope', async () => {
    const client = {
      callTool: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ facts: { queries: [{ id: 'address_profile', results: [] }] } }),
          },
        ],
      }),
    }

    const result = await runAmlAddressRisk(
      client as unknown as Client,
      { address: '0xabc', network: 'robinhood' },
      'v1'
    )

    expect(result.structuredContent.tool_version).toBe('v1')
  })
})
