// Built-in playbook definitions.
// Tool names must match what the Chain Insights MCP exposes.
// Run `chain-insights mcp tools` to verify available tools.

export const TRACE_FUNDS_PLAYBOOK = `---
name: trace-funds
description: Trace fund flows from a target address and generate a money flow visualization
version: 1.0.0
params:
  - name: address
    type: string
    required: true
---

## Step 1: Trace Fund Flows

\`\`\`tool
probe
\`\`\`

\`\`\`params
query: Trace all fund flows for address {{address}}. Show inbound and outbound transfers with amounts, counterparties, and timestamps.
\`\`\`

## Step 2: Visualize Money Flow

\`\`\`tool
probe
\`\`\`

\`\`\`params
query: Generate a money flow graph for address {{address}} showing the transaction relationships and fund movements identified in the previous trace.
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

## Step 1: Risk Assessment

\`\`\`tool
probe
\`\`\`

\`\`\`params
query: Assess the risk exposure for address {{address}}. Check for sanctions matches, known illicit entity associations, and suspicious activity patterns.
\`\`\`

## Step 2: Counterparty Risk

\`\`\`tool
probe
\`\`\`

\`\`\`params
query: Analyze the counterparties of address {{address}} for risk signals. Identify any high-risk entities, mixers, or flagged addresses in the transaction history.
\`\`\`
`

export const QUERY_PLAYBOOK = `---
name: query
description: Run a free-form investigation query against the Chain Insights MCP
version: 1.0.0
params:
  - name: question
    type: string
    required: true
---

## Step 1: Query

\`\`\`tool
probe
\`\`\`

\`\`\`params
query: {{question}}
\`\`\`
`

export const BUILTIN_PLAYBOOKS: Record<string, string> = {
  'trace-funds': TRACE_FUNDS_PLAYBOOK,
  'risk-check':  RISK_CHECK_PLAYBOOK,
  'query':       QUERY_PLAYBOOK,
}
