export interface CiaWorkflow {
  name: string
  tool: string
  network: string
  description: string
  command: string
}

export const CIA_WORKFLOWS: readonly CiaWorkflow[] = [
  {
    name: 'aml-address-risk',
    tool: 'aml_address_risk',
    network: 'robinhood',
    description: 'Screen one address for AML risk, behavior, and exchange exposure.',
    command: 'cia workflow aml-address-risk',
  },
  {
    name: 'aml-token-risk',
    tool: 'aml_token_risk',
    network: 'robinhood',
    description: 'Screen one token or pool: its founder, factory, gas wallets and pools, each with its own risk word.',
    command: 'cia workflow aml-token-risk',
  },
]

const NAME_WIDTH = 22
const NETWORK_WIDTH = 12
const COMMAND_WIDTH = 34

function formatRow(values: string[]): string {
  return [
    values[0]?.padEnd(NAME_WIDTH),
    values[1]?.padEnd(NETWORK_WIDTH),
    values[2]?.padEnd(COMMAND_WIDTH),
  ].join('  ')
}

export function formatCiaWorkflows(workflows: readonly CiaWorkflow[]): string {
  if (workflows.length === 0) return 'No CIA workflow tools available.'

  const rows = workflows.flatMap((workflow) => [
    formatRow([workflow.name, workflow.network, workflow.command]),
    `  ${workflow.description}`,
  ])

  return [
    'CIA workflow tools',
    '',
    formatRow(['Workflow', 'Network', 'Run with']),
    formatRow(['-'.repeat(NAME_WIDTH), '-'.repeat(NETWORK_WIDTH), '-'.repeat(COMMAND_WIDTH)]),
    ...rows,
  ].join('\n')
}
