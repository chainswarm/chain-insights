---
name: ci-status
description: "Show Chain Insights toolkit status, database health, and active cases"
allowed-tools:
  - Read
  - Bash
---

# /ci-status

Shows toolkit status: database health, active case (if any), and MCP endpoint connectivity.

## Usage

`/ci-status`

## What it does

1. Runs `chain-insights status` via Bash to check database health
2. Reads `.chain-insights/config.json` to show MCP endpoint configuration
3. Reports the active case name if a case is open (Phase 3)

## Example output

```
DB:      healthy
Config:  /home/user/.chain-insights
Server:  http://127.0.0.1:4321
```
