// NOTE: MCP tool names in these playbooks are placeholders.
// Verify actual tool names with: chain-insights mcp tools
// Then update tool: lines in each playbook definition accordingly.

export const TRACE_FUNDS_PLAYBOOK = `---
name: trace-funds
description: Trace fund flows from a target address — follows hops and auto-generates a money flow visualization
version: 1.0.0
params:
  - name: address
    type: string
    required: true
  - name: hops
    type: number
    required: false
    default: "2"
---

## Step 1: Trace Funds

\`\`\`tool
trace_funds
\`\`\`

\`\`\`params
address: {{address}}
hops: {{hops}}
\`\`\`

## Step 2: Get Transaction Graph

\`\`\`tool
get_transaction_graph
\`\`\`

\`\`\`params
root: {{address}}
depth: {{hops}}
\`\`\`
`

export const RISK_CHECK_PLAYBOOK = `---
name: risk-check
description: Check risk exposure and sanctions screening for an address
version: 1.0.0
params:
  - name: address
    type: string
    required: true
---

## Step 1: Check Risk Exposure

\`\`\`tool
check_risk_exposure
\`\`\`

\`\`\`params
address: {{address}}
\`\`\`

## Step 2: Get Entity Details

\`\`\`tool
get_entity_details
\`\`\`

\`\`\`params
address: {{address}}
\`\`\`
`

export const ENTITY_PROFILE_PLAYBOOK = `---
name: entity-profile
description: Build a comprehensive entity profile — transaction history, counterparties, and risk signals
version: 1.0.0
params:
  - name: address
    type: string
    required: true
---

## Step 1: Get Transaction History

\`\`\`tool
get_transaction_history
\`\`\`

\`\`\`params
address: {{address}}
\`\`\`

## Step 2: Get Counterparties

\`\`\`tool
get_counterparties
\`\`\`

\`\`\`params
address: {{address}}
\`\`\`

## Step 3: Check Risk Signals

\`\`\`tool
check_risk_exposure
\`\`\`

\`\`\`params
address: {{address}}
\`\`\`
`

export const BUILTIN_PLAYBOOKS: Record<string, string> = {
  'trace-funds':    TRACE_FUNDS_PLAYBOOK,
  'risk-check':     RISK_CHECK_PLAYBOOK,
  'entity-profile': ENTITY_PROFILE_PLAYBOOK,
}
