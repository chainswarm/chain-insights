# Contributing to Chain Insights

Thanks for your interest. Chain Insights is an open-source AML investigation CLI
and MCP proxy. This page is the short path from checkout to merged PR.

## Ground rules

- **Small, single-theme PRs.** One concern per PR beats one big PR.
- **Conventional commit titles.** `feat:`, `fix:`, `docs:`, `chore:` — the PR
  title becomes the squash-merge message.
- **Every PR that changes release-bearing files bumps the version and adds a
  CHANGELOG entry.** CI enforces this (`npm run release:check`).
- **No runtime dependencies without justification** in the PR body.

## Local setup

```bash
npm install
npm run build
node bin/cli.js --help
```

Checks CI runs — run them before pushing:

```bash
npm run typecheck
npm test
npm run build
npm run lint:package            # publint
npm run check:types-resolution  # arethetypeswrong
```

## Reporting bugs

Open an issue with the bug-report template. Include the `cia` version
(`cia --version`), the command you ran, and the unexpected output. Never paste
live private keys, bearer tokens, seed phrases, or funded wallet material — see
[SECURITY.md](SECURITY.md).

## Proposing features

Open an issue with the feature-request template first. One paragraph on the
user problem is enough to start the conversation.

## Where things live

- Product-first overview: `README.md`.
- Graph tool contracts: `docs/graph-tools.md`.
- Workspace behavior: `docs/investigation-workspaces.md`.
- MCP proxy setup: `docs/mcp-proxy.md`.
- Agent-facing guidance: `skills/`.
- Deeper contributor detail: `docs/contributing.md`, `docs/development.md`.

## What stability you can rely on

Public surface guarantees are documented in
[docs/stability.md](docs/stability.md). If your change alters a guaranteed
surface (CLI exit codes, MCP tool names, workspace layout), say so explicitly
in the PR — it changes the versioning and the CHANGELOG wording.
