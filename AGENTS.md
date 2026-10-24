# Chain Insights Agent Guide

`AGENTS.md` is the one instruction file for every coding agent. Do not add a
`CLAUDE.md`.

Chain Insights is a public AML investigation CLI and MCP proxy for blockchain
risk screening and fund-flow tracing.

## Public Repository Rules

- Keep documentation product-facing and useful to external users.
- Use "Chain Insights Graph" for the graph and risk analysis layer.
- Do not include private repository names, local workspace paths, internal
  planning catalogs, private deployment details, or organization-only workflow
  names in tracked files.
- The first release returns investigation results through the CLI and MCP
  surfaces. Local workspace initialization, serving, and visualization are
  not public commands.

## Development

- Runtime: Node.js 22 or newer, TypeScript, npm.
- CLI entry points: `bin/cli.js` and `bin/mcp-proxy.cjs`.
- Source lives under `src/`; tests live under `tests/`; built output lives
  under `dist/`.
- `bin/cli.js` is a CJS shim that dynamically imports `dist/cli.mjs` — it
  never reads `src/` directly. `dist/` is gitignored and does not
  auto-rebuild, so after ANY `src/` change, run `npm run build` before
  testing via `cia`/`bin/cli.js` interactively, or you will silently run
  stale compiled behavior with no error (found live 2026-07-09: a stale
  `dist/cli.mjs` built before the address-grain revert's resolve-logic fix
  landed kept doing `:Identity`-based seed resolution against a graph with
  zero `:Identity` nodes — every trace failed as "unresolved" with no
  indication `dist/` itself was the problem, not the data). `npm test`
  does not rebuild `dist/` either — only `npm run build` does.
- Before finishing changes, run:
  - `npm run typecheck`
  - `npm run build`
  - `npm test`
  - `npm run release:check`

## Exchanges and brands

An exchange (DEX) reaches the skills through two pinned files.

- `tests/fixtures/dex-adapters.json` pins the adapters of the indexer
  registry file. Refresh it with
  `node scripts/pin-dex-adapters.mjs <registry.json> --write`.
- `tests/fixtures/dex-brands.json` is the brand registry pin. It is generated
  outside this repository and committed here.
- `node scripts/render-dex-brands.mjs` renders the brand memo between
  `<!-- brands:start -->` and `<!-- brands:end -->` in the
  `chain-insights-dex` and `chain-insights-virtuals` skills.
  `tests/dex-brands.test.ts` runs its `--check`.
- `tests/dex-coverage.test.ts` holds every adapter to three things: a brand
  row, a trail-type skill, and a name-only eval. The trail skills are
  `chain-insights-dex-gauge`, `-vault`, `-launchpad`, or plain in
  `chain-insights-dex`. The eval is `plugin/evals/dex-<brand>/case.yaml`. Its
  prompt names the brand and holds no `0x` address.
- A new brand of a known trail type is one brand row plus one eval. No skill
  edit.
- A hand-typed exchange address belongs only inside a rendered block.
- `plugin/skills/` must equal `skills/`. Run
  `node scripts/sync-plugin-skills.mjs`; `tests/plugin.test.ts` fails on drift.
- Every trail skill keeps one shared rule: a contract recipient (a router, a
  pool manager) is never the buyer.
- The live suites are `tests/dex-brands-live.integration.test.ts` and
  `tests/graph-recipes-live.integration.test.ts`. Run them per release with
  `vitest --project integration`, `CHAIN_INSIGHTS_LIVE_GRAPH_MCP_ENDPOINT` and
  `CHAIN_INSIGHTS_LIVE_GRAPH_MCP_TOKEN`. They never run in the push gate.

## Release Metadata

Every PR that changes tracked files must update:

- `package.json`
- `package-lock.json`
- `CHANGELOG.md`

## Public Documentation

- README and docs should start from user workflows: install, configure Chain
  Insights Graph access, and run AML tools.
- Local debugging docs may mention localhost endpoints and environment
  variables, but must avoid private filesystem paths and private repository
  topology.
- Planning catalogs belong outside this public repository and are ignored by
  git.
