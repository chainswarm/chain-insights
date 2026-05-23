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
description: Build laundering topology and scam labels from a victim incident
version: 1.0.0
params:
  - name: address
    type: string
    required: true
  - name: incident_timestamp_ms
    type: string
    required: true
  - name: network
    type: string
    required: false
    default: bittensor
  - name: activity_policy
    type: string
    required: false
    default: node_relative_only
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

The victim-only traversal is outward from victim/source funds. The
primary traversal is a node-relative novelty wave: each new node expands only
once, repeated targets remain as non-expanding convergence context, and
downstream edges must be active at or after the current node's wave-arrival
timestamp. Set activity_policy to global_incident_only to filter every wave
against incident_timestamp_ms instead. Exchange terminal safety stops exchange
endpoints, and label candidates are reviewable, not automatic writes.
Contract summary: victim-only traversal is outward from victim/source funds;
node-relative novelty wave by default; global_incident_only is available;
exchange terminal safety; scam_labels are ML-ready flags.

\`\`\`tool
scam_topology
\`\`\`

\`\`\`params
victim_address: {{address}}
incident_timestamp_ms: {{incident_timestamp_ms}}
network: {{network}}
activity_policy: {{activity_policy}}
\`\`\`
`

export const BUILTIN_PLAYBOOKS: Record<string, string> = {
  'trace-funds':    TRACE_FUNDS_PLAYBOOK,
  'scam-topology':  SCAM_TOPOLOGY_PLAYBOOK,
  'risk-check':     RISK_CHECK_PLAYBOOK,
  'entity-profile': ENTITY_PROFILE_PLAYBOOK,
}
