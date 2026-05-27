# Chain Insights Agent Guide

Chain Insights is a public AML investigation CLI and MCP proxy for blockchain
risk screening, fund-flow tracing, local case evidence, and graph reports.

## Public Repository Rules

- Keep documentation product-facing and useful to external users.
- Use "GraphRAG MCP" for the graph and risk analysis layer.
- Do not include private repository names, local workspace paths, internal
  planning catalogs, private deployment details, or organization-only workflow
  names in tracked files.
- Keep investigation output local to user workspaces such as `.chain-insights/`,
  `cases/`, `reports/`, and `artifacts/`.

## Development

- Runtime: Node.js 22 or newer, TypeScript, npm.
- CLI entry points: `bin/cli.js` and `bin/mcp-proxy.cjs`.
- Source lives under `src/`; tests live under `tests/`; built output lives
  under `dist/`.
- Before finishing changes, run:
  - `npm run typecheck`
  - `npm run build`
  - `npm test`
  - `npm run release:check`

## Release Metadata

Every PR that changes tracked files must update:

- `package.json`
- `package-lock.json`
- `CHANGELOG.md`

## Public Documentation

- README and docs should start from user workflows: install, initialize,
  configure GraphRAG MCP access, run AML tools, and review evidence.
- Local debugging docs may mention localhost endpoints and environment
  variables, but must avoid private filesystem paths and private repository
  topology.
- Planning catalogs belong outside this public repository and are ignored by
  git.
