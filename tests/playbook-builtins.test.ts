import { describe, it, expect } from 'vitest'
import { PlaybookParser } from '../src/playbooks/parser.js'
import {
  TRACE_FUNDS_PLAYBOOK,
  RISK_CHECK_PLAYBOOK,
  QUERY_PLAYBOOK,
  BUILTIN_PLAYBOOKS,
} from '../src/playbooks/builtins.js'

describe('BUILTIN_PLAYBOOKS map', () => {
  it("contains key 'trace-funds'", () => {
    expect(BUILTIN_PLAYBOOKS).toHaveProperty('trace-funds')
  })

  it("contains key 'risk-check'", () => {
    expect(BUILTIN_PLAYBOOKS).toHaveProperty('risk-check')
  })

  it("contains key 'query'", () => {
    expect(BUILTIN_PLAYBOOKS).toHaveProperty('query')
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

  it('uses probe tool for all steps', () => {
    const def = PlaybookParser.parse(TRACE_FUNDS_PLAYBOOK, { address: '0x1' })
    for (const step of def.steps) {
      expect(step.tool).toBe('probe')
    }
  })
})

describe('RISK_CHECK_PLAYBOOK', () => {
  it('parses to PlaybookDefinition with name=risk-check', () => {
    const def = PlaybookParser.parse(RISK_CHECK_PLAYBOOK, { address: '0x1' })
    expect(def.name).toBe('risk-check')
  })

  it('parses to definition with 2 steps', () => {
    const def = PlaybookParser.parse(RISK_CHECK_PLAYBOOK, { address: '0x1' })
    expect(def.steps.length).toBe(2)
  })
})

describe('QUERY_PLAYBOOK', () => {
  it('parses to PlaybookDefinition with name=query', () => {
    const def = PlaybookParser.parse(QUERY_PLAYBOOK, { question: 'test query' })
    expect(def.name).toBe('query')
  })

  it('parses to definition with 1 step', () => {
    const def = PlaybookParser.parse(QUERY_PLAYBOOK, { question: 'test query' })
    expect(def.steps.length).toBe(1)
  })

  it('substitutes question param into query', () => {
    const def = PlaybookParser.parse(QUERY_PLAYBOOK, { question: 'What is the risk for 0xabc?' })
    expect(def.steps[0].params['query']).toContain('What is the risk for 0xabc?')
  })
})
