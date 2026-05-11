import { describe, it, expect } from 'vitest'
import { PlaybookParser } from '../src/playbooks/parser.js'

const VALID_PLAYBOOK = `---
name: trace-funds
description: Trace stolen funds across addresses
version: 1.0.0
---

## Step 1: Fetch transaction history

\`\`\`tool
blockchain_query
\`\`\`

\`\`\`params
address: {{address}}
limit: 100
\`\`\`

## Step 2: Risk check

\`\`\`tool
risk_score
\`\`\`

\`\`\`params
address: {{address}}
chain: ethereum
\`\`\`
`

describe('PlaybookParser', () => {
  it('parse() on valid 2-step markdown returns PlaybookDefinition with steps.length === 2', () => {
    const result = PlaybookParser.parse(VALID_PLAYBOOK, { address: '0xabc' })
    expect(result.steps).toHaveLength(2)
  })

  it('extracts step.tool from ```tool fenced block content', () => {
    const result = PlaybookParser.parse(VALID_PLAYBOOK, { address: '0xabc' })
    expect(result.steps[0]!.tool).toBe('blockchain_query')
    expect(result.steps[1]!.tool).toBe('risk_score')
  })

  it('extracts step.params as Record<string,string> from ```params fenced block', () => {
    const result = PlaybookParser.parse(VALID_PLAYBOOK, { address: '0xabc' })
    expect(result.steps[0]!.params).toEqual({ address: '0xabc', limit: '100' })
    expect(result.steps[1]!.params).toEqual({ address: '0xabc', chain: 'ethereum' })
  })

  it('applyTemplate replaces {{address}} with provided param value', () => {
    const result = PlaybookParser.parse(VALID_PLAYBOOK, { address: '0xdeadbeef' })
    expect(result.steps[0]!.params['address']).toBe('0xdeadbeef')
  })

  it('applyTemplate leaves {{missing}} untouched when param not provided', () => {
    const result = PlaybookParser.parse(VALID_PLAYBOOK, {})
    expect(result.steps[0]!.params['address']).toBe('{{address}}')
  })

  it('applies frontmatter default params before step template substitution', () => {
    const markdown = `---
name: defaults
params:
  - name: address
    type: string
    required: true
  - name: network
    type: string
    required: false
    default: bittensor
---

## Step 1: Risk

\`\`\`tool
address_risk
\`\`\`

\`\`\`params
address: {{address}}
network: {{network}}
\`\`\`
`

    const result = PlaybookParser.parse(markdown, { address: '0xabc' })

    expect(result.steps[0]!.params).toEqual({
      address: '0xabc',
      network: 'bittensor',
    })
  })

  it('parse() throws ZodError when a step has empty tool name', () => {
    const badPlaybook = `---
name: bad-playbook
---

## Step 1: Bad step

\`\`\`tool

\`\`\`

\`\`\`params
foo: bar
\`\`\`
`
    expect(() => PlaybookParser.parse(badPlaybook, {})).toThrow()
  })

  it('extracts playbook name from frontmatter', () => {
    const result = PlaybookParser.parse(VALID_PLAYBOOK, { address: '0xabc' })
    expect(result.name).toBe('trace-funds')
    expect(result.description).toBe('Trace stolen funds across addresses')
    expect(result.version).toBe('1.0.0')
  })

  it('assigns 1-based index to each step', () => {
    const result = PlaybookParser.parse(VALID_PLAYBOOK, { address: '0xabc' })
    expect(result.steps[0]!.index).toBe(1)
    expect(result.steps[1]!.index).toBe(2)
  })

  it('extracts step label from H2 section heading', () => {
    const result = PlaybookParser.parse(VALID_PLAYBOOK, { address: '0xabc' })
    expect(result.steps[0]!.label).toBe('Step 1: Fetch transaction history')
    expect(result.steps[1]!.label).toBe('Step 2: Risk check')
  })
})
