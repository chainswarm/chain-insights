// Built-in playbook definitions tied to the current GraphRAG public MCP tools.
// Source of truth inspected in rbmk/repos/ml/graphrag/src/mcp_server/tools.

export const KNOWN_GRAPHRAG_PUBLIC_TOOLS = [
  'address_risk',
  'scam_topology',
  'track_funds',
  'graph_query',
  'graph_query_batch',
] as const

export const TRACE_FUNDS_PLAYBOOK = `---
name: trace-funds
description: Trace stolen funds from a victim address to exchange deposits using Chain Insights GraphRAG
version: 1.0.0
params:
  - name: address
    type: string
    required: true
  - name: network
    type: string
    required: false
    default: bittensor
---

## Step 1: Screen Victim Address

\`\`\`tool
address_risk
\`\`\`

\`\`\`params
address: {{address}}
network: {{network}}
\`\`\`

## Step 2: Trace Funds To Exchanges

\`\`\`tool
track_funds
\`\`\`

\`\`\`params
trusted_addresses: {{address}}
network: {{network}}
\`\`\`
`

export const RISK_CHECK_PLAYBOOK = `---
name: risk-check
description: Screen an address for Chain Insights risk, behavior, counterparties, exchange connections, and AML patterns
version: 1.0.0
params:
  - name: address
    type: string
    required: true
  - name: network
    type: string
    required: false
    default: bittensor
---

## Step 1: Address Risk

\`\`\`tool
address_risk
\`\`\`

\`\`\`params
address: {{address}}
network: {{network}}
\`\`\`
`

export const ENTITY_PROFILE_PLAYBOOK = `---
name: entity-profile
description: Build an entity profile from Chain Insights address identity, metrics, risk, counterparties, and labels
version: 1.0.0
params:
  - name: address
    type: string
    required: true
  - name: network
    type: string
    required: false
    default: bittensor
---

## Step 1: Entity Profile

\`\`\`tool
address_risk
\`\`\`

\`\`\`params
address: {{address}}
network: {{network}}
\`\`\`
`

export const SCAM_TOPOLOGY_PLAYBOOK = `---
name: scam-topology
description: Build laundering topology and label candidates from a known scam address
version: 1.0.0
params:
  - name: address
    type: string
    required: true
  - name: network
    type: string
    required: false
    default: bittensor
---

## Step 1: Screen Known Scam Address

\`\`\`tool
address_risk
\`\`\`

\`\`\`params
address: {{address}}
network: {{network}}
\`\`\`

## Step 2: Build Scam Topology

\`\`\`tool
scam_topology
\`\`\`

\`\`\`params
scammer_addresses: {{address}}
network: {{network}}
\`\`\`
`

export const BUILTIN_PLAYBOOKS: Record<string, string> = {
  'trace-funds':    TRACE_FUNDS_PLAYBOOK,
  'scam-topology':  SCAM_TOPOLOGY_PLAYBOOK,
  'risk-check':     RISK_CHECK_PLAYBOOK,
  'entity-profile': ENTITY_PROFILE_PLAYBOOK,
}
