import { describe, it, expect } from 'vitest'
import { PlaybookParser } from '../src/playbooks/parser.js'
import {
  TRACE_FUNDS_PLAYBOOK,
  RISK_CHECK_PLAYBOOK,
  ENTITY_PROFILE_PLAYBOOK,
  BUILTIN_PLAYBOOKS,
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
})

describe('TRACE_FUNDS_PLAYBOOK', () => {
  it('parses to PlaybookDefinition with name=trace-funds', () => {
    const def = PlaybookParser.parse(TRACE_FUNDS_PLAYBOOK, { address: '0x1', hops: '2' })
    expect(def.name).toBe('trace-funds')
  })

  it('parses to definition with steps.length >= 2', () => {
    const def = PlaybookParser.parse(TRACE_FUNDS_PLAYBOOK, { address: '0x1', hops: '2' })
    expect(def.steps.length).toBeGreaterThanOrEqual(2)
  })

  it('has params spec with address (required)', () => {
    const def = PlaybookParser.parse(TRACE_FUNDS_PLAYBOOK, { address: '0x1', hops: '2' })
    const addressParam = def.params.find(p => p.name === 'address')
    expect(addressParam).toBeDefined()
    expect(addressParam?.required).toBe(true)
  })

  it('has params spec with hops (optional, default "2")', () => {
    const def = PlaybookParser.parse(TRACE_FUNDS_PLAYBOOK, { address: '0x1', hops: '2' })
    const hopsParam = def.params.find(p => p.name === 'hops')
    expect(hopsParam).toBeDefined()
    expect(hopsParam?.required).toBe(false)
    expect(hopsParam?.default).toBe('2')
  })
})

describe('RISK_CHECK_PLAYBOOK', () => {
  it('parses to PlaybookDefinition with name=risk-check', () => {
    const def = PlaybookParser.parse(RISK_CHECK_PLAYBOOK, { address: '0x1' })
    expect(def.name).toBe('risk-check')
  })

  it('parses to definition with steps.length >= 1', () => {
    const def = PlaybookParser.parse(RISK_CHECK_PLAYBOOK, { address: '0x1' })
    expect(def.steps.length).toBeGreaterThanOrEqual(1)
  })
})

describe('ENTITY_PROFILE_PLAYBOOK', () => {
  it('parses to PlaybookDefinition with name=entity-profile', () => {
    const def = PlaybookParser.parse(ENTITY_PROFILE_PLAYBOOK, { address: '0x1' })
    expect(def.name).toBe('entity-profile')
  })

  it('parses to definition with steps.length >= 1', () => {
    const def = PlaybookParser.parse(ENTITY_PROFILE_PLAYBOOK, { address: '0x1' })
    expect(def.steps.length).toBeGreaterThanOrEqual(1)
  })
})
