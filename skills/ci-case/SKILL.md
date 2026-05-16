---
name: ci-case
description: "Manage Chain Insights investigation cases (open, activate, suspend, close)"
allowed-tools:
  - Read
  - Write
  - Bash
---

# /ci-case

Manage investigation cases. Open new cases, switch active cases, suspend work-in-progress, or close completed investigations.

Run case commands from an initialized Chain Insights workspace. If
`.chain-insights/workspace.json` is missing, initialize the current project
folder first:

```bash
cia init .
```

Cases live under the workspace `cases/` directory. Global `~/.chain-insights`
is reserved for config, cache, wallet, and installed skills; it is not the
investigation root.

## Usage

- `/ci-case open <name>`: open a new workspace-local investigation case.
- `/ci-case status`: show active and open cases in the current workspace.
- `/ci-case suspend`: suspend the active workspace case.
- `/ci-case close <name>`: close a workspace case.

## CLI Equivalents

```bash
cia case open "<name>" --tags "<network-or-topic>"
cia case list
cia case show <case-number>
cia case session start <case-number> "session title"
cia case session end <case-number> --findings "..." --next-steps "..."
```

Use numbered selectors from `cia case list` when a command accepts a case.
