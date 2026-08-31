import { describe, expect, it } from 'vitest'
import { CIA_WORKFLOWS, formatCiaWorkflows } from '../src/investigation/workflows.js'

describe('CIA workflow catalog', () => {
  it('lists the AML address-risk workflow with its canonical command', () => {
    expect(CIA_WORKFLOWS).toContainEqual(
      expect.objectContaining({
        name: 'aml-address-risk',
        tool: 'aml_address_risk',
        network: 'robinhood',
        command: 'cia workflow aml-address-risk',
      })
    )
  })

  it('formats an actionable workflow table', () => {
    const output = formatCiaWorkflows(CIA_WORKFLOWS)

    expect(output).toContain('CIA workflow tools')
    expect(output).toContain('aml-address-risk')
    expect(output).toContain('robinhood')
    expect(output).toContain('cia workflow aml-address-risk')
  })

  it('reports an empty catalog clearly', () => {
    expect(formatCiaWorkflows([])).toBe('No CIA workflow tools available.')
  })
})
