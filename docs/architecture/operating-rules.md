# Operating Rules

Repo-level invariants and operating rules. Migrated from the retired repo
knowledge skill during the 2026-07-28 docs-layer rework.

## Repository Invariants

- `AGENTS.md` and `CLAUDE.md` are twin files kept byte-identical. Edit both
  together, or neither.
- Every PR that changes tracked files must bump `package.json`,
  `package-lock.json`, and `CHANGELOG.md`. Enforced by
  `npm run release:check` (`scripts/check-release-gate.mjs`) in
  `verify.yml` on pull requests.
- This is a **public** repo. No private repository names, local workspace
  paths, internal planning catalogs, private deployment details, or
  org-only workflow names in tracked files. Use the name
  "Chain Insights Graph" for the graph layer.
- Public workflow network support is one network: robinhood. The wallet
  pays on Base mainnet as the payment chain only — not a graph-support
  claim.
- Node 22 or newer is required (`package.json` engines). CI installs with
  `npm ci --ignore-scripts`.

## Data And Findings Invariants

- Address labels are served by the Chain Insights Graph backend, never
  written by this CLI. `aml_address_risk` reads them as enrichment; monitor
  case dossiers are document-derived and never claim a label verdict.
- The devkit exposes graph primitives only — never `aml_*`, wallet, x402,
  payment, quota, ACP, or telemetry tools. See
  [data-contracts.md](data-contracts.md#devkit-contract).
- The production Chain Insights Graph assembly is not used by the devkit.
  `devkit/chain-insights-graph-devkit` is a separate lite Go backend built
  entirely from this repository.

## Development Workflow Rules

- `npm run build` is not plain compilation. It also copies
  `src/viz/templates` to `dist/templates` and wallet MCP-proxy assets to
  `dist/assets`. Skipping it stales the packaged UI assets. See the
  `dist/` trap in [../development.md](../development.md).
- `package.json` `files[]` ships `bin`, `dist`, `skills`, `docs/*.md`, and
  `docs/images`. Adding a skill or doc changes the published tarball.
  `verify.yml` runs `npm pack` and lists contents.
- npm overrides pin `ws` to 8.21.0 (`package.json`).

## CI Gotchas

- `verify.yml` deliberately runs `ubuntu-latest` for pull requests and
  `chainswarm-runner` for push/dispatch (a runs-on ternary). PR CI does not
  exercise the self-hosted fleet.
- Repo CI has a release gate blocking non-release PRs and a secret scan
  flagging `0x{64}` hex. Avoid committing 64-hex strings.
- UATs expecting unprefixed tool names (`address_risk`, `trace_funds`, …)
  are stale. Those names are deliberately hidden, and
  `assertPublicMcpToolName()` throws with a suggested `aml_*` / `meta_*`
  replacement.
- Backend big-query memory limits can surface as generic timeout-like
  errors on archive queries. Do not diagnose these as proxy bugs.

## Method Ownership (Reference, Do Not Restate)

- Inspector / ACP surface audits (tools/list, prompts/list, prefixed-name
  sync): internal maintainer tooling, not part of this package.
- ACP release method: internal maintainer tooling.
- Real local UAT against the GraphRAG MCP: internal maintainer tooling.
- npm release testing: internal maintainer tooling.
- Graph serving tiers and sync detail: internal system knowledge, not this
  repo.

## Documentation Rules

- Keep docs product-first and user-workflow-first: install → init →
  configure graph access → run AML tools → review evidence.
- Localhost endpoints are fine in debugging docs. Private paths are not.
- The shipped product skills under `skills/` (`chain-insights-*`,
  `ci-status`, `test-chain-insights-graph`) are a separate product surface
  packaged into the npm tarball and enforced by
  `tests/skills-contract.test.ts`. A capability no skill mentions is
  invisible to agents — keep the relevant skill in step with any change.
  `docs/monitoring.md` is the human surface for the monitor;
  `skills/chain-insights-monitoring/` is the agent one. Keep both in step.
