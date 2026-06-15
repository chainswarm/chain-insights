# Development

This document is for engineers changing Chain Insights.

## Install And Build

```bash
npm install
npm run build
node bin/cli.js --help
```

## Tests

Run the full local gate:

```bash
npm run typecheck
npm test
npm run build
npm run release:check
git diff --check
```

Focused docs and workspace tests:

```bash
npm test -- tests/skills-contract.test.ts tests/cli.test.ts
```

## Bittensor Devkit

The devkit runs a local Chain Insights Graph backend with deterministic Bittensor
fixture data. Use it when changing graph workflows, AML recipes, MCP proxy
behavior, or developer documentation that depends on a working local backend.

Start from a clean state:

```bash
docker compose -f devkit/docker-compose.yml down -v --remove-orphans
docker compose -f devkit/docker-compose.yml up -d --build
```

Run the devkit smoke checks:

```bash
npm run devkit:smoke
npm run devkit:smoke:parity
```

For manual CLI work, point Chain Insights at the devkit endpoint:

```bash
export CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT=http://127.0.0.1:18012/mcp
```

## Global Install From Checkout

```bash
npm run build
npm install -g .
cia --version
```

## More Developer Docs

- Contributor workflow: `docs/contributing.md`
- Debugging and UAT: `docs/debugging.md`
- Bittensor devkit: `devkit/README.md`
- Graph tool contracts: `docs/graph-tools.md`
- Investigation workspace layout: `docs/investigation-workspaces.md`
