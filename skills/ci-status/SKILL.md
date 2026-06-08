---
name: ci-status
description: "Show Chain Insights toolkit status and workspace health"
allowed-tools:
  - Read
  - Bash
---

# /ci-status

Shows Chain Insights status for the current workspace: workspace metadata, configured MCP endpoints, and local server health when available.

Run from an initialized workspace. If `.chain-insights/workspace.json` is missing, run:

```bash
cia init .
```

The workspace is the investigation root. `~/.chain-insights` is only for global configuration, cache, wallet, and installed skills; do not treat it as the artifact, report, schema, or log root.

## Usage

`/ci-status`

## What it does

1. Confirms `.chain-insights/workspace.json` exists in the workspace.
2. Runs `cia status` or `chain-insights status` via Bash.
3. Reads workspace `.chain-insights/` metadata and runtime files when present.
4. Reports server and MCP endpoint configuration without writing workspace output globally.

## Example output

```text
Workspace: /home/user/investigations/workspace-42
Artifacts: /home/user/investigations/workspace-42/artifacts
Reports:   /home/user/investigations/workspace-42/reports
Server:    http://127.0.0.1:4321
```
