# NPM Package
Published package containing CLI, proxy, docs, and installer assets.
**Technology:** npm

## Purpose
Distributes Chain Insights as a public npm package for global installation (`npm install -g chain-insights`) or local development. Packages TypeScript build outputs (dist/), entry points (bin/cli.js, bin/mcp-proxy.cjs), documentation (docs/*.md, docs/images/), and agent skill definitions (skills/). Enables versioned releases and semver governance.

## Components
- **Package Metadata:** package.json (name, version, engines, bin, files, dependencies, scripts)
- **Build Artifacts:** dist/cli.mjs, dist/index.cjs, dist/index.mjs, dist/templates/, dist/assets/
- **Entry Points:** bin/cli.js (cia CLI), bin/mcp-proxy.cjs (stdio proxy for agents)
- **Documentation:** README.md, docs/*.md, docs/images/ (product-facing docs, architecture, investigation workflows)
- **Skills:** skills/ (agent skill-pack definitions for Claude Code, Codex, ChatGPT)

## Data Flow
-> ciaCli: Packages CLI entrypoint from dist/cli.mjs
-> mcpProxy: Packages proxy entrypoint from bin/mcp-proxy.cjs
-> npm registry: Publishes to https://www.npmjs.com/package/chain-insights
-> GitHub Actions CI: Validates release smoke tests

## Invariants
- Node.js >=22.0.0 required (engines field enforces via npm)
- Files field limits published scope (bin, dist, skills, docs/*.md, docs/images/) - excludes src/ and tests/
- Bin commands: `chain-insights`, `cia` (CLI), `chain-insights-mcp-proxy` (stdio proxy)
- Version bumps require CHANGELOG.md update (release:check validates this)
- Release artifacts: package.json, package-lock.json, CHANGELOG.md must all be updated in release PRs
- TypeScript build runs via tsdown (ESM output) with template/asset copying into dist/
- Package is public; no private registry configuration required
