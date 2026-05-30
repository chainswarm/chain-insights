import { describe, it, expect } from 'vitest'
import { PlaybookParser } from '../src/playbooks/parser.js'
import {
  TRACE_FUNDS_PLAYBOOK,
  RISK_CHECK_PLAYBOOK,
  ENTITY_PROFILE_PLAYBOOK,
  BUILTIN_PLAYBOOKS,
  KNOWN_GRAPHRAG_PUBLIC_TOOLS,
  TRACE_SUSPECT_FUNDS_PLAYBOOK,
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

  it("contains key 'trace-suspect-funds'", () => {
    expect(BUILTIN_PLAYBOOKS).toHaveProperty('trace-suspect-funds')
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

describe('TRACE_SUSPECT_FUNDS_PLAYBOOK', () => {
  it('parses to PlaybookDefinition with name=trace-suspect-funds', () => {
    const def = PlaybookParser.parse(TRACE_SUSPECT_FUNDS_PLAYBOOK, { address: '0x1' })
    expect(def.name).toBe('trace-suspect-funds')
  })

  it('uses address_risk and trace_suspect_funds', () => {
    const def = PlaybookParser.parse(TRACE_SUSPECT_FUNDS_PLAYBOOK, { address: '0x1' })
    expect(def.steps.map(step => step.tool)).toEqual(['address_risk', 'trace_suspect_funds'])
  })

  it('maps suspect address by default', () => {
    const def = PlaybookParser.parse(TRACE_SUSPECT_FUNDS_PLAYBOOK, { address: '0x1' })
    expect(def.steps[1].params).toMatchObject({
      suspect_addresses: '0x1',
      network: 'bittensor',
    })
  })

  it('documents suspect trace semantics', () => {
    expect(TRACE_SUSPECT_FUNDS_PLAYBOOK).toContain('suspect_addresses')
    expect(TRACE_SUSPECT_FUNDS_PLAYBOOK).toContain('cashout topology')
    expect(TRACE_SUSPECT_FUNDS_PLAYBOOK).toContain('reviewable candidate labels')
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

  it('uses the real trace_victim_funds and address_risk tools', () => {
    const def = PlaybookParser.parse(TRACE_FUNDS_PLAYBOOK, { address: '0x1' })
    expect(def.steps.map(step => step.tool)).toEqual(['address_risk', 'trace_victim_funds'])
  })

  it('substitutes default network and maps address to victim_addresses', () => {
    const def = PlaybookParser.parse(TRACE_FUNDS_PLAYBOOK, { address: '0x1' })
    expect(def.steps[0].params).toMatchObject({ address: '0x1', network: 'bittensor' })
    expect(def.steps[1].params).toMatchObject({ victim_addresses: '0x1', network: 'bittensor' })
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
