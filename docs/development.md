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

## Global Install From Checkout

```bash
npm run build
npm install -g .
cia --version
```

## More Developer Docs

- Contributor workflow: `docs/contributing.md`
- Debugging and UAT: `docs/debugging.md`
- Graph tool contracts: `docs/graph-tools.md`
- Investigation workspace layout: `docs/investigation-workspaces.md`
