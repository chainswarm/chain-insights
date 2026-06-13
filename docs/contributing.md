# Contributing To Chain Insights

Chain Insights is an AML investigation framework layered on top of GraphRAG
MCP. Contributions should keep the product easy to try while preserving precise
tool contracts for agents and analysts.

## Local Setup

```bash
npm install
npm run build
node bin/cli.js --help
```

## Adding AML Tools

Current AML tools live in the Chain Insights layer:

- `aml_address_risk`
- `aml_trace_victim_funds`
- `aml_trace_deposit_sources`
- `aml_trace_suspect_funds`

When adding a tool, document:

- User problem.
- Required and optional inputs.
- GraphRAG MCP primitive calls.
- Use of `live_topology`, `archive_topology`, and `facts`.
- Result contract.
- Workspace artifact and report behavior.
- Graph report behavior.
- Tests and dogfood path.

## Documentation Updates

- README stays product-first.
- Detailed graph contracts belong in `docs/graph-tools.md`.
- Workspace behavior belongs in `docs/investigation-workspaces.md`.
- MCP proxy/client setup belongs in `docs/mcp-proxy.md`.
- Debug and UAT details belong in `docs/debugging.md`.
- Agent-facing contributor guidance belongs in shipped skills under `skills/`.

## Tests

Run focused tests while developing:

```bash
npm test -- tests/skills-contract.test.ts
npm test -- tests/cli.test.ts
```

Run the full local gate before a PR:

```bash
npm run typecheck
npm test
npm run build
npm run release:check
git diff --check
```

## Release Discipline

Every PR to `main` must:

- Bump `package.json` and `package-lock.json`.
- Add a matching `CHANGELOG.md` entry.
- Pass the GitHub verification checks.
