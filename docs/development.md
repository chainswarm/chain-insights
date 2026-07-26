# Development

This document is for engineers changing Chain Insights.

## Install And Build

```bash
npm install
npm run build
node bin/cli.js --help
```

## The `dist/` Trap

`bin/cli.js` is a shim that dynamically imports `dist/`. It never reads `src/`.
And `dist/` is gitignored, does not auto-rebuild, and **`npm test` does not
rebuild it** — vitest runs against `src/`.

So a stale `dist/` passes the entire test suite and still ships broken
behavior to anyone using the CLI. There is no error to notice: the CLI runs
old compiled logic against current data and returns a plausible wrong answer.

After ANY change under `src/`, before exercising it through `cia` or
`bin/cli.js`:

```bash
npm run build
```

`npm run build` is more than compilation — it also copies template and asset
directories into `dist/`, so skipping it stales packaged assets as well as
logic.

## Concurrent Work

When more than one change is in flight, use a git worktree rather than
switching branches in a shared checkout:

```bash
git fetch origin
git worktree add ../chain-insights-<topic> -b <branch> origin/main
cd ../chain-insights-<topic>
npm ci
```

Each worktree gets its own `node_modules/` and its own `dist/`, so one branch's
build cannot leak into another's CLI run — which, given the `dist/` trap above,
is exactly the failure that is hardest to diagnose. Branch switching in place
also churns tracked files under another agent's or editor's feet.

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
