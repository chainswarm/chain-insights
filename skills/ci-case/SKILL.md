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

## Usage

`/ci-case open <name>` — open a new investigation case
`/ci-case status` — show the active case and all open cases
`/ci-case suspend` — suspend the active case
`/ci-case close <name>` — close a case

## Note

Case management is implemented in Phase 3. This skill file is a placeholder registered during installation so the slash command is discoverable from day one.
