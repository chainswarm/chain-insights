---
name: chain-insights-developer-experience
description: Use when changing Chain Insights README, docs, skills, CLI UX, AML tool contracts, or developer-facing workflows. Keeps Chain Insights product-first while preserving accurate Chain Insights Graph and investigation details.
---

# Chain Insights Developer Experience

Use this skill when improving Chain Insights as a product or developer-facing
framework.

## Product Frame

Chain Insights is an AML tool framework layered on top of Chain Insights Graph.
Chain Insights Graph provides generic graph-language access. Chain Insights provides
investigation workflows, AML recipes, workspace artifacts, entity notes, reports,
and graph visualizations.

Use "Chain Insights Graph" in product-facing docs. Only use lower-level implementation
names in debugging or contributor docs when the detail is necessary.

## Current AML Tools

- `aml_address_risk`: screen one address for risk, behavior, neighborhood context,
  and exchange exposure.
- `aml_trace_victim_funds`: trace victim/source funds forward to exchange deposit
  candidates.
- `aml_trace_deposit_sources`: trace backward from suspected deposit/cashout
  addresses to upstream sources and shared-source convergence.
- `aml_trace_suspect_funds`: trace suspected scammer, mule, operator, or
  laundering-ring addresses forward to cashout topology.

## Chain Insights Graph Layer

Chain Insights Graph exposes generic tools such as:

- `graph_query`
- `graph_query_batch`

Chain Insights tools should be implemented as local AML workflows over these
generic graph primitives unless there is a product reason to add a new
primitive.

For manual graph-language guidance, use the shipped `chain-insights-cypher`
skill. For Bittensor schema-specific queries, load
`chain-insights-bittensor-cypher` after the generic skill.

## Topology Language

Use these names consistently:

- `live_topology`: fast, cheaper, recent/hot topology.
- `archive_topology`: wider historical topology; slower and potentially more
  costly.
- `facts`: labels, features, risk scores, assets, and enrichment.

Tell users to discover current network capabilities before assuming data is
available:

```bash
cia mcp networks
cia mcp tools --refresh
```

## README Rules

README starts from the product experience:

1. What Chain Insights is.
2. What users can do today.
3. Fast setup and one working demo.
4. AML tools.
5. Chain Insights Graph and topology model.
6. Links to deeper docs.

Do not put debug-token setup, local bypasses, release gates, full test
matrices, or client-specific desktop setup in README. Link to focused docs.

## Adding AML Tools

Every new AML tool needs:

- User problem and intended analyst workflow.
- Required inputs and optional inputs.
- Chain Insights Graph primitives used.
- Topology/facts scope.
- Result contract.
- Workspace artifact and report behavior.
- Graph report behavior.
- Tests.
- Dogfood or UAT path.

## Dogfood from a clean workspace

Before claiming the developer experience is good, run from a clean directory
outside this repository:

```bash
mkdir -p /tmp/chain-insights-dx-dogfood
cd /tmp/chain-insights-dx-dogfood
cia --version
cia init .
cia mcp networks
cia mcp tools --refresh
```

Run at least one small investigation command, inspect generated files, and feed
the friction back into README, docs, CLI help, or follow-up issues.
