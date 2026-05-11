import { describe, it, expect } from 'vitest'
import { PlaybookParser } from '../src/playbooks/parser.js'
import {
  TRACE_FUNDS_PLAYBOOK,
  RISK_CHECK_PLAYBOOK,
  ENTITY_PROFILE_PLAYBOOK,
  BUILTIN_PLAYBOOKS,
  KNOWN_GRAPHRAG_PUBLIC_TOOLS,
} from '../src/playbooks/builtins.js'

describe('BUILTIN_PLAYBOOKS map', () => {
  it("contains key 'trace-funds'", () => {
    expect(BUILTIN_PLAYBOOKS).toHaveProperty('trace-funds')
  })

  it("contains key 'risk-check'", () => {
    expect(BUILTIN_PLAYBOOKS).toHaveProperty('risk-check')
  })

  it("contains key 'entity-profile'", () => {
    expect(BUILTIN_PLAYBOOKS).toHaveProperty('entity-profile')
  })

  it('does not ship the obsolete free-form probe playbook', () => {
    expect(BUILTIN_PLAYBOOKS).not.toHaveProperty('query')
    for (const markdown of Object.values(BUILTIN_PLAYBOOKS)) {
      const def = PlaybookParser.parse(markdown, { address: '0x1' })
      expect(def.steps.map(step => step.tool)).not.toContain('probe')
    }
  })

  it('uses only known GraphRAG public MCP tools', () => {
    for (const markdown of Object.values(BUILTIN_PLAYBOOKS)) {
      const def = PlaybookParser.parse(markdown, { address: '0x1' })
      for (const step of def.steps) {
        expect(KNOWN_GRAPHRAG_PUBLIC_TOOLS).toContain(step.tool)
      }
    }
  })
})

describe('TRACE_FUNDS_PLAYBOOK', () => {
  it('parses to PlaybookDefinition with name=trace-funds', () => {
    const def = PlaybookParser.parse(TRACE_FUNDS_PLAYBOOK, { address: '0x1' })
    expect(def.name).toBe('trace-funds')
  })

  it('parses to definition with 2 steps', () => {
    const def = PlaybookParser.parse(TRACE_FUNDS_PLAYBOOK, { address: '0x1' })
    expect(def.steps.length).toBe(2)
  })

  it('has params spec with address (required)', () => {
    const def = PlaybookParser.parse(TRACE_FUNDS_PLAYBOOK, { address: '0x1' })
    const addressParam = def.params.find(p => p.name === 'address')
    expect(addressParam).toBeDefined()
    expect(addressParam?.required).toBe(true)
  })

  it('uses the real track_funds and address_risk tools', () => {
    const def = PlaybookParser.parse(TRACE_FUNDS_PLAYBOOK, { address: '0x1' })
    expect(def.steps.map(step => step.tool)).toEqual(['address_risk', 'track_funds'])
  })

  it('substitutes default network and maps address to trusted_addresses', () => {
    const def = PlaybookParser.parse(TRACE_FUNDS_PLAYBOOK, { address: '0x1' })
    expect(def.steps[0].params).toMatchObject({ address: '0x1', network: 'bittensor' })
    expect(def.steps[1].params).toMatchObject({ trusted_addresses: '0x1', network: 'bittensor' })
  })
})

describe('RISK_CHECK_PLAYBOOK', () => {
  it('parses to PlaybookDefinition with name=risk-check', () => {
    const def = PlaybookParser.parse(RISK_CHECK_PLAYBOOK, { address: '0x1' })
    expect(def.name).toBe('risk-check')
  })

  it('parses to definition with 1 step', () => {
    const def = PlaybookParser.parse(RISK_CHECK_PLAYBOOK, { address: '0x1' })
    expect(def.steps.length).toBe(1)
  })

  it('uses address_risk with default network', () => {
    const def = PlaybookParser.parse(RISK_CHECK_PLAYBOOK, { address: '0x1' })
    expect(def.steps[0].tool).toBe('address_risk')
    expect(def.steps[0].params).toMatchObject({ address: '0x1', network: 'bittensor' })
  })
})

describe('ENTITY_PROFILE_PLAYBOOK', () => {
  it('parses to PlaybookDefinition with name=entity-profile', () => {
    const def = PlaybookParser.parse(ENTITY_PROFILE_PLAYBOOK, { address: '0x1' })
    expect(def.name).toBe('entity-profile')
  })

  it('parses to definition with 1 step', () => {
    const def = PlaybookParser.parse(ENTITY_PROFILE_PLAYBOOK, { address: '0x1' })
    expect(def.steps.length).toBe(1)
  })

  it('uses address_risk with default network', () => {
    const def = PlaybookParser.parse(ENTITY_PROFILE_PLAYBOOK, { address: '0x1' })
    expect(def.steps[0].tool).toBe('address_risk')
    expect(def.steps[0].params).toMatchObject({ address: '0x1', network: 'bittensor' })
  })
})
