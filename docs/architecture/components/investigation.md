Worker: investigation
Entrypoint: src/investigation
Package: investigation
Language: typescript
Tests: tests/investigation-workflows.test.ts, tests/truth-proposal.test.ts

# investigation

## Purpose

Holds the workflow catalogue (`workflows.ts`) and the truth proposal payload
(`truth-proposal.ts`). The catalogue names each CIA workflow, the tool it
runs and its command. The screening itself is done by the proxy's local
tools: `aml_address_risk` (`src/mcp/address-risk.ts`) for one address and
`aml_token_risk` (`src/mcp/token-risk.ts`) for a token or a pool. The CLI runs
the same tools for `cia workflow aml-address-risk` and
`cia workflow aml-token-risk`.

## Reads

- **Workflow catalogue:** static entries, no graph read
- **Truth proposal:** the investigator config and the findings it is given

## Flow

```text
cia workflow aml-address-risk | aml-token-risk
  -> CIA_WORKFLOWS entry (workflows.ts)
  -> the proxy's local tool, with the CLI's own graph session
  -> facts and measures, as JSON
```

## Invariants

- Addresses remain full raw chain-native values.
- The public investigation network is `robinhood`.
- Stateless calls do not write local investigation files.

## Run

No public command runs this module directly. `cia workflow` lists the
catalogue and runs each entry's tool.
