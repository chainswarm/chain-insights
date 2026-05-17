---
name: ci-status
description: "Show Chain Insights toolkit status, database health, and active cases"
allowed-tools:
  - Read
  - Bash
---

# /ci-status

Shows Chain Insights status for the current workspace: workspace metadata,
configured MCP endpoints, local server health, and case/session context when
available.

Run from an initialized workspace. If `.chain-insights/workspace.json` is
missing, run:

```bash
cia init .
```

The workspace is the investigation root. `~/.chain-insights` is only for global
configuration, cache, wallet, and installed skills; do not treat it as the case,
report, schema, or log root.

## Usage

`/ci-status`

## What it does

1. Confirms `.chain-insights/workspace.json` exists in the workspace.
2. Runs `cia status` or `chain-insights status` via Bash.
3. Reads workspace `.chain-insights/` metadata and runtime files when present.
4. Lists workspace cases with `cia case list`.
5. Reports server and MCP endpoint configuration without writing investigation output globally.

## Example output

```
Workspace: /home/user/investigations/case-42
Cases:     /home/user/investigations/case-42/cases
Reports:   /home/user/investigations/case-42/reports
Server:    http://127.0.0.1:4321
```
