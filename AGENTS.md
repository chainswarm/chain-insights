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

## Exchanges

An exchange (DEX) reaches every host through one served file and one tool.

- `registry/robinhood.md` is the reviewed exchange registry: one row per
  exchange and role, with a source link and a chain check. The review rule is
  in `registry/README.md`. The key column is `dex`; the prose word is
  "exchange".
- `registry/robinhood.json` is its served copy. Regenerate it with
  `node scripts/pin-dex-registry.mjs registry/robinhood.md`. CI runs
  `node scripts/pin-dex-registry.mjs --check registry/robinhood.md` on every
  pull request, and `tests/dex-registry.test.ts` runs it too. Bump
  `Registry version:` in every row change.
- The proxy tool `meta_dex_lookup` (`src/mcp/dex-tool.ts`) reads the served
  copy from `main` over `raw.githubusercontent.com`, cached one hour, with the
  packaged copy as the offline fallback. A row merged on `main` reaches every
  running proxy within the hour, with no release.
- `tests/fixtures/dex-adapters.json` pins the adapters of the indexer
  registry file. Refresh it with
  `node scripts/pin-dex-adapters.mjs <registry.json> --write`.
- `node scripts/render-dex-registry.mjs` renders the exchange memo between
  `<!-- dex-registry:start -->` and `<!-- dex-registry:end -->` in the
  `chain-insights-dex` and `chain-insights-virtuals` skills. The memo is for a
  host with no `meta_dex_lookup` tool. `tests/dex-registry.test.ts` runs its
  `--check`.
- `tests/dex-coverage.test.ts` holds every adapter to three things: an
  exchange row, a trail-type skill, and a name-only eval. The trail skills are
  `chain-insights-dex-gauge`, `-vault`, `-launchpad`, or plain in
  `chain-insights-dex`. The eval is `plugin/evals/dex-<dex>/case.yaml`. Its
  prompt names the exchange and holds no `0x` address.
- An adapter of discovery kind `launch` (`v4-launch-factory-v1`) is a generic
  rule with no exchange and no registry row, on purpose. It is covered when
  the launchpad trail skill names its id and a `plugin/evals/dex-*` case
  names it too.
- A new exchange of a known trail type is one registry row plus one eval. No
  skill edit.
- A hand-typed exchange address belongs only inside a rendered block.
- `plugin/skills/` must equal `skills/`. Run
  `node scripts/sync-plugin-skills.mjs`; `tests/plugin.test.ts` fails on drift.
- Every trail skill keeps one shared rule: a contract recipient (a router, a
  pool manager) is never the buyer.
- The live suites are `tests/dex-registry-live.integration.test.ts` and
  `tests/graph-recipes-live.integration.test.ts`. Run them per release with
  `vitest --project integration`, `CHAIN_INSIGHTS_LIVE_GRAPH_MCP_ENDPOINT` and
  `CHAIN_INSIGHTS_LIVE_GRAPH_MCP_TOKEN`. They never run in the push gate.

## Host parity

A rule a host never loads does not exist for that host. Claude Desktop chat
and claude.ai load no skill file, ignore the server instructions and never
call `meta_rules`. They read only tool descriptions and result hints.

- Every protocol skill, `skills/chain-insights-<protocol>/SKILL.md`, names a
  tool door in its frontmatter: `door: meta_dex_lookup` for the exchange and
  Virtuals skills.
- The door is a local tool of the proxy, listed in `LOCAL_TOOL_NAMES` of
  `src/mcp/proxy.ts`. Its description carries the rule the skill opens with
  and names the skill's trigger words.
- The skill names the door as its first step.
- `tests/host-parity.test.ts` fails on a skill with no door, a door that is
  not a local tool, or a door whose description misses the skill's trigger
  words. The core skill `chain-insights-cypher` is exempt: its door is
  `meta_rules` plus the `graph_query` description.
- A new door is proven in Claude Desktop normal chat with a name-only
  question before its release is called done.
- The host matrix is in `docs/mcp-proxy.md`, section "Host parity".

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
