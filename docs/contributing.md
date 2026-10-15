# Contributing To Chain Insights

Chain Insights is an AML investigation framework layered on top of Chain Insights Graph
MCP. Contributions should keep the product easy to try while preserving precise
tool contracts for agents and analysts.

## Local Setup

```bash
npm install
npm run build
node bin/cli.js --help
```

## Adding AML Tools

No AML tool lives in the Chain Insights layer today. `aml_address_risk` is
hidden until its verdict is fixed.

When adding a tool, document:

- User problem.
- Required and optional inputs.
- Chain Insights Graph primitive calls.
- Use of `topology` and `facts`.
- Result contract.
- Tests and dogfood path.

## Documentation Updates

- README stays product-first.
- Detailed graph contracts belong in `docs/graph-tools.md`.
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

## Repository rules
### Repository Invariants

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

### Data And Findings Invariants

- Address labels are served by the Chain Insights Graph backend, never
  written by this CLI.

### Development Workflow Rules

- `npm run build` is not plain compilation. It also copies wallet MCP-proxy
  assets to `dist/assets`. Skipping it stales the packaged assets. See the
  `dist/` trap in [development.md](development.md).
- `package.json` `files[]` ships `bin`, `dist`, `skills` and `docs/*.md`.
  Adding a skill or doc changes the published tarball.
  `verify.yml` runs `npm pack` and lists contents.
- npm overrides pin `ws` to 8.21.0 (`package.json`).

### CI Gotchas

- `verify.yml` runs on every pull request and every push to `main`, on the
  self-hosted `chainswarm-runner` runners. Its three tiers are the files
  under `ci/` (`t1.sh`, `lint.sh`, `build.sh`), so `bash ci/t1.sh` runs the
  same gate locally.
- Repo CI has a release gate blocking non-release PRs and a secret scan
  flagging `0x{64}` hex. Avoid committing 64-hex strings.
- UATs expecting unprefixed tool names (`address_risk`, `trace_funds`, …)
  are stale. Those names are deliberately hidden, and
  `assertPublicMcpToolName()` throws with a suggested `aml_*` / `meta_*`
  replacement.
- Backend big-query memory limits can surface as generic timeout-like
  errors on archive queries. Do not diagnose these as proxy bugs.

### Method Ownership (Reference, Do Not Restate)

- Inspector / ACP surface audits (tools/list, prompts/list, prefixed-name
  sync): internal maintainer tooling, not part of this package.
- ACP release method: internal maintainer tooling.
- Real local UAT against the GraphRAG MCP: internal maintainer tooling.
- npm release testing: internal maintainer tooling.
- Graph serving tiers and sync detail: internal system knowledge, not this
  repo.

### Documentation Rules

- Keep docs product-first and user-workflow-first: install → configure graph
  access → run AML tools.
- Localhost endpoints are fine in debugging docs. Private paths are not.
- The shipped product skill under `skills/` is `chain-insights-cypher`.
  It is a separate product surface
  packaged into the npm tarball and enforced by
  `tests/skills-contract.test.ts`. A capability no skill mentions is
  invisible to agents — keep the skill in step with any change.

## Release Discipline

Every PR to `main` must:

- Bump `package.json` and `package-lock.json`.
- Add a matching `CHANGELOG.md` entry.
- Pass the GitHub verification checks.
